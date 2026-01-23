import axios from 'axios';
import crypto from 'crypto';
import { NOWPaymentsCredentialsModel } from '../models/NOWPaymentsCredentials';

export interface CreatePaymentRequest {
  price_amount: number;
  price_currency: string;
  pay_currency?: string;
  order_id?: string;
  order_description?: string;
  ipn_callback_url?: string;
  success_url?: string;
  cancel_url?: string;
  is_fixed_rate?: boolean;
  is_fee_paid_by_user?: boolean;
}

export interface PaymentResponse {
  payment_id: string;
  payment_status: string;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  pay_currency: string;
  order_id: string;
  order_description: string;
  ipn_callback_url: string;
  purchase_id?: string;
  amount_received?: number | null;
  payin_extra_id?: string | null;
  smart_contract?: string;
  network?: string;
  network_precision?: number;
  time_limit?: number | null;
  burning_percent?: number | null;
  expiration_estimate_date?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateInvoiceRequest {
  price_amount: number;
  price_currency: string;
  pay_currency: string;
  order_id?: string;
  order_description?: string;
  success_url?: string;
  ipn_callback_url?: string;
}

export interface InvoiceResponse {
  invoice_id: string;
  invoice_url: string;
  status: string;
  order_id: string;
  order_description: string;
}

export class NOWPaymentsService {
  private apiKey: string;
  private publicKey: string;
  private apiUrl: string;
  private email: string | null = null;
  private password: string | null = null;
  private token: string | null = null;
  private tokenExpiresAt: Date | null = null;
  private credentialsLoaded: boolean = false;

  constructor() {
    // Las credenciales se cargan desde la base de datos cuando se necesiten
    // No se inicializan aquí para forzar la carga desde BD
    this.apiKey = '';
    this.publicKey = '';
    this.apiUrl = 'https://api.nowpayments.io/v1'; // URL por defecto
  }

  private async loadCredentials() {
    if (this.credentialsLoaded) {
      return;
    }

    try {
      const credentials = await NOWPaymentsCredentialsModel.findActive();
      if (credentials) {
        // Las credenciales ya vienen desencriptadas del modelo
        this.apiKey = credentials.api_key || '';
        this.publicKey = credentials.public_key || '';
        this.apiUrl = credentials.api_url || 'https://api.nowpayments.io/v1';
        // Asegurar que apiUrl nunca sea null
        if (!this.apiUrl) {
          this.apiUrl = 'https://api.nowpayments.io/v1';
        }
        this.email = credentials.email || null;
        this.password = credentials.password || null;
        this.token = credentials.token || null;
        this.tokenExpiresAt = credentials.token_expires_at ? new Date(credentials.token_expires_at) : null;
        this.credentialsLoaded = true;
        console.log('✓ Credenciales de NOWPayments cargadas desde BD:', {
          has_email: !!this.email,
          has_password: !!this.password,
          has_token: !!this.token,
          token_expires_at: this.tokenExpiresAt?.toISOString() || 'No configurado',
          token_valid: this.token && this.tokenExpiresAt && new Date() < this.tokenExpiresAt,
          api_url: this.apiUrl,
        });
        return;
      } else {
        console.warn('No se encontraron credenciales activas en BD');
      }
    } catch (error: any) {
      console.warn('Error al cargar credenciales de BD, usando variables de entorno:', error.message);
    }
    
    // Si no se cargaron de BD, usar variables de entorno (ya inicializadas en constructor)
    if (this.apiKey && this.apiKey.trim() !== '') {
      console.log('Usando credenciales de variables de entorno');
    } else {
      console.error('⚠️ No hay credenciales de NOWPayments configuradas (ni en BD ni en variables de entorno)');
    }
  }

