import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { CredentialsModel } from '../models/Credentials';
import { SubscriptionModel } from '../models/Subscription';
import { encrypt } from '../utils/encryption';
import { BitgetService } from '../services/bitget.service';

export class CredentialsController {
  static async list(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const credentials = await CredentialsModel.findByUserId(req.user.userId);

      // No devolver las credenciales encriptadas completas por seguridad
      res.json(
        credentials.map((cred) => ({
          id: cred.id,
          is_active: cred.is_active,
          created_at: cred.created_at,
        }))
      );
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { api_key, api_secret, passphrase } = req.body;

      if (!api_key || !api_secret || !passphrase) {
        res.status(400).json({
          error: 'api_key, api_secret, and passphrase are required',
        });
        return;
      }

      // Verificar si ya existe una credencial activa
      const existingCredentials = await CredentialsModel.findByUserId(req.user.userId);
      const hasActiveCredential = existingCredentials.some(cred => cred.is_active);

      if (hasActiveCredential) {
        res.status(400).json({
          error: 'Ya tienes una credencial activa. Solo puedes tener una credencial activa a la vez. Desactiva la credencial actual antes de crear una nueva.',
        });
        return;
      }

      // Encriptar credenciales
      const encryptedApiKey = encrypt(api_key);
      const encryptedApiSecret = encrypt(api_secret);
      const encryptedPassphrase = encrypt(passphrase);

      // Desactivar todas las credenciales existentes antes de crear la nueva (por seguridad)
      for (const cred of existingCredentials) {
        if (cred.is_active) {
          await CredentialsModel.update(
            cred.id,
            req.user.userId,
            undefined,
            undefined,
            undefined,
            false
          );
        }
      }

      const credentialId = await CredentialsModel.create(
        req.user.userId,
        encryptedApiKey,
        encryptedApiSecret,
        encryptedPassphrase
      );

      res.status(201).json({
        id: credentialId,
        message: 'Credentials saved successfully',
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const { api_key, api_secret, passphrase, is_active } = req.body;

      const credential = await CredentialsModel.findById(
        parseInt(id),
        req.user.userId
      );

      if (!credential) {
        res.status(404).json({ error: 'Credentials not found' });
        return;
      }

      const updates: any = {};
      if (api_key) updates.api_key = encrypt(api_key);
      if (api_secret) updates.api_secret = encrypt(api_secret);
      if (passphrase) updates.passphrase = encrypt(passphrase);
      if (is_active !== undefined) {
        updates.is_active = Boolean(is_active);
        
        // Si se está activando esta credencial, desactivar todas las demás
        if (updates.is_active === true) {
          const allCredentials = await CredentialsModel.findByUserId(req.user.userId);
          for (const cred of allCredentials) {
            if (cred.id !== parseInt(id) && cred.is_active) {
              await CredentialsModel.update(
                cred.id,
                req.user.userId,
                undefined,
                undefined,
                undefined,
                false
              );
            }
          }
        }
      }

      await CredentialsModel.update(
        parseInt(id),
        req.user.userId,
        updates.api_key,
        updates.api_secret,
        updates.passphrase,
        updates.is_active
      );

      res.json({ message: 'Credentials updated successfully' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      const credential = await CredentialsModel.findById(
        parseInt(id),
        req.user.userId
      );

      if (!credential) {
        res.status(404).json({ error: 'Credentials not found' });
        return;
      }

      // Verificar si el usuario tiene estrategias habilitadas
      const subscriptions = await SubscriptionModel.findByUserId(req.user.userId);
      const hasEnabledStrategies = subscriptions.some(sub => sub.is_enabled);

      if (hasEnabledStrategies) {
        res.status(400).json({
          error: 'No puedes eliminar credenciales mientras tengas estrategias habilitadas. Desactiva todas tus estrategias primero.',
        });
        return;
      }

      await CredentialsModel.delete(parseInt(id), req.user.userId);

      res.json({ message: 'Credentials deleted successfully' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async validate(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      const credential = await CredentialsModel.findById(
        parseInt(id),
        req.user.userId
      );

      if (!credential) {
        res.status(404).json({ error: 'Credentials not found' });
        return;
      }

      // Desencriptar credenciales
      const decryptedCredentials = BitgetService.getDecryptedCredentials({
        api_key: credential.api_key,
        api_secret: credential.api_secret,
        passphrase: credential.passphrase,
      });

      // Validar conexión con Bitget
      const bitgetService = new BitgetService();
      const validation = await bitgetService.validateConnection(decryptedCredentials);

      if (validation.valid) {
        res.json({
          success: true,
          message: validation.message,
        });
      } else {
        res.status(400).json({
          success: false,
          error: validation.message,
        });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

