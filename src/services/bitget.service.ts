import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { config } from '../config';
import { decrypt } from '../utils/encryption';

interface BitgetCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}

interface PriceCache {
  [symbol: string]: {
    price: string;
    timestamp: number;
  };
}

// Cache simple en memoria con TTL de 5 segundos
const priceCache: PriceCache = {};
const CACHE_TTL = 5000; // 5 segundos

export class BitgetService {
  private apiBaseUrl: string;

  constructor() {
    this.apiBaseUrl = config.bitget.apiBaseUrl;
  }

  private generateSignature(
    timestamp: string,
    method: string,
    requestPath: string,
    body: string,
    secret: string
  ): string {
    const message = timestamp + method + requestPath + body;
    return crypto.createHmac('sha256', secret).update(message).digest('base64');
  }

  private async makeRequest(
    method: 'GET' | 'POST',
    endpoint: string,
    credentials: BitgetCredentials,
    body?: any
  ): Promise<any> {
    const timestamp = Date.now().toString();
    const requestPath = endpoint;
    const bodyString = body ? JSON.stringify(body) : '';

    const signature = this.generateSignature(
      timestamp,
      method,
      requestPath,
      bodyString,
      credentials.apiSecret
    );

    const headers: any = {
      'ACCESS-KEY': credentials.apiKey,
      'ACCESS-SIGN': signature,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': credentials.passphrase,
      'Content-Type': 'application/json',
      'locale': 'en-US',
    };

    try {
      const response = await axios({
        method,
        url: `${this.apiBaseUrl}${endpoint}`,
        headers,
        data: body,
      });

      if (response.data.code === '00000') {
        return response.data.data;
      } else {
        throw new Error(`Bitget API Error: ${response.data.msg}`);
      }
    } catch (error: any) {
      throw new Error(
        `Bitget API Request Failed: ${error.response?.data?.msg || error.message}`
      );
    }
  }

  async getTickerPrice(
    symbol: string,
    productType: string = 'USDT-FUTURES'
  ): Promise<string> {
    // Verificar cache
    const cacheKey = `${symbol}_${productType}`;
    const cached = priceCache[cacheKey];
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.price;
    }

