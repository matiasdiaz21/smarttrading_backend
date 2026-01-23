import { Response } from 'express';
import axios from 'axios';
import { AuthRequest } from '../middleware/auth';
import { NOWPaymentsCredentialsModel } from '../models/NOWPaymentsCredentials';
import { NOWPaymentsService } from '../services/nowpayments.service';

export class NOWPaymentsCredentialsController {
  static async get(req: AuthRequest, res: Response): Promise<void> {
    try {
      const credentials = await NOWPaymentsCredentialsModel.findAll();
      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getActive(req: AuthRequest, res: Response): Promise<void> {
    try {
      const credentials = await NOWPaymentsCredentialsModel.findActive();
      if (!credentials) {
        res.status(404).json({ error: 'No active NOWPayments credentials found' });
        return;
      }
      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const credentials = await NOWPaymentsCredentialsModel.findById(parseInt(id));

      if (!credentials) {
        res.status(404).json({ error: 'NOWPayments credentials not found' });
        return;
      }

      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { email, password, api_key, public_key, api_url } = req.body;

      // Email y password son requeridos para autenticación
      if (!email || !password) {
        res.status(400).json({ error: 'Email y password son requeridos para autenticación' });
        return;
      }

      // Validar que email y password no estén vacíos
      if (email.trim() === '' || password.trim() === '') {
        res.status(400).json({ error: 'Email y password no pueden estar vacíos' });
        return;
      }

      // api_key y public_key son opcionales ahora (se mantienen para compatibilidad)
      const id = await NOWPaymentsCredentialsModel.create(
        api_key?.trim() || '',
        public_key?.trim() || '',
        api_url || 'https://api.nowpayments.io/v1',
        email.trim(),
        password.trim()
      );

      const credentials = await NOWPaymentsCredentialsModel.findById(id);
      res.status(201).json(credentials);
    } catch (error: any) {
      console.error('Error creating NOWPayments credentials:', error);
      res.status(500).json({ error: error.message || 'Error al crear credenciales' });
    }
  }

  static async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { email, password, api_key, public_key, api_url, is_active } = req.body;

      const credentials = await NOWPaymentsCredentialsModel.findById(parseInt(id));
      if (!credentials) {
        res.status(404).json({ error: 'NOWPayments credentials not found' });
        return;
      }

      await NOWPaymentsCredentialsModel.update(
        parseInt(id),
        api_key,
        public_key,
        api_url,
        is_active,
        email,
        password
      );

      const updated = await NOWPaymentsCredentialsModel.findById(parseInt(id));
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const credentials = await NOWPaymentsCredentialsModel.findById(parseInt(id));

      if (!credentials) {
        res.status(404).json({ error: 'NOWPayments credentials not found' });
        return;
      }

      await NOWPaymentsCredentialsModel.delete(parseInt(id));
      res.json({ message: 'NOWPayments credentials deleted successfully' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async testConnection(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const credentials = await NOWPaymentsCredentialsModel.findById(parseInt(id));

      if (!credentials) {
        res.status(404).json({ error: 'NOWPayments credentials not found' });
        return;
      }

      if (!credentials.email || !credentials.password) {
        res.status(400).json({ error: 'Email y password son requeridos para validar la conexión' });
        return;
      }

      // Crear una instancia del servicio y probar la autenticación
      const service = new NOWPaymentsService();
      
      // Cargar las credenciales manualmente
      (service as any).email = credentials.email;
      (service as any).password = credentials.password;
      (service as any).apiUrl = credentials.api_url || 'https://api.nowpayments.io/v1';
      (service as any).credentialsLoaded = true;

      // Intentar obtener el token
      const token = await (service as any).getAuthToken();

      // Probar el endpoint de status
      const headers = await (service as any).getHeaders();
      const statusResponse = await axios.get(
        `${credentials.api_url || 'https://api.nowpayments.io/v1'}/status`,
        { headers }
      );

      res.json({
        success: true,
        message: 'Conexión exitosa con NOWPayments',
        token: token.substring(0, 20) + '...',
        token_length: token.length,
        status_response: statusResponse.data,
      });
    } catch (error: any) {
      console.error('Error testing NOWPayments connection:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Error al validar la conexión',
        details: error.response?.data || null,
      });
    }
  }
}