  private async getAuthToken(): Promise<string> {
    // Asegurarse de que las credenciales estén cargadas (incluyendo el token de BD)
    await this.loadCredentials();
    
    // Si tenemos un token válido guardado en BD, verificar si aún es válido
    // Los tokens de NOWPayments expiran cada 5 minutos, así que verificamos con un margen de 1 minuto
    if (this.token && this.tokenExpiresAt) {
      const now = new Date();
      const expiresAt = this.tokenExpiresAt instanceof Date ? this.tokenExpiresAt : new Date(this.tokenExpiresAt);
      const timeUntilExpiry = expiresAt.getTime() - now.getTime();
      const oneMinuteInMs = 60 * 1000; // 1 minuto en milisegundos
      
      // Si el token es válido y tiene más de 1 minuto restante, usarlo
      if (timeUntilExpiry > oneMinuteInMs) {
        const minutesLeft = Math.floor(timeUntilExpiry / 60000);
        console.log(`✓ Usando token existente de la base de datos (válido por ${minutesLeft} minutos más, expira: ${expiresAt.toISOString()})`);
        return this.token;
      } else {
        // Token expirado o cerca de expirar (menos de 1 minuto), renovarlo
        console.log(`⚠️ Token expirado o cerca de expirar (${Math.floor(timeUntilExpiry / 1000)}s restantes), obteniendo uno nuevo`);
        this.token = null;
        this.tokenExpiresAt = null;
      }
    }

    // Si no tenemos email/password, no podemos autenticarnos
    if (!this.email || !this.password) {
      throw new Error('NOWPayments email y password no configurados. Por favor configura las credenciales en el panel de administración.');
    }

    // Autenticarse con NOWPayments para obtener el token
    try {
      const authData = {
        email: this.email.trim(),
        password: this.password.trim(),
      };

      console.log('Autenticándose con NOWPayments:', {
        url: `${this.apiUrl}/auth`,
        email: authData.email,
        password_length: authData.password.length,
      });

      const response = await axios.post(
        `${this.apiUrl}/auth`,
        authData, // Axios automáticamente serializa a JSON cuando Content-Type es application/json
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      console.log('Respuesta de autenticación:', {
        status: response.status,
        data_keys: Object.keys(response.data),
        has_token: !!response.data.token,
        has_access_token: !!response.data.access_token,
        has_accessToken: !!response.data.accessToken,
      });

      const token = response.data.token || response.data.access_token || response.data.accessToken;
      if (!token) {
        console.error('Respuesta completa:', JSON.stringify(response.data, null, 2));
        throw new Error('No se recibió token en la respuesta de autenticación. Respuesta: ' + JSON.stringify(response.data));
      }

      // Guardar el token y su fecha de expiración
      // Los tokens de NOWPayments expiran cada 5 minutos (300 segundos)
      this.token = token;
      const expiresIn = response.data.expires_in || response.data.expiresIn || 300; // 5 minutos por defecto (300 segundos)
      this.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
      
      console.log(`✓ Token obtenido, expira en ${expiresIn} segundos (${Math.floor(expiresIn / 60)} minutos)`);

      // Actualizar el token en la base de datos
      const credentials = await NOWPaymentsCredentialsModel.findActive();
      if (credentials) {
        await NOWPaymentsCredentialsModel.update(
          credentials.id,
          undefined, // apiKey
          undefined, // publicKey
          undefined, // apiUrl
          undefined, // isActive
          undefined, // email
          undefined, // password
          this.token || undefined, // Convertir null a undefined
          this.tokenExpiresAt
        );
      }

      console.log('✓ Token de NOWPayments obtenido exitosamente');
      return this.token || '';
    } catch (error: any) {
      console.error('Error al autenticarse con NOWPayments:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      throw new Error(
        `NOWPayments Authentication Error: ${error.response?.data?.message || error.message}`
      );
    }
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const token = await this.getAuthToken();
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  async createPayment(data: CreatePaymentRequest): Promise<PaymentResponse> {
    await this.loadCredentials();
    
    // Verificar que tenemos tanto el token como la API key
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error('API key de NOWPayments no configurada. Por favor configura las credenciales en el panel de administración.');
    }
    
    try {
      // Obtener token (esto renovará el token si es necesario)
      const token = await this.getAuthToken();
      
      if (!token) {
        throw new Error('Token de autenticación no disponible. Por favor verifica las credenciales de NOWPayments.');
      }

      // El endpoint /payment requiere ambos headers:
      // 1. Authorization: Bearer {token} - token JWT obtenido de /auth
      // 2. x-api-key: {api-key} - API key guardada en la base de datos
      const headers = {
        'Authorization': `Bearer ${token}`,
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      };

      console.log('Creando pago en NOWPayments:', {
        url: `${this.apiUrl}/payment`,
        price_amount: data.price_amount,
        price_currency: data.price_currency,
        pay_currency: data.pay_currency,
        order_id: data.order_id,
        has_token: !!token,
        has_api_key: !!this.apiKey,
      });

      const response = await axios.post(
        `${this.apiUrl}/payment`,
        data,
        { headers, timeout: 30000 }
      );

      console.log('✓ Pago creado exitosamente:', {
        payment_id: response.data.payment_id,
        status: response.data.payment_status,
        order_id: response.data.order_id,
      });

      return response.data;
    } catch (error: any) {
      console.error('Error al crear pago en NOWPayments:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      throw new Error(
        `NOWPayments API Error: ${error.response?.data?.message || error.message}`
      );
    }
  }

  async getPaymentStatus(paymentId: string): Promise<PaymentResponse> {
    await this.loadCredentials();
    
    // Verificar que tenemos la API key
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error('API key de NOWPayments no configurada. Por favor configura las credenciales en el panel de administración.');
    }
    
    try {
      // El endpoint /payment/{id} requiere x-api-key header
      const headers = {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      };

      console.log('Consultando estado del pago en NOWPayments:', {
        url: `${this.apiUrl}/payment/${paymentId}`,
        has_api_key: !!this.apiKey,
        api_key_prefix: this.apiKey.substring(0, 10) + '...',
      });

      const response = await axios.get(
        `${this.apiUrl}/payment/${paymentId}`,
        { headers, timeout: 30000 }
      );

      console.log('✓ Estado del pago obtenido:', {
        payment_id: response.data.payment_id,
        payment_status: response.data.payment_status,
      });

      return response.data;
    } catch (error: any) {
      console.error('Error al obtener estado del pago:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      throw new Error(
        `Failed to get payment status: ${error.response?.data?.message || error.message}`
      );
    }
  }

