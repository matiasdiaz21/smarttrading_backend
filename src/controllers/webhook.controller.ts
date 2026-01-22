import { Response } from 'express';
import { StrategyModel } from '../models/Strategy';
import { WebhookLogModel } from '../models/WebhookLog';
import { TradingService } from '../services/trading.service';
import { verifyHMAC } from '../utils/hmac';
import { TradingViewAlert } from '../types';

export class WebhookController {
  static async tradingView(req: any, res: Response): Promise<void> {
    const { strategy_id } = req.params;
    let webhookLogId: number | null = null;

    try {
      // Obtener estrategia
      const strategy = await StrategyModel.findById(parseInt(strategy_id));
      if (!strategy) {
        res.status(404).json({ error: 'Strategy not found' });
        return;
      }

      if (!strategy.is_active) {
        res.status(400).json({ error: 'Strategy is not active' });
        return;
      }

      // Obtener payload y firma
      const payload = JSON.stringify(req.body);
      const signature = req.headers['x-signature'] || req.headers['x-tradingview-signature'] || '';

      // Verificar HMAC
      const isValid = verifyHMAC(
        payload,
        signature,
        strategy.tradingview_webhook_secret
      );

      // Registrar webhook
      webhookLogId = await WebhookLogModel.create(
        parseInt(strategy_id),
        payload,
        signature || null,
        isValid ? 'success' : 'invalid'
      );

      if (!isValid) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      // Parsear alerta de TradingView
      const alert: TradingViewAlert = {
        symbol: req.body.symbol || req.body.ticker,
        side: req.body.side || (req.body.action === 'buy' ? 'buy' : 'sell'),
        orderType: req.body.orderType || req.body.type || 'market',
        size: req.body.size || req.body.quantity,
        price: req.body.price,
        productType: req.body.productType || 'USDT-FUTURES',
        marginMode: req.body.marginMode || 'isolated',
        marginCoin: req.body.marginCoin || 'USDT',
        tradeSide: req.body.tradeSide || 'open',
        force: req.body.force,
        ...req.body,
      };

      // Validar datos mínimos
      if (!alert.symbol || !alert.side) {
        res.status(400).json({
          error: 'Missing required fields: symbol and side are required',
        });
        return;
      }

      // Procesar alerta
      const tradingService = new TradingService();
      const result = await tradingService.processStrategyAlert(
        parseInt(strategy_id),
        alert
      );

      res.json({
        message: 'Webhook processed successfully',
        processed: result.processed,
        successful: result.successful,
        failed: result.failed,
      });
    } catch (error: any) {
      // Actualizar log si existe
      if (webhookLogId) {
        try {
          await WebhookLogModel.create(
            parseInt(strategy_id),
            JSON.stringify(req.body),
            req.headers['x-signature'] || null,
            'failed'
          );
        } catch (logError) {
          // Ignorar error de log
        }
      }

      res.status(500).json({ error: error.message });
    }
  }
}

