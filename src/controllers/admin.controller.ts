import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { UserModel } from '../models/User';
import { WebhookLogModel } from '../models/WebhookLog';
import { TradeModel } from '../models/Trade';
import OrderErrorModel from '../models/orderError.model';
import BitgetOperationLogModel from '../models/BitgetOperationLog';

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

  static async getWebhookLogSymbols(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }
      const strategyId = req.query.strategy_id != null ? parseInt(String(req.query.strategy_id), 10) : undefined;
      const symbols = await WebhookLogModel.getDistinctSymbols(isNaN(strategyId as number) ? undefined : strategyId);
      res.json({ symbols });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** Elimina un webhook log por id. */
  static async deleteWebhookLog(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid log id' });
        return;
      }
      const deleted = await WebhookLogModel.deleteById(id);
      if (!deleted) {
        res.status(404).json({ error: 'Webhook log not found' });
        return;
      }
      res.json({ message: 'Log deleted', id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** Elimina todos los logs de un trade (grupo por strategy_id + symbol + trade_id). */
  static async deleteWebhookLogGroup(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }
      const strategyId = parseInt(String(req.body.strategy_id ?? req.query.strategy_id), 10);
      const symbol = String(req.body.symbol ?? req.query.symbol ?? '').trim();
      const tradeId = String(req.body.trade_id ?? req.query.trade_id ?? '').trim();
      if (!Number.isInteger(strategyId) || !symbol || !tradeId) {
        res.status(400).json({ error: 'strategy_id, symbol and trade_id are required' });
        return;
      }
      const deleted = await WebhookLogModel.deleteGroup(strategyId, symbol, tradeId);
      res.json({ message: 'Group deleted', deleted });
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
            console.log(`[AdminController] Error ${error.id} ya tiene alert_data, omitiendo búsqueda en webhook_logs`);
            return error;
          }

          console.log(`[AdminController] 🔍 Buscando webhook log para error ${error.id}: strategy_id=${error.strategy_id}, trade_id=${error.trade_id}, symbol=${error.symbol}`);

          // Buscar el webhook log por trade_id y symbol
          try {
            const webhookLog = await WebhookLogModel.findByTradeIdAndSymbol(
              error.strategy_id,
              error.trade_id,
              error.symbol
            );

            if (webhookLog && webhookLog.payload) {
              console.log(`[AdminController] ✅ Webhook log encontrado para error ${error.id}, parseando payload...`);
              
              // Parsear el payload del webhook log
              try {
                const payload = typeof webhookLog.payload === 'string' 
                  ? JSON.parse(webhookLog.payload) 
                  : webhookLog.payload;
                
                console.log(`[AdminController] ✅ Payload parseado exitosamente para error ${error.id}`);
                
                // Agregar el payload como alert_data si no existe
                return {
                  ...error,
                  alert_data: payload,
                };
              } catch (parseError: any) {
                console.error(`[AdminController] ❌ Error parsing webhook payload for error ${error.id}:`, parseError.message);
                console.error(`[AdminController] Payload (first 200 chars):`, webhookLog.payload?.substring(0, 200));
                return error;
              }
            } else {
              console.log(`[AdminController] ⚠️ No se encontró webhook log para error ${error.id}`);
            }
          } catch (webhookError: any) {
            console.error(`[AdminController] ❌ Error fetching webhook log for error ${error.id}:`, webhookError.message);
            console.error(`[AdminController] Stack:`, webhookError.stack);
          }

          return error;
        })
      );

      res.json(errorsWithWebhookData);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getBitgetOperationLogs(req: AuthRequest, res: Response): Promise<void> {
    try {
      // Endpoint público - sin autenticación requerida
      const limitParam = req.query.limit as string;
      const limit = limitParam ? parseInt(limitParam, 10) : 100;
      
      if (isNaN(limit) || limit < 1) {
        res.status(400).json({ error: 'Invalid limit parameter' });
        return;
      }

      const symbol = req.query.symbol as string | undefined;
      const reviewedParam = req.query.reviewed as string | undefined; // Filtrar por revisado/no revisado
      
      // Convertir el parámetro reviewed a boolean si está presente
      let reviewed: boolean | undefined = undefined;
      if (reviewedParam !== undefined) {
        reviewed = reviewedParam === 'true' || reviewedParam === '1';
      }
      
      let logs;
      if (symbol) {
        logs = await BitgetOperationLogModel.getBySymbol(symbol, limit, reviewed);
      } else {
        logs = await BitgetOperationLogModel.getAll(limit, reviewed);
      }

      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async markLogAsReviewed(req: AuthRequest, res: Response): Promise<void> {
    try {
      // Endpoint público - sin autenticación requerida
      const logId = parseInt(req.params.id, 10);
      
      if (isNaN(logId) || logId < 1) {
        res.status(400).json({ error: 'Invalid log ID' });
        return;
      }

      await BitgetOperationLogModel.markAsReviewed(logId);
      res.json({ success: true, message: 'Log marcado como revisado' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async markLogAsUnreviewed(req: AuthRequest, res: Response): Promise<void> {
    try {
      // Endpoint público - sin autenticación requerida
      const logId = parseInt(req.params.id, 10);
      
      if (isNaN(logId) || logId < 1) {
        res.status(400).json({ error: 'Invalid log ID' });
        return;
      }

      await BitgetOperationLogModel.markAsUnreviewed(logId);
      res.json({ success: true, message: 'Log marcado como no revisado' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

