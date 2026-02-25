import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { BybitCredentialsModel } from '../models/BybitCredentials';
import { SubscriptionModel } from '../models/Subscription';
import { encrypt } from '../utils/encryption';
import { BybitService } from '../services/bybit.service';

export class BybitCredentialsController {
  static async list(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const credentials = await BybitCredentialsModel.findByUserId(req.user.userId);
      res.json(
        credentials.map((cred) => ({
          id: cred.id,
          name: cred.name ?? null,
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
      const { api_key, api_secret, name } = req.body;
      if (!api_key || !api_secret) {
        res.status(400).json({ error: 'api_key and api_secret are required' });
        return;
      }
      const encryptedApiKey = encrypt(api_key);
      const encryptedApiSecret = encrypt(api_secret);
      const credentialId = await BybitCredentialsModel.create(
        req.user.userId,
        encryptedApiKey,
        encryptedApiSecret,
        name ? String(name).trim() || null : null
      );
      res.status(201).json({ id: credentialId, message: 'Bybit credentials saved successfully' });
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
      const { api_key, api_secret, is_active, name } = req.body;
      const credential = await BybitCredentialsModel.findById(parseInt(id), req.user.userId);
      if (!credential) {
        res.status(404).json({ error: 'Credentials not found' });
        return;
      }
      const updates: { apiKey?: string; apiSecret?: string; isActive?: boolean; name?: string | null } = {};
      if (api_key) updates.apiKey = encrypt(api_key);
      if (api_secret) updates.apiSecret = encrypt(api_secret);
      if (is_active !== undefined) updates.isActive = Boolean(is_active);
      if (name !== undefined) updates.name = name ? String(name).trim() || null : null;
      await BybitCredentialsModel.update(
        parseInt(id),
        req.user.userId,
        updates.apiKey,
        updates.apiSecret,
        updates.isActive,
        updates.name
      );
      res.json({ message: 'Bybit credentials updated successfully' });
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
      const credential = await BybitCredentialsModel.findById(parseInt(id), req.user.userId);
      if (!credential) {
        res.status(404).json({ error: 'Credentials not found' });
        return;
      }
      const inUse = await SubscriptionModel.isCredentialInUse(req.user.userId, parseInt(id), null, 'bybit');
      if (inUse) {
        res.status(400).json({
          error: 'Esta credencial está asignada a una estrategia. Desasigna la credencial de la estrategia antes de eliminarla.',
        });
        return;
      }
      await BybitCredentialsModel.delete(parseInt(id), req.user.userId);
      res.json({ message: 'Bybit credentials deleted successfully' });
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
      const credential = await BybitCredentialsModel.findById(parseInt(id), req.user.userId);
      if (!credential) {
        res.status(404).json({ error: 'Credentials not found' });
        return;
      }
      const decrypted = BybitService.getDecryptedCredentials({
        api_key: credential.api_key,
        api_secret: credential.api_secret,
      });
      const bybitService = new BybitService();
      const validation = await bybitService.validateConnection(decrypted);
      if (validation.valid) {
        res.json({ success: true, message: validation.message });
      } else {
        res.status(400).json({ success: false, error: validation.message });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
