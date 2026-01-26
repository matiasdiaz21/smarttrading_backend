import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { UserModel } from '../models/User';
import { WebhookLogModel } from '../models/WebhookLog';
import { TradeModel } from '../models/Trade';
import OrderErrorModel from '../models/orderError.model';

export class AdminController {
  static async getUsers(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }

      const users = await UserModel.getAll();
      res.json(users);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getWebhookLogs(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }

      const { strategy_id } = req.query;
      const limit = parseInt(req.query.limit as string) || 100;

      let logs;
      if (strategy_id) {
        logs = await WebhookLogModel.findByStrategyId(
          parseInt(strategy_id as string),
          limit
        );
      } else {
        logs = await WebhookLogModel.findAll(limit);
      }

      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }

      // Aquí puedes agregar más estadísticas según necesites
      // Por ahora, retornamos estructura básica
      res.json({
        message: 'Stats endpoint - implementar según necesidades',
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getOrderErrors(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }

      const limitParam = req.query.limit as string;
      const limit = limitParam ? parseInt(limitParam, 10) : 100;
      
      // Validar que limit sea un número válido
      if (isNaN(limit) || limit < 1) {
        res.status(400).json({ error: 'Invalid limit parameter' });
        return;
      }

      const errors = await OrderErrorModel.getAll(limit);
      res.json(errors);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