    try {
      const response = await axios.get(
        `${this.apiBaseUrl}/api/v2/mix/market/ticker`,
        {
          params: {
            symbol,
            productType,
          },
        }
      );

      if (response.data.code === '00000' && response.data.data) {
        const price = response.data.data.last;
        
        // Actualizar cache
        priceCache[cacheKey] = {
          price,
          timestamp: Date.now(),
        };
        
        return price;
      } else {
        throw new Error('Failed to get ticker price');
      }
    } catch (error: any) {
      throw new Error(
        `Failed to get ticker price: ${error.response?.data?.msg || error.message}`
      );
    }
  }

  // Obtener información del contrato (minTradeNum, sizeMultiplier, etc.)
  async getContractInfo(
    symbol: string,
    productType: string = 'USDT-FUTURES'
  ): Promise<{
    minTradeNum: string;
    sizeMultiplier: string;
    minTradeUSDT: string;
    volumePlace: string;
    pricePlace: string;
  }> {
    try {
      const response = await axios.get(
        `${this.apiBaseUrl}/api/v2/mix/market/contracts`,
        {
          params: {
            symbol,
            productType: productType.toLowerCase(),
          },
        }
      );

      if (response.data.code === '00000' && response.data.data && response.data.data.length > 0) {
        const contract = response.data.data[0];
        return {
          minTradeNum: contract.minTradeNum || '0.01',
          sizeMultiplier: contract.sizeMultiplier || '0.01',
          minTradeUSDT: contract.minTradeUSDT || '5',
          volumePlace: contract.volumePlace || '2',
          pricePlace: contract.pricePlace || '1',
        };
      } else {
        throw new Error('Failed to get contract info');
      }
    } catch (error: any) {
      throw new Error(
        `Failed to get contract info: ${error.response?.data?.msg || error.message}`
      );
    }
  }

  // Calcular el tamaño correcto de la orden basándose en los requisitos del contrato
  calculateOrderSize(
    requestedSize: string | number,
    minTradeNum: string,
    sizeMultiplier: string
  ): string {
    const requested = parseFloat(requestedSize.toString());
    const minTrade = parseFloat(minTradeNum);
    const multiplier = parseFloat(sizeMultiplier);

    // Si el tamaño solicitado es menor al mínimo, usar el mínimo
    let size = Math.max(requested, minTrade);

    // Asegurar que el tamaño sea múltiplo de sizeMultiplier
    // Redondear hacia arriba al múltiplo más cercano
    size = Math.ceil(size / multiplier) * multiplier;

    // Redondear a los decimales apropiados (usar volumePlace si está disponible)
    // Por ahora, usar hasta 8 decimales para evitar problemas de precisión
    return size.toFixed(8).replace(/\.?0+$/, '');
  }

  async placeOrder(
    credentials: BitgetCredentials,
    orderData: {
      symbol: string;
      productType: string;
      marginMode: string;
      marginCoin: string;
      size: string;
      price?: string;
      side: 'buy' | 'sell';
      tradeSide?: 'open' | 'close';
      orderType: 'limit' | 'market';
      force?: string;
      clientOid?: string;
    }
  ): Promise<{ orderId: string; clientOid: string }> {
    const endpoint = '/api/v2/mix/order/place-order';
    
    const orderPayload: any = {
      symbol: orderData.symbol,
      productType: orderData.productType,
      marginMode: orderData.marginMode,
      marginCoin: orderData.marginCoin,
      size: orderData.size,
      side: orderData.side,
      orderType: orderData.orderType,
    };

    if (orderData.price) {
      orderPayload.price = orderData.price;
    }

    if (orderData.tradeSide) {
      orderPayload.tradeSide = orderData.tradeSide;
    }

    if (orderData.force) {
      orderPayload.force = orderData.force;
    } else if (orderData.orderType === 'limit') {
      orderPayload.force = 'gtc';
    }

    if (orderData.clientOid) {
      orderPayload.clientOid = orderData.clientOid;
    }

    const result = await this.makeRequest('POST', endpoint, credentials, orderPayload);
    
    return {
      orderId: result.orderId || result.clientOid,
      clientOid: result.clientOid || orderData.clientOid || '',
    };
  }

  async getOrderStatus(
    credentials: BitgetCredentials,
    orderId: string,
    symbol: string,
    productType: string = 'USDT-FUTURES'
  ): Promise<any> {
    const endpoint = `/api/v2/mix/order/detail?orderId=${orderId}&symbol=${symbol}&productType=${productType}`;
    
    return await this.makeRequest('GET', endpoint, credentials);
  }

  // Modificar stop loss de una posición usando place-pos-tpsl
  // Este endpoint permite establecer o modificar stop loss y take profit para una posición existente
  async modifyPositionStopLoss(
    credentials: BitgetCredentials,
    symbol: string,
    stopLossPrice: number,
    productType: string = 'USDT-FUTURES',
    marginCoin: string = 'USDT',
    takeProfitPrice?: number
  ): Promise<any> {
    try {
      // Obtener la posición para determinar holdSide y tamaño
      const positions = await this.getPositions(credentials, symbol, productType);
      if (!positions || positions.length === 0) {
        throw new Error('No se encontró posición abierta para el símbolo');
      }

      const position = positions[0];
      const holdSide = position.holdSide || (parseFloat(position.size) > 0 ? 'long' : 'short');

      // Usar el endpoint place-pos-tpsl para establecer/modificar stop loss
      const endpoint = '/api/v2/mix/order/place-pos-tpsl';
      const payload: any = {
        marginCoin,
        productType: productType.toLowerCase(), // Bitget requiere lowercase
        symbol,
        holdSide,
        stopLossTriggerPrice: stopLossPrice.toString(),
        stopLossTriggerType: 'fill_price', // Usar fill_price para activación precisa
        stopLossExecutePrice: stopLossPrice.toString(), // Precio de ejecución igual al trigger
      };

      // Si hay take profit, incluirlo también
      if (takeProfitPrice) {
        payload.stopSurplusTriggerPrice = takeProfitPrice.toString();
        payload.stopSurplusTriggerType = 'fill_price';
        payload.stopSurplusExecutePrice = takeProfitPrice.toString();
      }

      return await this.makeRequest('POST', endpoint, credentials, payload);
    } catch (error: any) {
      throw new Error(`Error al modificar stop loss: ${error.message}`);
    }
  }

  // Obtener posiciones abiertas
  async getPositions(
    credentials: BitgetCredentials,
    symbol?: string,
    productType: string = 'USDT-FUTURES'
  ): Promise<any> {
    let endpoint = `/api/v2/mix/position/all-position?productType=${productType}`;
    if (symbol) {
      endpoint += `&symbol=${symbol}`;
    }
    
    return await this.makeRequest('GET', endpoint, credentials);
  }

  // Configurar apalancamiento para un símbolo
  async setLeverage(
    credentials: BitgetCredentials,
    symbol: string,
    leverage: number,
    productType: string = 'USDT-FUTURES',
    marginCoin: string = 'USDT',
    holdSide?: 'long' | 'short'
  ): Promise<any> {
    const endpoint = '/api/v2/mix/account/set-leverage';
    
    const payload: any = {
      symbol: symbol.toUpperCase(),
      productType: productType,
      marginCoin: marginCoin.toUpperCase(),
      leverage: leverage.toString(),
    };

    // Si se especifica holdSide, agregarlo (necesario para posiciones bidireccionales en modo isolated)
    if (holdSide) {
      payload.holdSide = holdSide;
    }

    return await this.makeRequest('POST', endpoint, credentials, payload);
  }

  // Validar conexión con Bitget usando las credenciales
  async validateConnection(credentials: BitgetCredentials): Promise<{ valid: boolean; message: string }> {
    try {
      // Intentar obtener información de la cuenta de futuros como prueba de conexión
      const endpoint = '/api/v2/mix/account/accounts';
      const params = 'productType=USDT-FUTURES';
      
      const timestamp = Date.now().toString();
      const requestPath = `${endpoint}?${params}`;
      const bodyString = '';
      
      const signature = this.generateSignature(
        timestamp,
        'GET',
        requestPath,
        bodyString,
        credentials.apiSecret
      );

      const headers: any = {
        'ACCESS-KEY': credentials.apiKey,
        'ACCESS-SIGN': signature,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': credentials.passphrase,
        'Content-Type': 'application/json',
        'locale': 'en-US',
      };

      const response = await axios({
        method: 'GET',
        url: `${this.apiBaseUrl}${requestPath}`,
        headers,
      });

      if (response.data.code === '00000') {
        return {
          valid: true,
          message: 'Conexión exitosa. Las credenciales son válidas.',
        };
      } else {
        return {
          valid: false,
          message: `Error de Bitget: ${response.data.msg || 'Credenciales inválidas'}`,
        };
      }
    } catch (error: any) {
      return {
        valid: false,
        message: `Error al validar conexión: ${error.response?.data?.msg || error.message}`,
      };
    }
  }

  // Helper para obtener credenciales desencriptadas
  static getDecryptedCredentials(encryptedCredentials: {
    api_key: string;
    api_secret: string;
    passphrase: string;
  }): BitgetCredentials {
    return {
      apiKey: decrypt(encryptedCredentials.api_key),
      apiSecret: decrypt(encryptedCredentials.api_secret),
      passphrase: decrypt(encryptedCredentials.passphrase),
    };
  }
}

