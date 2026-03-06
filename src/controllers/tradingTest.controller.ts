import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { BitgetService } from '../services/bitget.service';
import { CredentialsModel } from '../models/Credentials';

const bitgetService = new BitgetService();

export class TradingTestController {
  /**
   * POST /api/admin/trading/test-open
   * Abre una posición de prueba con el flujo optimizado (SL preset + TPs parciales)
   */
  static async testOpenPosition(req: AuthRequest, res: Response): Promise<void> {
    try {
      const {
        credential_id,
        symbol,
        side,
        size,
        entry_price,
        stop_loss,
        take_profit,
        take_profit_partial,
        order_type,
        margin_mode,
        product_type,
        margin_coin,
        simulate_tv_alert,
        open_mode,
      } = req.body;

      // Validaciones
      if (!credential_id || !symbol || !side || !size || !stop_loss || !take_profit) {
        res.status(400).json({ error: 'Campos requeridos: credential_id, symbol, side, size, stop_loss, take_profit' });
        return;
      }
      // open_mode: 'preset' = 1 llamada (place-order con preset SL+TP); 'trigger' = place-order + place-tpsl + 2x place-plan.
      const explicitPreset = open_mode === 'preset' || !!simulate_tv_alert;
      const explicitTrigger = open_mode === 'trigger';
      const singleCall = explicitPreset;
      const useLimitPartial = !singleCall && (explicitTrigger ? !!(entry_price && (take_profit_partial || take_profit)) : !!(order_type === 'limit' && entry_price && take_profit_partial));
      if (open_mode === 'trigger' && !take_profit_partial && !take_profit) {
        res.status(400).json({ error: 'Para open_mode=trigger se requiere take_profit_partial (o se usará take_profit como TP parcial)' });
        return;
      }
      if (!singleCall && !explicitTrigger && take_profit_partial && (!entry_price || order_type !== 'limit')) {
        res.status(400).json({ error: 'Para TP parcial 50%+50% se requiere order_type=limit y entry_price' });
        return;
      }

      if (!['buy', 'sell'].includes(side)) {
        res.status(400).json({ error: 'side debe ser buy o sell' });
        return;
      }

      // Obtener credenciales del admin
      const userId = req.user!.userId;
      const credentials = await CredentialsModel.findById(credential_id, userId);
      if (!credentials) {
        res.status(404).json({ error: 'Credencial no encontrada o no pertenece al usuario' });
        return;
      }

      const decryptedCredentials = BitgetService.getDecryptedCredentials({
        api_key: credentials.api_key,
        api_secret: credentials.api_secret,
        passphrase: credentials.passphrase,
      });

      const productType = (product_type || 'USDT-FUTURES').toUpperCase();
      const marginCoin = (margin_coin || 'USDT').toUpperCase();

      // Obtener info del contrato
      let contractInfo: any = null;
      try {
        contractInfo = await bitgetService.getContractInfo(symbol.toUpperCase(), productType);
      } catch (e: any) {
        console.warn(`[TestOrder] No se pudo obtener contractInfo: ${e.message}`);
      }

      // Calcular tamaño correcto
      let calculatedSize = size.toString();
      if (contractInfo) {
        calculatedSize = bitgetService.calculateOrderSize(
          size,
          contractInfo.minTradeNum,
          contractInfo.sizeMultiplier
        );
      }

      const timestamp = Date.now();
      const clientOid = `TEST_${symbol.substring(0, 8)}_${timestamp}_${Math.floor(Math.random() * 10000)}`.substring(0, 64);

      // Simular alerta TV: siempre 1 llamada (market + preset SL+TP). Sin TP parcial.
      const effectiveOrderType = singleCall ? 'market' : (useLimitPartial ? 'limit' : (order_type || 'market'));
      const effectivePrice = singleCall ? '' : (useLimitPartial ? String(entry_price || '') : (entry_price ? String(entry_price) : undefined));

      let calculatedPartialPrice: number | undefined;
      if (!singleCall) {
        calculatedPartialPrice = take_profit_partial ? parseFloat(take_profit_partial) : undefined;
        if (!calculatedPartialPrice && (useLimitPartial || explicitTrigger) && entry_price && take_profit) {
          const entryNum = parseFloat(entry_price);
          const tpNum = parseFloat(take_profit);
          calculatedPartialPrice = entryNum + (tpNum - entryNum) / 2;
          console.log(`[TestOrder] 📊 TP Parcial calculado automáticamente (50% de recorrido): ${calculatedPartialPrice}`);
        }
        if (explicitTrigger && !calculatedPartialPrice) {
          calculatedPartialPrice = parseFloat(take_profit);
        }
      }

      const tpslPayload: { stopLossPrice: number; takeProfitPrice: number; takeProfitPartialPrice?: number } = {
        stopLossPrice: parseFloat(stop_loss),
        takeProfitPrice: parseFloat(take_profit),
      };
      if (calculatedPartialPrice) tpslPayload.takeProfitPartialPrice = calculatedPartialPrice;

      const t0 = Date.now();
      const result = await bitgetService.openPositionWithFullTPSL(
        decryptedCredentials,
        {
          symbol: symbol.toUpperCase(),
          productType,
          marginMode: margin_mode || 'isolated',
          marginCoin,
          size: calculatedSize,
          price: (effectivePrice ?? '') as string,
          side,
          orderType: effectiveOrderType as 'limit' | 'market',
          clientOid,
        },
        tpslPayload,
        contractInfo,
        { userId, strategyId: null }
      );
      const durationMs = Date.now() - t0;

      res.json({
        success: result.success,
        orderId: result.orderId,
        method: result.method,
        calculatedSize,
        durationMs,
        bitgetApiCalls: result.bitgetApiCalls,
        contractInfo: contractInfo ? {
          minTradeNum: contractInfo.minTradeNum,
          sizeMultiplier: contractInfo.sizeMultiplier,
          pricePlace: contractInfo.pricePlace,
          volumePlace: contractInfo.volumePlace,
        } : null,
        steps: result.tpslResults,
        error: result.error,
        payloads: result.payloads ?? undefined,
      });
    } catch (error: any) {
      console.error('[TestOrder] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * POST /api/admin/trading/test-breakeven
   * Prueba mover el SL a breakeven (sin cerrar 50%)
   */
  static async testBreakeven(req: AuthRequest, res: Response): Promise<void> {
    try {
      const {
        credential_id,
        symbol,
        side,
        new_stop_loss,
        product_type,
        margin_coin,
      } = req.body;

      if (!credential_id || !symbol || !side || !new_stop_loss) {
        res.status(400).json({ error: 'Campos requeridos: credential_id, symbol, side, new_stop_loss' });
        return;
      }

      const userId = req.user!.userId;
      const credentials = await CredentialsModel.findById(credential_id, userId);
      if (!credentials) {
        res.status(404).json({ error: 'Credencial no encontrada' });
        return;
      }

      const decryptedCredentials = BitgetService.getDecryptedCredentials({
        api_key: credentials.api_key,
        api_secret: credentials.api_secret,
        passphrase: credentials.passphrase,
      });

      const productType = (product_type || 'USDT-FUTURES').toUpperCase();
      const marginCoin = (margin_coin || 'USDT').toUpperCase();

      // Obtener info del contrato y posición actual
      let contractInfo: any = null;
      try {
        contractInfo = await bitgetService.getContractInfo(symbol.toUpperCase(), productType);
      } catch (_) {}

      // Obtener tamaño actual de la posición
      const positions = await bitgetService.getPositions(decryptedCredentials, symbol.toUpperCase(), productType);
      const holdSide = side === 'buy' ? 'long' : 'short';
      const currentPosition = Array.isArray(positions) 
        ? positions.find((p: any) => p.symbol === symbol.toUpperCase() && p.holdSide === holdSide)
        : null;

      if (!currentPosition) {
        res.status(400).json({ error: `No hay posición ${holdSide} abierta para ${symbol}` });
        return;
      }

      const positionSize = currentPosition.total || currentPosition.available || currentPosition.size || '0';

      const result = await bitgetService.moveStopLossToBreakeven(
        decryptedCredentials,
        symbol.toUpperCase(),
        side,
        parseFloat(new_stop_loss),
        positionSize,
        productType,
        marginCoin,
        contractInfo,
        { userId, strategyId: null }
      );

      res.json({
        success: result.success,
        positionSize,
        newStopLoss: new_stop_loss,
        steps: result.steps,
      });
    } catch (error: any) {
      console.error('[TestBreakeven] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * POST /api/admin/trading/test-breakeven-simulate
   * Simula breakeven: cierra 50% de la posición y mueve el SL al precio de entrada para el resto.
   */
  static async testBreakevenSimulate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const {
        credential_id,
        symbol,
        side,
        product_type,
        margin_coin,
        margin_mode,
      } = req.body;

      if (!credential_id || !symbol || !side) {
        res.status(400).json({ error: 'Campos requeridos: credential_id, symbol, side' });
        return;
      }

      const userId = req.user!.userId;
      const credentials = await CredentialsModel.findById(credential_id, userId);
      if (!credentials) {
        res.status(404).json({ error: 'Credencial no encontrada' });
        return;
      }

      const decryptedCredentials = BitgetService.getDecryptedCredentials({
        api_key: credentials.api_key,
        api_secret: credentials.api_secret,
        passphrase: credentials.passphrase,
      });

      const productType = (product_type || 'USDT-FUTURES').toUpperCase();
      const marginCoin = (margin_coin || 'USDT').toUpperCase();
      const holdSide = side === 'buy' ? 'long' : 'short';
      const closeSide = side === 'buy' ? 'sell' : 'buy';
      const symbolUpper = symbol.toUpperCase();

      const metrics = { apiCalls: 0 };
      const startMs = Date.now();

      let contractInfo: any = null;
      try {
        contractInfo = await bitgetService.getContractInfo(symbolUpper, productType, { metrics });
      } catch (_) {}

      const positions = await bitgetService.getPositions(decryptedCredentials, symbolUpper, productType, { metrics });
      const position = Array.isArray(positions)
        ? positions.find((p: any) => (p.symbol || p.symbolName) === symbolUpper && (p.holdSide || '').toLowerCase() === holdSide)
        : null;

      if (!position) {
        res.status(400).json({ error: `No hay posición ${holdSide} abierta para ${symbol}` });
        return;
      }

      const totalStr = position.total || position.available || position.openDelegateSize || '0';
      const totalNum = parseFloat(totalStr);
      const entryPrice = parseFloat(position.averageOpenPrice || position.openPriceAvg || '0');
      const marginMode = position.marginMode || margin_mode || 'isolated';
      const posMode = (position.posMode || position.holdMode || 'one_way_mode') as string;
      const isHedgeMode = posMode.toLowerCase() === 'hedge_mode';

      if (totalNum <= 0) {
        res.status(400).json({ error: 'Tamaño de posición inválido' });
        return;
      }

      const minTradeNum = contractInfo?.minTradeNum ? parseFloat(contractInfo.minTradeNum) : 0.001;
      const sizeMultiplier = contractInfo?.sizeMultiplier ? parseFloat(contractInfo.sizeMultiplier) : 0.001;
      const volumePlace = contractInfo?.volumePlace != null ? parseInt(contractInfo.volumePlace) : 3;

      const halfNum = totalNum / 2;
      const halfSizeStr = bitgetService.calculateOrderSize(
        String(halfNum),
        String(contractInfo?.minTradeNum ?? minTradeNum),
        String(contractInfo?.sizeMultiplier ?? sizeMultiplier)
      );
      const halfSizeNum = parseFloat(halfSizeStr);

      if (halfSizeNum < minTradeNum) {
        res.status(400).json({ error: `Posición demasiado pequeña para cerrar 50% (mínimo ${minTradeNum}). Total: ${totalStr}` });
        return;
      }
      if (halfSizeNum >= totalNum) {
        res.status(400).json({ error: '50% redondeado es >= total; no se puede dejar resto válido' });
        return;
      }

      const steps: Array<{ type: string; success: boolean; result?: any; error?: string }> = [];

      // 1) Cerrar 50% con market reduce
      // Bitget: en hedge_mode, close long = side=buy + tradeSide=close; close short = side=sell + tradeSide=close.
      // En one_way_mode, tradeSide se ignora: close long = side=sell + reduceOnly=YES.
      const closeOrderSide = isHedgeMode
        ? (holdSide === 'long' ? 'buy' : 'sell')
        : closeSide;
      const closeReduceOnly = isHedgeMode ? undefined : 'YES';
      try {
        await bitgetService.placeOrder(decryptedCredentials, {
          symbol: symbolUpper,
          productType,
          marginMode,
          marginCoin,
          size: halfSizeStr,
          side: closeOrderSide,
          tradeSide: 'close',
          orderType: 'market',
          holdSide,
          reduceOnly: closeReduceOnly,
        }, { userId, strategyId: null, metrics });
        steps.push({ type: 'close_50_percent', success: true, result: { closedSize: halfSizeStr } });
      } catch (closeErr: any) {
        steps.push({ type: 'close_50_percent', success: false, error: closeErr.message });
        res.status(400).json({
          success: false,
          error: `Error cerrando 50%: ${closeErr.message}`,
          steps,
          bitgetApiCalls: metrics.apiCalls,
          durationMs: Date.now() - startMs,
        });
        return;
      }

      const remainingNum = totalNum - halfSizeNum;
      const remainingSizeStr = bitgetService.calculateOrderSize(
        String(remainingNum),
        String(contractInfo?.minTradeNum ?? minTradeNum),
        String(contractInfo?.sizeMultiplier ?? sizeMultiplier)
      );

      // 2) Mover SL al precio de entrada para el resto
      const beResult = await bitgetService.moveStopLossToBreakeven(
        decryptedCredentials,
        symbolUpper,
        side,
        entryPrice,
        remainingSizeStr,
        productType,
        marginCoin,
        contractInfo,
        { userId, strategyId: null, metrics }
      );
      steps.push(...beResult.steps);

      const durationMs = Date.now() - startMs;
      res.json({
        success: beResult.success,
        closedSize: halfSizeStr,
        remainingSize: remainingSizeStr,
        entryPrice,
        steps,
        bitgetApiCalls: metrics.apiCalls,
        durationMs,
      });
    } catch (error: any) {
      console.error('[TestBreakevenSimulate] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * POST /api/admin/trading/test-close
   * Cierra una posición de prueba completamente
   */
  static async testClosePosition(req: AuthRequest, res: Response): Promise<void> {
    try {
      const {
        credential_id,
        symbol,
        side,
        product_type,
        margin_coin,
        margin_mode,
      } = req.body;

      if (!credential_id || !symbol || !side) {
        res.status(400).json({ error: 'Campos requeridos: credential_id, symbol, side' });
        return;
      }

      const userId = req.user!.userId;
      const credentials = await CredentialsModel.findById(credential_id, userId);
      if (!credentials) {
        res.status(404).json({ error: 'Credencial no encontrada' });
        return;
      }

      const decryptedCredentials = BitgetService.getDecryptedCredentials({
        api_key: credentials.api_key,
        api_secret: credentials.api_secret,
        passphrase: credentials.passphrase,
      });

      const productType = (product_type || 'USDT-FUTURES').toUpperCase();
      const marginCoin = (margin_coin || 'USDT').toUpperCase();

      const closeResult = await bitgetService.closePositionAndCancelTriggers(
        decryptedCredentials,
        {
          symbol: symbol.toUpperCase(),
          side,
          productType,
          marginMode: margin_mode || 'isolated'
        },
        { userId, strategyId: null }
      );

      if (!closeResult.success) {
        res.status(400).json({ error: closeResult.error || 'Error al cerrar posición y triggers' });
        return;
      }

      res.json({
        success: true,
        closedSize: closeResult.closedSize,
        cancelledTriggers: closeResult.cancelledTriggers,
        remainingTriggers: closeResult.remainingTriggers,
      });
    } catch (error: any) {
      console.error('[TestClose] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/admin/trading/positions
   * Obtiene las posiciones abiertas del usuario admin
   */
  static async getPositions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const credentialId = parseInt(req.query.credential_id as string);
      const productType = ((req.query.product_type as string) || 'USDT-FUTURES').toUpperCase();

      if (!credentialId) {
        res.status(400).json({ error: 'credential_id es requerido' });
        return;
      }

      const userId = req.user!.userId;
      const credentials = await CredentialsModel.findById(credentialId, userId);
      if (!credentials) {
        res.status(404).json({ error: 'Credencial no encontrada' });
        return;
      }

      const decryptedCredentials = BitgetService.getDecryptedCredentials({
        api_key: credentials.api_key,
        api_secret: credentials.api_secret,
        passphrase: credentials.passphrase,
      });

      const positions = await bitgetService.getPositions(decryptedCredentials, undefined, productType);
      const openPositions = Array.isArray(positions)
        ? positions
            .filter((p: any) => parseFloat(p.total || p.size || '0') > 0)
            .map((p: any) => ({
              ...p,
              averageOpenPrice: p.averageOpenPrice ?? p.openPriceAvg ?? p.openAvgPrice ?? null,
            }))
        : [];

      res.json(openPositions);
    } catch (error: any) {
      console.error('[TestPositions] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/admin/trading/pending-triggers
   * Obtiene órdenes trigger pendientes
   */
  static async getPendingTriggers(req: AuthRequest, res: Response): Promise<void> {
    try {
      const credentialId = parseInt(req.query.credential_id as string);
      const symbol = (req.query.symbol as string || '').toUpperCase();
      const productType = ((req.query.product_type as string) || 'USDT-FUTURES').toUpperCase();

      if (!credentialId || !symbol) {
        res.status(400).json({ error: 'credential_id y symbol son requeridos' });
        return;
      }

      const userId = req.user!.userId;
      const credentials = await CredentialsModel.findById(credentialId, userId);
      if (!credentials) {
        res.status(404).json({ error: 'Credencial no encontrada' });
        return;
      }

      const decryptedCredentials = BitgetService.getDecryptedCredentials({
        api_key: credentials.api_key,
        api_secret: credentials.api_secret,
        passphrase: credentials.passphrase,
      });

      const triggers = await bitgetService.getPendingTriggerOrders(decryptedCredentials, symbol, productType);
      res.json(triggers);
    } catch (error: any) {
      console.error('[TestTriggers] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * POST /api/admin/trading/cancel-triggers
   * Cancela todas las órdenes trigger (TP/SL) pendientes para un símbolo.
   * Útil cuando la posición se cerró por otro medio y quedaron triggers huérfanos.
   */
  static async cancelTriggers(req: AuthRequest, res: Response): Promise<void> {
    try {
      const {
        credential_id,
        symbol,
        product_type,
        margin_coin,
      } = req.body;

      if (!credential_id || !symbol) {
        res.status(400).json({ error: 'credential_id y symbol son requeridos' });
        return;
      }

      const userId = req.user!.userId;
      const credentials = await CredentialsModel.findById(credential_id, userId);
      if (!credentials) {
        res.status(404).json({ error: 'Credencial no encontrada' });
        return;
      }

      const decryptedCredentials = BitgetService.getDecryptedCredentials({
        api_key: credentials.api_key,
        api_secret: credentials.api_secret,
        passphrase: credentials.passphrase,
      });

      const productType = (product_type || 'USDT-FUTURES').toUpperCase();
      const marginCoin = (margin_coin || 'USDT').toUpperCase();

      const result = await bitgetService.cancelAllTriggerOrders(
        decryptedCredentials,
        symbol.toUpperCase(),
        productType,
        marginCoin,
        { userId, strategyId: null }
      );

      res.json({
        success: true,
        cancelled: result.cancelled,
        failed: result.failed,
        remaining: result.remaining,
      });
    } catch (error: any) {
      console.error('[CancelTriggers] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/admin/trading/credentials
   * Lista las credenciales del admin (solo id y nombre)
   */
  static async getCredentials(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const credentials = await CredentialsModel.findByUserId(userId);
      
      res.json(credentials.map(c => ({
        id: c.id,
        name: c.name || `Credencial ${c.id}`,
        is_active: c.is_active,
      })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/admin/trading/ticker
   * Obtiene el precio actual de un símbolo
   */
  static async getTicker(req: AuthRequest, res: Response): Promise<void> {
    try {
      const symbol = (req.query.symbol as string || '').toUpperCase();
      const productType = ((req.query.product_type as string) || 'USDT-FUTURES').toUpperCase();

      if (!symbol) {
        res.status(400).json({ error: 'symbol es requerido' });
        return;
      }

      const credentialId = parseInt(req.query.credential_id as string);
      if (!credentialId) {
        res.status(400).json({ error: 'credential_id es requerido' });
        return;
      }

      const userId = req.user!.userId;
      const credentials = await CredentialsModel.findById(credentialId, userId);
      if (!credentials) {
        res.status(404).json({ error: 'Credencial no encontrada' });
        return;
      }

      const price = await bitgetService.getTickerPrice(symbol, productType);
      
      // Obtener info del contrato también
      let contractInfo = null;
      try {
        contractInfo = await bitgetService.getContractInfo(symbol, productType);
      } catch (_) {}

      res.json({ symbol, price, contractInfo });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/admin/trading/symbols-config
   * Lista la misma configuración de apertura (contract info) por moneda para replicar y debugear.
   * Query: product_type (opcional), symbols (opcional, comma-separated).
   */
  static async getSymbolsConfig(req: AuthRequest, res: Response): Promise<void> {
    try {
      const productType = (req.query.product_type as string || 'USDT-FUTURES').toUpperCase();
      const symbolsParam = (req.query.symbols as string || '').trim();
      const defaultSymbols = [
        'BTCUSDT', 'ETHUSDT', 'TRXUSDT', 'ARBUSDT', 'SHIBUSDT', 'DOGEUSDT',
        'UNIUSDT', 'DOTUSDT', 'WLDUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT',
      ];
      const symbolList = symbolsParam
        ? symbolsParam.split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean)
        : defaultSymbols;

      const symbols: Array<{
        symbol: string;
        minTradeNum: string;
        sizeMultiplier: string;
        volumePlace: string;
        pricePlace: string;
        minTradeUSDT: string;
        error?: string;
      }> = [];

      for (const symbol of symbolList) {
        try {
          const info = await bitgetService.getContractInfo(symbol, productType);
          symbols.push({
            symbol,
            minTradeNum: info.minTradeNum,
            sizeMultiplier: info.sizeMultiplier,
            volumePlace: info.volumePlace,
            pricePlace: info.pricePlace,
            minTradeUSDT: info.minTradeUSDT,
          });
        } catch (e: any) {
          symbols.push({
            symbol,
            minTradeNum: '-',
            sizeMultiplier: '-',
            volumePlace: '-',
            pricePlace: '-',
            minTradeUSDT: '-',
            error: e.message,
          });
        }
      }

      res.json({ productType, symbols });
    } catch (error: any) {
      console.error('[TestOrder] getSymbolsConfig:', error.message);
      res.status(500).json({ error: error.message });
    }
  }
}
