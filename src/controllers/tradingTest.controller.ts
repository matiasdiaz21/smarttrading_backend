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
        breakeven,
        order_type,
        margin_mode,
        product_type,
        margin_coin,
      } = req.body;

      // Validaciones
      if (!credential_id || !symbol || !side || !size || !stop_loss || !take_profit) {
        res.status(400).json({ error: 'Campos requeridos: credential_id, symbol, side, size, stop_loss, take_profit' });
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

      // Ejecutar flujo optimizado
      const result = await bitgetService.openPositionWithFullTPSL(
        decryptedCredentials,
        {
          symbol: symbol.toUpperCase(),
          productType,
          marginMode: margin_mode || 'isolated',
          marginCoin,
          size: calculatedSize,
          price: entry_price ? entry_price.toString() : undefined,
          side,
          orderType: order_type || 'market',
          clientOid,
        },
        {
          stopLossPrice: parseFloat(stop_loss),
          takeProfitPrice: parseFloat(take_profit),
          breakevenPrice: breakeven ? parseFloat(breakeven) : undefined,
        },
        contractInfo,
        { userId, strategyId: null }
      );

      res.json({
        success: result.success,
        orderId: result.orderId,
        method: result.method,
        calculatedSize,
        contractInfo: contractInfo ? {
          minTradeNum: contractInfo.minTradeNum,
          sizeMultiplier: contractInfo.sizeMultiplier,
          pricePlace: contractInfo.pricePlace,
          volumePlace: contractInfo.volumePlace,
        } : null,
        steps: result.tpslResults,
        error: result.error,
        breakevenSkipped: result.breakevenSkipped,
        breakevenSkippedReason: result.breakevenSkippedReason,
        minSizeForPartial: result.minSizeForPartial,
        partialTpSize: result.partialTpSize,
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
      const holdSide = side === 'buy' ? 'long' : 'short';

      // Obtener posición actual
      const positions = await bitgetService.getPositions(decryptedCredentials, symbol.toUpperCase(), productType);
      const currentPosition = Array.isArray(positions)
        ? positions.find((p: any) => p.symbol === symbol.toUpperCase() && p.holdSide === holdSide)
        : null;

      if (!currentPosition) {
        res.status(400).json({ error: `No hay posición ${holdSide} abierta para ${symbol}` });
        return;
      }

      const positionSize = currentPosition.total || currentPosition.available || currentPosition.size;
      const closeSide = side === 'buy' ? 'sell' : 'buy';

      // Cancelar todos los triggers primero
      const cancelResult = await bitgetService.cancelAllTriggerOrders(
        decryptedCredentials, symbol.toUpperCase(), productType, marginCoin,
        { userId, strategyId: null }
      );

      // Cerrar posición
      const timestamp = Date.now();
      const closeResult = await bitgetService.placeOrder(decryptedCredentials, {
        symbol: symbol.toUpperCase(),
        productType,
        marginMode: margin_mode || 'isolated',
        marginCoin,
        size: positionSize,
        side: closeSide as 'buy' | 'sell',
        tradeSide: 'close',
        orderType: 'market',
        holdSide,
        clientOid: `CLOSE_${symbol.substring(0, 8)}_${timestamp}`.substring(0, 64),
      }, { userId, strategyId: null });

      res.json({
        success: true,
        closedSize: positionSize,
        cancelledTriggers: cancelResult,
        closeOrder: closeResult,
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
}
