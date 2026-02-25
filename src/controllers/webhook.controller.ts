import { Response } from 'express';
import { StrategyModel } from '../models/Strategy';
import { WebhookLogModel } from '../models/WebhookLog';
import { TradingService } from '../services/trading.service';
import { verifyHMAC } from '../utils/hmac';
import { TradingViewAlert } from '../types';
import { TradeModel } from '../models/Trade';
import { SubscriptionModel } from '../models/Subscription';

export class WebhookController {
  static async tradingView(req: any, res: Response): Promise<void> {
    let webhookLogId: number | null = null;
    let strategy: any = null;

    // Logging inicial detallado
    console.log(`\n========== WEBHOOK RECIBIDO ==========`);
    console.log(`[Webhook] Timestamp: ${new Date().toISOString()}`);
    console.log(`[Webhook] Method: ${req.method}`);
    console.log(`[Webhook] Path: ${req.path}`);
    console.log(`[Webhook] URL completa: ${req.protocol}://${req.get('host')}${req.originalUrl}`);
    console.log(`[Webhook] IP: ${req.ip}`);
    console.log(`[Webhook] User-Agent: ${req.get('user-agent') || 'not provided'}`);
    
    // Headers completos
    console.log(`\n[Webhook] Headers:`);
    console.log(JSON.stringify({
      'x-signature': req.headers['x-signature'] || 'missing',
      'x-tradingview-signature': req.headers['x-tradingview-signature'] || 'missing',
      'content-type': req.headers['content-type'] || 'missing',
      'content-length': req.headers['content-length'] || 'missing',
      'authorization': req.headers['authorization'] ? 'present' : 'missing',
    }, null, 2));
    
    // Body completo
    console.log(`\n[Webhook] Body completo:`);
    if (req.body) {
      console.log(JSON.stringify(req.body, null, 2));
      console.log(`[Webhook] Body keys:`, Object.keys(req.body));
      console.log(`[Webhook] Body type:`, typeof req.body);
    } else {
      console.log('[Webhook] Body: null o undefined');
    }
    
    // Raw body si está disponible
    if ((req as any).rawBody) {
      console.log(`\n[Webhook] Raw Body (primeros 500 chars):`);
      console.log(String((req as any).rawBody).substring(0, 500));
    }
    
    console.log(`========================================\n`);

    try {
      // Obtener payload
      const payload = JSON.stringify(req.body);
      const signature = req.headers['x-signature'] || req.headers['x-tradingview-signature'] || null;

      console.log(`\n[Webhook] Validando estrategia por nombre...`);
      console.log(`[Webhook] Strategy name en body: ${req.body.strategy || 'MISSING'}`);
      console.log(`[Webhook] Payload length: ${payload.length} chars`);

      // Obtener el nombre de la estrategia del body
      const strategyNameFromBody = req.body.strategy;
      if (!strategyNameFromBody) {
        console.error('[Webhook] ⚠️ No se encontró el campo "strategy" en el body');
        res.status(400).json({ 
          error: 'Missing strategy name in body',
          message: 'El campo "strategy" es requerido en el body de la petición'
        });
        return;
      }

      // Buscar la estrategia por nombre (solo activas)
      const strategies = await StrategyModel.findAll(false); // Solo activas
      console.log(`[Webhook] Found ${strategies.length} active strategies in database`);

      // Si no hay estrategias, retornar error
      if (!strategies || strategies.length === 0) {
        console.error('[Webhook] ⚠️ No active strategies found in database');
        console.error('[Webhook] ⚠️ La señal NO será procesada porque no hay estrategias activas configuradas');
        
        try {
          const logId = await WebhookLogModel.create(
            null,
            payload,
            signature,
            'failed'
          );
          console.log(`[Webhook] ✅ Webhook registrado en logs (ID: ${logId}, status: failed)`);
        } catch (logError: any) {
          console.error('[Webhook] ❌ Error al registrar webhook en logs:', logError.message);
        }
        
        res.status(404).json({ 
          error: 'No active strategies found',
          message: 'No hay estrategias activas configuradas en la base de datos.',
          signal_received: true,
          alert_type: req.body.alertType || 'ENTRY'
        });
        return;
      }

      // Mostrar información de las estrategias
      console.log(`[Webhook] Estrategias activas encontradas:`);
      strategies.forEach((s, index) => {
        console.log(`  ${index + 1}. ID: ${s.id}, Name: "${s.name}", Active: ${s.is_active}`);
      });

      // Buscar estrategia por nombre (case-insensitive)
      strategy = strategies.find(s => 
        s.name.toLowerCase().trim() === strategyNameFromBody.toLowerCase().trim()
      );

      if (!strategy) {
        console.warn(`[Webhook] ⚠️ Estrategia no encontrada: "${strategyNameFromBody}"`);
        console.warn(`[Webhook] ⚠️ Estrategias disponibles: ${strategies.map(s => `"${s.name}"`).join(', ')}`);
        
        // Registrar el webhook como inválido
        try {
          const logId = await WebhookLogModel.create(
            null,
            payload,
            signature,
            'invalid'
          );
          console.log(`[Webhook] ✅ Webhook registrado en logs (ID: ${logId}, status: invalid)`);
        } catch (logError: any) {
          console.error('[Webhook] ❌ Error al registrar webhook en logs:', logError.message);
        }
        
        res.status(404).json({ 
          error: 'Strategy not found',
          message: `La estrategia "${strategyNameFromBody}" no está registrada o no está activa.`,
          available_strategies: strategies.map(s => s.name),
          signal_received: true,
          alert_type: req.body.alertType || 'ENTRY'
        });
        return;
      }

      console.log(`[Webhook] ✅ Estrategia encontrada: ${strategy.name} (ID: ${strategy.id})`);
      const isValid = true; // Si encontramos la estrategia por nombre, es válida

      // Obtener el tipo de alerta para decidir si registrar
      const alertType = req.body.alertType || req.body.alert_type || 'ENTRY';
      
      // Para STOP_LOSS y TAKE_PROFIT, no registrar aún (se registrará después si hay ENTRY previo)
      const shouldLogNow = alertType !== 'STOP_LOSS' && alertType !== 'TAKE_PROFIT';
      
      // Registrar webhook solo si no es STOP_LOSS o TAKE_PROFIT
      if (shouldLogNow) {
        try {
          webhookLogId = await WebhookLogModel.create(
            strategy.id,
            payload,
            signature,
            'success'
          );
          console.log(`[Webhook] ✅ Webhook log creado con ID: ${webhookLogId}, strategy_id: ${strategy.id}`);
        } catch (logError: any) {
          console.error('[Webhook] ❌ Error creating webhook log:', logError.message);
          // Continuar aunque falle el log
        }
      } else {
        console.log(`[Webhook] ⏳ Alert tipo ${alertType} - se verificará ENTRY previo antes de registrar en logs`);
      }

      console.log(`\n[Webhook] ✅ ✅ ✅ SEÑAL VÁLIDA - PROCESANDO ✅ ✅ ✅`);
      console.log(`[Webhook] Estrategia validada: ${strategy.name} (ID: ${strategy.id})`);

      // Parsear alerta de TradingView
      // Normalizar alertType primero (antes de crear el objeto alert)
      let rawAlertType = req.body.alertType || req.body.alert_type || 'ENTRY';
      // Normalizar a mayúsculas para comparaciones consistentes
      rawAlertType = String(rawAlertType).toUpperCase().trim();
      
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
        alertType: rawAlertType as 'ENTRY' | 'BREAKEVEN' | 'STOP_LOSS' | 'TAKE_PROFIT',
        entryPrice: req.body.entryPrice || req.body.entry_price,
        stopLoss: req.body.stopLoss || req.body.stop_loss,
        takeProfit: req.body.takeProfit || req.body.take_profit,
        breakeven: req.body.breakeven,
        trade_id: req.body.alertData?.id || req.body.trade_id,
        strategy: req.body.strategy,
        timeframe: req.body.timeframe,
        ...req.body,
      };
      
      // Asegurar que alertType no se sobrescriba por req.body
      alert.alertType = rawAlertType as 'ENTRY' | 'BREAKEVEN' | 'STOP_LOSS' | 'TAKE_PROFIT';

      // Normalizar side (LONG/SHORT a buy/sell)
      if (alert.side === 'LONG') {
        alert.side = 'buy';
      } else if (alert.side === 'SHORT') {
        alert.side = 'sell';
      }
      
      console.log(`[Webhook] 📋 AlertType normalizado: "${alert.alertType}" (original: "${req.body.alertType || req.body.alert_type || 'N/A'}")`);

      // Validar datos mínimos según el tipo de alerta
      if (!alert.symbol) {
        res.status(400).json({
          error: 'Missing required field: symbol is required',
        });
        return;
      }

      // Procesar alerta según su tipo
      const tradingService = new TradingService();
      let result;

      if (alert.alertType === 'ENTRY') {
        console.log(`\n[Webhook] 📊 Procesando alerta tipo: ENTRY`);
        console.log(`[Webhook] Symbol: ${alert.symbol}, Side: ${alert.side}`);
        console.log(`[Webhook] Entry Price: ${alert.entryPrice}, Stop Loss: ${alert.stopLoss}, Take Profit: ${alert.takeProfit}`);
        console.log(`[Webhook] Trade ID: ${alert.trade_id}, Breakeven: ${alert.breakeven}`);
        
        // Validar campos requeridos para ENTRY
        if (!alert.side || !alert.entryPrice || !alert.stopLoss || !alert.takeProfit) {
          console.error(`[Webhook] ❌ Campos faltantes para ENTRY:`);
          console.error(`[Webhook]   side: ${alert.side ? '✅ OK' : '❌ MISSING'}`);
          console.error(`[Webhook]   entryPrice: ${alert.entryPrice ? '✅ OK' : '❌ MISSING'}`);
          console.error(`[Webhook]   stopLoss: ${alert.stopLoss ? '✅ OK' : '❌ MISSING'}`);
          console.error(`[Webhook]   takeProfit: ${alert.takeProfit ? '✅ OK' : '❌ MISSING'}`);
          res.status(400).json({
            error: 'Missing required fields for ENTRY: side, entryPrice, stopLoss, and takeProfit are required',
          });
          return;
        }
        
        console.log(`[Webhook] ✅ Todos los campos requeridos presentes`);
        console.log(`[Webhook] 🚀 Ejecutando processStrategyAlert para estrategia ${strategy.id}...`);
        result = await tradingService.processStrategyAlert(
          strategy.id,
          alert
        );
        console.log(`[Webhook] ✅ Resultado del procesamiento:`, JSON.stringify(result, null, 2));
        if (webhookLogId && result.fillEntryPrice != null && result.fillNotional != null) {
          try {
            await WebhookLogModel.updatePayload(webhookLogId, {
              actual_entry_price: result.fillEntryPrice,
              actual_notional: result.fillNotional,
            });
            console.log(`[Webhook] ✅ Log ${webhookLogId} actualizado con fill real: entry=${result.fillEntryPrice}, notional=${result.fillNotional}`);
          } catch (upErr: any) {
            console.warn(`[Webhook] ⚠️ No se pudo actualizar log con fill: ${upErr.message}`);
          }
        }
      } else if (
        String(alert.alertType || '').toUpperCase() === 'CLOSE' || 
        String(alert.alertType || '').toUpperCase() === 'STOP_LOSS' || 
        String(alert.alertType || '').toUpperCase() === 'TAKE_PROFIT'
      ) {
        console.log(`[Webhook] � Procesando alerta de ${alert.alertType} (Cierre de posición y triggers)`);
        if (!alert.symbol) {
          res.status(400).json({
            error: `Missing required field for ${alert.alertType}: symbol is required`,
          });
          return;
        }
        result = await tradingService.processCloseAlert(
          strategy.id,
          alert
        );
        // Registrar STOP_LOSS/TAKE_PROFIT en webhook_log siempre (aunque Bitget falle), para tener trazabilidad
        try {
          const closeStatus = result.failed === 0 ? 'success' : 'failed';
          const logId = await WebhookLogModel.create(strategy.id, payload, signature, closeStatus);
          console.log(`[Webhook] ✅ Webhook log creado para ${alert.alertType} (ID: ${logId}, status: ${closeStatus}, processed: ${result.processed}, failed: ${result.failed})`);
        } catch (logError: any) {
          console.error('[Webhook] ❌ Error creando webhook log para cierre:', logError.message);
        }
      } else {
        // Por defecto, tratar como ENTRY (compatibilidad hacia atrás)
        // PERO: Si es TAKE_PROFIT o STOP_LOSS, NO ejecutar órdenes
        const alertTypeUpper = String(alert.alertType || '').toUpperCase();
        if (alertTypeUpper === 'TAKE_PROFIT' || alertTypeUpper === 'STOP_LOSS') {
          console.warn(`[Webhook] ⚠️ AlertType "${alert.alertType}" detectado en caso por defecto. No se ejecutarán órdenes para este tipo de alerta.`);
          console.warn(`[Webhook] ⚠️ Esta alerta solo debe ser informativa. Verificando si hay ENTRY previo...`);
          
          // Verificar si hay ENTRY previo
          let hasEntry = false;
          if (alert.trade_id) {
            hasEntry = await WebhookLogModel.hasEntryForTradeId(strategy.id, alert.trade_id);
          }
          if (!hasEntry && alert.symbol) {
            hasEntry = await WebhookLogModel.hasEntryForSymbol(strategy.id, alert.symbol);
          }
          
          if (hasEntry) {
            console.log(`[Webhook] ✅ ENTRY previo encontrado. Procesando como alerta informativa.`);
            result = await tradingService.processInfoAlert(strategy.id, alert);
          } else {
            console.warn(`[Webhook] ⚠️ No se encontró ENTRY previo. La alerta será ignorada.`);
            result = {
              processed: 0,
              successful: 0,
              failed: 0,
            };
          }
        } else {
          // Solo ejecutar órdenes para ENTRY o tipos desconocidos (compatibilidad hacia atrás)
          console.log(`[Webhook] 📊 Procesando como ENTRY (tipo: ${alert.alertType || 'desconocido'})`);
          result = await tradingService.processStrategyAlert(
            strategy.id,
            alert
          );
        }
      }

      res.json({
        message: 'Webhook processed successfully',
        processed: result.processed,
        successful: result.successful,
        failed: result.failed,
      });
    } catch (error: any) {
      console.error('Webhook error:', error);
      
      // Intentar registrar el error en el log
      try {
        const strategyId = strategy ? strategy.id : 0;
        await WebhookLogModel.create(
          strategyId,
          JSON.stringify(req.body),
          req.headers['x-signature'] || req.headers['x-tradingview-signature'] || null,
          'failed'
        );
      } catch (logError) {
        console.error('Error creating error log:', logError);
        // Ignorar error de log
      }

      // Retornar error con más detalles en desarrollo
      const errorMessage = process.env.NODE_ENV === 'development' 
        ? error.message 
        : 'Internal server error';
      
      res.status(500).json({ 
        error: errorMessage,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    }
  }

  // Endpoint de prueba para verificar que el webhook está funcionando
  static async test(req: any, res: Response): Promise<void> {
    try {
      res.json({
        message: 'Webhook endpoint is working',
        timestamp: new Date().toISOString(),
        method: req.method,
        hasBody: !!req.body,
        bodyKeys: req.body ? Object.keys(req.body) : [],
        headers: {
          'x-signature': req.headers['x-signature'] || 'not provided',
          'x-tradingview-signature': req.headers['x-tradingview-signature'] || 'not provided',
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