  async createInvoice(data: CreateInvoiceRequest): Promise<InvoiceResponse> {
    await this.loadCredentials();
    
    try {
      // getHeaders() automáticamente verifica y renueva el token si es necesario
      const headers = await this.getHeaders();

      console.log('✅ Creando invoice en NOWPayments:', {
        url: `${this.apiUrl}/invoice`,
        price_amount: data.price_amount,
        price_currency: data.price_currency,
        pay_currency: data.pay_currency,
        order_id: data.order_id,
      });

      const response = await axios.post(
        `${this.apiUrl}/invoice`,
        data, // Ya no enviamos api_key en el body, usamos token en header
        { 
          headers,
          timeout: 30000,
        }
      );

      console.log('Invoice creado exitosamente:', {
        invoice_id: response.data.invoice_id,
        status: response.data.status,
      });

      return response.data;
    } catch (error: any) {
      console.error('Error al crear invoice en NOWPayments:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        api_key_length: this.apiKey?.length,
        api_key_prefix: this.apiKey?.substring(0, 10),
      });
      
      // Si el error es de API key inválida, dar más detalles
      if (error.response?.status === 403 || error.response?.data?.code === 'INVALID_API_KEY') {
        throw new Error(
          `NOWPayments API Error: API key inválida. Verifica que la API key esté correcta y tenga permisos para crear invoices. Longitud: ${this.apiKey?.length} caracteres`
        );
      }
      
      throw new Error(
        `NOWPayments API Error: ${error.response?.data?.message || error.message}`
      );
    }
  }

  async getPayments(params?: {
    limit?: number;
    page?: number;
    sortBy?: string;
    orderBy?: 'asc' | 'desc';
    dateFrom?: string;
    dateTo?: string;
    invoiceId?: string;
  }): Promise<any> {
    await this.loadCredentials();
    
    // Verificar que tenemos tanto el token como la API key
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error('API key de NOWPayments no configurada. Por favor configura las credenciales en el panel de administración.');
    }
    
    try {
      // Obtener token (esto renovará el token si es necesario)
      console.log('📋 Obteniendo token para consultar pagos de NOWPayments...');
      const token = await this.getAuthToken();
      
      if (!token) {
        throw new Error('Token de autenticación no disponible. Por favor verifica las credenciales de NOWPayments.');
      }
      
      // Construir query parameters
      const queryParams = new URLSearchParams();
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.page !== undefined) queryParams.append('page', params.page.toString());
      if (params?.sortBy) queryParams.append('sortBy', params.sortBy);
      if (params?.orderBy) queryParams.append('orderBy', params.orderBy);
      if (params?.dateFrom) queryParams.append('dateFrom', params.dateFrom);
      if (params?.dateTo) queryParams.append('dateTo', params.dateTo);
      if (params?.invoiceId) queryParams.append('invoiceId', params.invoiceId);

