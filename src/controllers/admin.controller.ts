import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { UserModel } from '../models/User';
import { PaymentSubscriptionModel } from '../models/PaymentSubscription';
import { WebhookLogModel } from '../models/WebhookLog';
import { TradeModel } from '../models/Trade';
import OrderErrorModel from '../models/orderError.model';
import BitgetOperationLogModel from '../models/BitgetOperationLog';
import { CredentialsModel } from '../models/Credentials';
import { BitgetService } from '../services/bitget.service';

const bitgetService = new BitgetService();

/** Comisiones por defecto Bitget futuros (maker 0.02%, taker 0.06%) */
const DEFAULT_FEE = { maker: 0.0002, taker: 0.0006 };

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

  static async giftSubscription(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }
      const userId = parseInt(req.params.id, 10);
      if (isNaN(userId)) {
        res.status(400).json({ error: 'Invalid user id' });
        return;
      }
      const months = req.body?.months;
      if (![1, 3, 6].includes(months)) {
        res.status(400).json({ error: 'months must be 1, 3 or 6' });
        return;
      }
      const expiresAt = await PaymentSubscriptionModel.createGift(userId, months);
      await UserModel.updateSubscription(userId, 'active', expiresAt);
      res.json({ ok: true, expires_at: expiresAt.toISOString() });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Error al regalar suscripción' });
    }
  }

  static async getWebhookLogs(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }

      const { strategy_id, strategy_ids } = req.query;
      const rawLimit = req.query.limit;
      const limitStr = rawLimit != null && rawLimit !== '' ? String(rawLimit).toLowerCase() : '';
      const limitUnlimited =
        rawLimit === undefined ||
        rawLimit === '' ||
        limitStr === 'all';
      const limitParsed = limitUnlimited
        ? undefined
        : (() => {
            const n = parseInt(String(rawLimit), 10);
            return Number.isInteger(n) && n > 0 ? n : undefined;
          })();

      let logs;
      if (strategy_ids && typeof strategy_ids === 'string' && strategy_ids.trim()) {
        const ids = strategy_ids.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && Number.isInteger(n));
        logs = ids.length > 0 ? await WebhookLogModel.findByStrategyIds(ids, limitParsed) : await WebhookLogModel.findAll(limitParsed);
      } else if (strategy_id) {
        logs = await WebhookLogModel.findByStrategyId(
          parseInt(strategy_id as string),
          limitParsed
        );
      } else {
        logs = await WebhookLogModel.findAll(limitParsed);
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

  /**
   * GET /api/admin/bitget/fee-rate
   * Obtiene las comisiones de trading desde la API de Bitget (cuenta del admin).
   * Si no hay credenciales o falla la llamada, devuelve las tasas por defecto de Bitget futuros.
   */
  static async getBitgetFeeRate(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }
      const userId = req.user.userId;
      const list = await CredentialsModel.findAllActiveByUserId(userId);
      const cred = list && list.length > 0 ? list[0] : null;
      if (!cred) {
        res.json({ maker: DEFAULT_FEE.maker, taker: DEFAULT_FEE.taker, source: 'default' });
        return;
      }
      const decrypted = BitgetService.getDecryptedCredentials({
        api_key: cred.api_key,
        api_secret: cred.api_secret,
        passphrase: cred.passphrase,
      });
      const rates = await bitgetService.getTradeFeeRate(decrypted);
      if (rates) {
        res.json({ maker: rates.maker, taker: rates.taker, source: 'bitget' });
        return;
      }
      res.json({ maker: DEFAULT_FEE.maker, taker: DEFAULT_FEE.taker, source: 'default' });
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

  /** Elimina todos los logs de un símbolo (grupo completo del símbolo). */
  static async deleteWebhookLogSymbolGroup(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }
      const symbol = String(req.body.symbol ?? req.query.symbol ?? '').trim();
      if (!symbol) {
        res.status(400).json({ error: 'symbol is required' });
        return;
      }
      const deleted = await WebhookLogModel.deleteBySymbol(symbol);
      res.json({ message: 'Symbol group deleted', deleted });
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

  /** Logs Bitget HTTP del usuario autenticado (admin) filtrados por trade_id (cruce con webhooks). */
  static async getBitgetOperationLogsByTradeId(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }
      const tradeId = (req.params.tradeId || '').trim();
      if (!tradeId || tradeId === 'N/A') {
        res.status(400).json({ error: 'Invalid tradeId' });
        return;
      }
      const limitParam = req.query.limit as string;
      const limit = limitParam ? parseInt(limitParam, 10) : 200;
      if (isNaN(limit) || limit < 1 || limit > 500) {
        res.status(400).json({ error: 'Invalid limit (1–500)' });
        return;
      }
      const logs = await BitgetOperationLogModel.getByUserAndTradeId(req.user.id, tradeId, limit);
      res.json({ trade_id: tradeId, logs });
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

