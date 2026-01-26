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
      
      // Para cada error, intentar obtener el payload del webhook log si no está en alert_data
      const errorsWithWebhookData = await Promise.all(
        errors.map(async (error) => {
          // Si ya tiene alert_data, no buscar en webhook_logs
          if (error.alert_data) {
            return error;
          }

          // Buscar el webhook log por trade_id y symbol
          try {
            const webhookLog = await WebhookLogModel.findByTradeIdAndSymbol(
              error.strategy_id,
              error.trade_id,
              error.symbol
            );

            if (webhookLog && webhookLog.payload) {
              // Parsear el payload del webhook log
              try {
                const payload = typeof webhookLog.payload === 'string' 
                  ? JSON.parse(webhookLog.payload) 
                  : webhookLog.payload;
                
                // Agregar el payload como alert_data si no existe
                return {
                  ...error,
                  alert_data: payload,
                };
              } catch (parseError) {
                console.error(`[AdminController] Error parsing webhook payload for error ${error.id}:`, parseError);
                return error;
              }
            }
          } catch (webhookError) {
            console.error(`[AdminController] Error fetching webhook log for error ${error.id}:`, webhookError);
          }

          return error;
        })
      );

      res.json(errorsWithWebhookData);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