      const url = `${this.apiUrl}/payment${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
      
      console.log('Obteniendo lista de pagos de NOWPayments:', { 
        url,
        has_token: !!token,
        has_api_key: !!this.apiKey,
        token_prefix: token.substring(0, 20) + '...',
        api_key_prefix: this.apiKey.substring(0, 10) + '...',
      });

      // El endpoint requiere ambos headers:
      // 1. Authorization: Bearer {token} - token JWT obtenido de /auth
      // 2. x-api-key: {api-key} - API key guardada en la base de datos
      const headers = {
        'Authorization': `Bearer ${token}`,
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      };

      const response = await axios.get(url, { 
        headers,
        timeout: 30000,
      });

      console.log('✓ Pagos obtenidos exitosamente:', {
        status: response.status,
        data_type: Array.isArray(response.data) ? 'array' : typeof response.data,
        data_keys: response.data && typeof response.data === 'object' ? Object.keys(response.data) : 'N/A',
      });

      return response.data;
    } catch (error: any) {
      console.error('❌ Error al obtener pagos de NOWPayments:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        url: error.config?.url || 'N/A',
        headers_sent: error.config?.headers ? Object.keys(error.config.headers) : 'N/A',
      });
      
      // Si el error es de autenticación, dar más detalles
      if (error.response?.status === 401 || error.response?.status === 403) {
        throw new Error(
          `Error de autenticación: ${error.response?.data?.message || 'Token o API key inválidos. Verifica las credenciales de NOWPayments.'}`
        );
      }
      
      throw new Error(
        `Failed to get payments: ${error.response?.data?.message || error.message}`
      );
    }
  }

  async getCurrencies(): Promise<any> {
    await this.loadCredentials();
    
    // Verificar que tenemos la API key
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error('API key de NOWPayments no configurada. Por favor configura las credenciales en el panel de administración.');
    }
    
    try {
      // El endpoint /full-currencies solo requiere x-api-key header
      const headers = {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      };

      console.log('Obteniendo currencies de NOWPayments:', {
        url: `${this.apiUrl}/full-currencies`,
        has_api_key: !!this.apiKey,
        api_key_prefix: this.apiKey.substring(0, 10) + '...',
      });

      const response = await axios.get(`${this.apiUrl}/full-currencies`, {
        headers,
        timeout: 10000,
      });

      console.log('✓ Currencies obtenidas exitosamente:', {
        status: response.status,
        data_type: Array.isArray(response.data) ? 'array' : typeof response.data,
        data_keys: response.data && typeof response.data === 'object' ? Object.keys(response.data) : 'N/A',
      });

      return response.data;
    } catch (error: any) {
      console.error('Error al obtener currencies de NOWPayments:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        url: error.config?.url || 'N/A',
      });
      throw new Error(
        `Failed to get currencies: ${error.response?.data?.message || error.message}`
      );
    }
  }

  async verifyWebhookSignature(
    payload: any,
    signature: string
  ): Promise<boolean> {
    await this.loadCredentials();
    
    // NOWPayments usa el IPN secret key para verificar webhooks
    // La firma viene en el header x-nowpayments-sig
    // Necesitamos ordenar los parámetros y luego firmar con el IPN secret
    // El IPN secret es diferente de la API key - normalmente se guarda como public_key o IPN secret
    
    // Ordenar el objeto por keys
    const sortedPayload = JSON.parse(JSON.stringify(payload, Object.keys(payload).sort()));
    const sortedPayloadString = JSON.stringify(sortedPayload);
    
    // Usar el public_key como IPN secret (o debería ser un campo separado)
    // Por ahora usamos public_key, pero idealmente debería ser un campo IPN secret separado
    const ipnSecret = this.publicKey || this.apiKey;
    
    const expectedSignature = crypto
      .createHmac('sha512', ipnSecret)
      .update(sortedPayloadString)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }
}

