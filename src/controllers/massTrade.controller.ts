import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { MassTradeConfigModel } from '../models/MassTradeConfig';
import { CredentialsModel } from '../models/Credentials';
import { BitgetService } from '../services/bitget.service';
import { decrypt } from '../utils/encryption';

const MAX_SYMBOLS = 20;

// Traduce errores de Bitget a mensajes claros en español
function translateBitgetError(error: string): string {
  const translations: Record<string, string> = {
    'The order amount exceeds the balance': 'Saldo insuficiente para abrir esta posición',
    'Insufficient balance': 'Saldo insuficiente',
    'Order amount is less than the minimum': 'El monto de la orden es menor al mínimo permitido',
    'The leverage is too high': 'El apalancamiento es demasiado alto para este par',
    'Position does not exist': 'La posición no existe',
    'Duplicate clientOid': 'Orden duplicada, intentá de nuevo',
    'The symbol is not supported': 'Este par no está soportado',
    'System error': 'Error del sistema de Bitget, intentá más tarde',
    'The order price is not within the price limit': 'El precio de la orden está fuera del rango permitido',
    'Trigger price should be higher than the market price': 'El precio trigger debe ser mayor al precio de mercado',
    'Trigger price should be lower than the market price': 'El precio trigger debe ser menor al precio de mercado',
  };

  for (const [key, value] of Object.entries(translations)) {
    if (error.includes(key)) return value;
  }

  // Si no hay traducción, limpiar el prefijo de Bitget
  return error.replace('Bitget API Request Failed: ', '').replace('Bitget API Error: ', '');
}

// Normaliza symbols: acepta string[] o {symbol,sl_percent?,tp_percent?}[]
function normalizeSymbols(symbols: any[]): Array<{ symbol: string; sl_percent?: number; tp_percent?: number }> {
  return symbols.map((s: any) => {
    if (typeof s === 'string') {
      return { symbol: s.toUpperCase() };
    }
    return {
      symbol: (s.symbol || '').toUpperCase(),
      ...(s.sl_percent != null ? { sl_percent: parseFloat(s.sl_percent) } : {}),
      ...(s.tp_percent != null ? { tp_percent: parseFloat(s.tp_percent) } : {}),
    };
  });
}

export class MassTradeController {
  // ─── CRUD Configs ───────────────────────────────────────────

  static async listConfigs(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const configs = await MassTradeConfigModel.findByUserId(req.user.userId);
      res.json(configs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getConfig(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const config = await MassTradeConfigModel.findById(parseInt(req.params.id), req.user.userId);
      if (!config) { res.status(404).json({ error: 'Configuración no encontrada' }); return; }
      res.json(config);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async createConfig(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const { name, credential_id, side, leverage, stop_loss_percent, take_profit_percent, position_size_usdt, symbols, product_type, margin_coin } = req.body;

      if (!name || !credential_id || !symbols || !Array.isArray(symbols) || symbols.length === 0) {
        res.status(400).json({ error: 'Campos requeridos: name, credential_id, symbols (array)' });
        return;
      }
      if (symbols.length > MAX_SYMBOLS) {
        res.status(400).json({ error: `Máximo ${MAX_SYMBOLS} símbolos permitidos` });
        return;
      }
      if (leverage && (leverage < 1 || leverage > 125)) {
        res.status(400).json({ error: 'Leverage debe ser entre 1 y 125' });
        return;
      }

      // Verificar que la credencial pertenece al usuario
      const cred = await CredentialsModel.findById(credential_id, req.user.userId);
      if (!cred) { res.status(400).json({ error: 'Credencial no encontrada' }); return; }

      const id = await MassTradeConfigModel.create(req.user.userId, {
        name,
        credential_id,
        side: side || 'buy',
        leverage: leverage || 10,
        stop_loss_percent: stop_loss_percent || 2,
        take_profit_percent: take_profit_percent || null,
        position_size_usdt: position_size_usdt || 10,
        symbols: normalizeSymbols(symbols),
        product_type,
        margin_coin,
      });

      const config = await MassTradeConfigModel.findById(id, req.user.userId);
      res.status(201).json(config);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async updateConfig(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const id = parseInt(req.params.id);
      const existing = await MassTradeConfigModel.findById(id, req.user.userId);
      if (!existing) { res.status(404).json({ error: 'Configuración no encontrada' }); return; }

      const { symbols, credential_id, leverage } = req.body;

      if (symbols && (!Array.isArray(symbols) || symbols.length === 0)) {
        res.status(400).json({ error: 'symbols debe ser un array no vacío' });
        return;
      }
      if (symbols && symbols.length > MAX_SYMBOLS) {
        res.status(400).json({ error: `Máximo ${MAX_SYMBOLS} símbolos permitidos` });
        return;
      }
      if (leverage && (leverage < 1 || leverage > 125)) {
        res.status(400).json({ error: 'Leverage debe ser entre 1 y 125' });
        return;
      }
      if (credential_id) {
        const cred = await CredentialsModel.findById(credential_id, req.user.userId);
        if (!cred) { res.status(400).json({ error: 'Credencial no encontrada' }); return; }
      }

      const data = { ...req.body };
      if (data.symbols) data.symbols = normalizeSymbols(data.symbols);

      await MassTradeConfigModel.update(id, req.user.userId, data);
      const updated = await MassTradeConfigModel.findById(id, req.user.userId);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async deleteConfig(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const id = parseInt(req.params.id);
      const existing = await MassTradeConfigModel.findById(id, req.user.userId);
      if (!existing) { res.status(404).json({ error: 'Configuración no encontrada' }); return; }
      await MassTradeConfigModel.delete(id, req.user.userId);
      res.json({ message: 'Configuración eliminada' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  // ─── Execute Mass Trade (SSE - Sequential) ─────────────────

  static async execute(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const configId = parseInt(req.params.id);
      const config = await MassTradeConfigModel.findById(configId, req.user.userId);
      if (!config) { res.status(404).json({ error: 'Configuración no encontrada' }); return; }

      const side: 'buy' | 'sell' = req.body.side || config.side;

      // Soporte para reintentar solo símbolos específicos (los fallidos)
      const retrySymbols: string[] | undefined = req.body.retrySymbols;
      const symbolsToExecute = retrySymbols && retrySymbols.length > 0
        ? config.symbols.filter(sc => retrySymbols.includes(sc.symbol))
        : config.symbols;

      if (symbolsToExecute.length === 0) {
        res.status(400).json({ error: 'No hay símbolos para ejecutar' });
        return;
      }

      const credentials = await CredentialsModel.findById(config.credential_id, req.user.userId);
      if (!credentials) { res.status(400).json({ error: 'Credencial no encontrada o eliminada' }); return; }

      const decryptedCredentials = BitgetService.getDecryptedCredentials({
        api_key: credentials.api_key,
        api_secret: credentials.api_secret,
        passphrase: credentials.passphrase,
      });

      // SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const sendEvent = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const bitgetService = new BitgetService();
      const total = symbolsToExecute.length;
      const isRetry = !!(retrySymbols && retrySymbols.length > 0);
      const results: Array<{ symbol: string; success: boolean; orderId?: string; error?: string }> = [];

      sendEvent('start', { total, side, leverage: config.leverage, configName: config.name, isRetry });
      console.log(`[MassTrade] 🚀 Ejecutando ${total} trades ${side === 'buy' ? 'LONG' : 'SHORT'} con leverage ${config.leverage}x...`);

      // Fase 0: Verificar saldo disponible
      sendEvent('phase', { phase: 'balance', message: 'Verificando saldo disponible...' });
      let availableBalance = 0;
      try {
        const balanceInfo = await bitgetService.getAccountBalance(decryptedCredentials, config.product_type, config.margin_coin);
        availableBalance = balanceInfo.available;
        const totalMarginNeeded = config.position_size_usdt * total;

        sendEvent('balance', {
          available: balanceInfo.available,
          equity: balanceInfo.equity,
          needed: totalMarginNeeded,
          sufficient: balanceInfo.available >= totalMarginNeeded,
          marginCoin: balanceInfo.marginCoin,
        });

        console.log(`[MassTrade] 💰 Saldo: ${balanceInfo.available} ${balanceInfo.marginCoin} disponible, ${totalMarginNeeded} necesario (${total} × $${config.position_size_usdt})`);

        if (balanceInfo.available < totalMarginNeeded) {
          const maxTrades = Math.floor(balanceInfo.available / config.position_size_usdt);
          sendEvent('balance_warning', {
            message: `Saldo insuficiente: tenés $${balanceInfo.available.toFixed(2)} disponible pero necesitás $${totalMarginNeeded.toFixed(2)} para ${total} posiciones. Podés abrir máximo ${maxTrades} posiciones con tu saldo actual.`,
            available: balanceInfo.available,
            needed: totalMarginNeeded,
            maxTrades,
          });
        }
      } catch (balanceErr: any) {
        console.warn(`[MassTrade] ⚠️ No se pudo verificar saldo: ${balanceErr.message}`);
        sendEvent('balance_warning', {
          message: 'No se pudo verificar el saldo. Se intentará abrir las posiciones de todas formas.',
          available: null,
          needed: null,
          maxTrades: null,
        });
      }

      // Fase 1: Configurar leverage (paralelo, rápido)
      sendEvent('phase', { phase: 'leverage', message: 'Configurando leverage...' });
      const leveragePromises = symbolsToExecute.map(async (symCfg) => {
        try {
          await bitgetService.setLeverage(
            decryptedCredentials, symCfg.symbol, config.leverage,
            config.product_type, config.margin_coin,
            side === 'buy' ? 'long' : 'short',
          );
        } catch (err: any) {
          console.warn(`[MassTrade] ⚠️ Leverage ${symCfg.symbol}: ${err.message}`);
        }
      });
      await Promise.all(leveragePromises);
      sendEvent('phase', { phase: 'trades', message: 'Abriendo posiciones...' });

      // Fase 2: Ejecutar trades SECUENCIALMENTE
      for (let i = 0; i < symbolsToExecute.length; i++) {
        const symCfg = symbolsToExecute[i];
        const symbol = symCfg.symbol;

        sendEvent('trade_start', { index: i, total, symbol });

        try {
          let contractInfo;
          try {
            contractInfo = await bitgetService.getContractInfo(symbol, config.product_type);
          } catch {
            contractInfo = { minTradeNum: '0.01', sizeMultiplier: '0.01', volumePlace: '2', pricePlace: '2' };
          }

          const tickerPrice = await bitgetService.getTickerPrice(symbol, config.product_type);
          const currentPrice = parseFloat(tickerPrice);
          if (!currentPrice || currentPrice <= 0) {
            throw new Error(`No se pudo obtener precio para ${symbol}`);
          }

          const rawSize = (config.position_size_usdt * config.leverage) / currentPrice;
          const sizeMultiplier = parseFloat(contractInfo.sizeMultiplier || '0.01');
          const volumePlace = parseInt(contractInfo.volumePlace || '2');
          const adjustedSize = Math.floor(rawSize / sizeMultiplier) * sizeMultiplier;
          const sizeStr = adjustedSize.toFixed(volumePlace).replace(/\.?0+$/, '');

          const minTradeNum = parseFloat(contractInfo.minTradeNum || '0.01');
          if (adjustedSize < minTradeNum) {
            throw new Error(`Tamaño (${adjustedSize}) menor al mínimo (${minTradeNum})`);
          }

          const pricePlace = parseInt(contractInfo.pricePlace || '2');

          const slPercent = (symCfg.sl_percent ?? config.stop_loss_percent) / 100;
          const stopLossPrice = side === 'buy'
            ? currentPrice * (1 - slPercent)
            : currentPrice * (1 + slPercent);
          const formattedSL = parseFloat(stopLossPrice.toFixed(pricePlace));

          const tpPercentRaw = symCfg.tp_percent ?? config.take_profit_percent;
          let formattedTP: number | null = null;
          if (tpPercentRaw && tpPercentRaw > 0) {
            const tpPercent = tpPercentRaw / 100;
            const takeProfitPrice = side === 'buy'
              ? currentPrice * (1 + tpPercent)
              : currentPrice * (1 - tpPercent);
            formattedTP = parseFloat(takeProfitPrice.toFixed(pricePlace));
          }

          const timestamp = Date.now();
          const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
          const clientOid = `MT_${symbol.substring(0, 8)}_${timestamp}_${random}`.substring(0, 64);

          console.log(`[MassTrade] 📊 ${symbol}: precio=${currentPrice}, size=${sizeStr}, SL=${formattedSL}, TP=${formattedTP || 'N/A'}`);

          // Abrir posición
          const orderResult = await bitgetService.placeOrder(
            decryptedCredentials,
            {
              symbol,
              productType: config.product_type,
              marginMode: 'isolated',
              marginCoin: config.margin_coin,
              size: sizeStr,
              side,
              tradeSide: 'open',
              orderType: 'market',
              clientOid,
            },
            { userId: req.user!.userId, strategyId: null }
          );

          // SL - usar endpoint correcto de TPSL (/api/v2/mix/order/place-tpsl-order)
          const holdSide = side === 'buy' ? 'long' : 'short';
          try {
            const slClientOid = `MT_SL_${symbol.substring(0, 8)}_${timestamp}_${Math.floor(Math.random() * 1000)}`.substring(0, 64);
            await bitgetService.placeTpslOrder(decryptedCredentials, {
              symbol, productType: config.product_type, marginCoin: config.margin_coin,
              planType: 'pos_loss', triggerPrice: formattedSL.toString(), triggerType: 'fill_price',
              executePrice: formattedSL.toString(), holdSide, size: sizeStr, clientOid: slClientOid,
            }, { userId: req.user!.userId, strategyId: null });
          } catch (slErr: any) {
            console.warn(`[MassTrade] ⚠️ ${symbol}: SL falló: ${slErr.message}`);
          }

          // TP - usar endpoint correcto de TPSL (/api/v2/mix/order/place-tpsl-order)
          if (formattedTP) {
            try {
              const tpClientOid = `MT_TP_${symbol.substring(0, 8)}_${timestamp}_${Math.floor(Math.random() * 1000)}`.substring(0, 64);
              await bitgetService.placeTpslOrder(decryptedCredentials, {
                symbol, productType: config.product_type, marginCoin: config.margin_coin,
                planType: 'pos_profit', triggerPrice: formattedTP.toString(), triggerType: 'fill_price',
                executePrice: formattedTP.toString(), holdSide, size: sizeStr, clientOid: tpClientOid,
              }, { userId: req.user!.userId, strategyId: null });
            } catch (tpErr: any) {
              console.warn(`[MassTrade] ⚠️ ${symbol}: TP falló: ${tpErr.message}`);
            }
          }

          const orderId = orderResult?.orderId || orderResult?.clientOid || 'unknown';
          results.push({ symbol, success: true, orderId });
          sendEvent('trade_done', { index: i, total, symbol, success: true, orderId });
          console.log(`[MassTrade] ✅ ${symbol}: OK (${i + 1}/${total})`);

        } catch (err: any) {
          const translatedError = translateBitgetError(err.message);
          console.error(`[MassTrade] ❌ ${symbol}: ${err.message}`);
          results.push({ symbol, success: false, error: translatedError });
          sendEvent('trade_done', { index: i, total, symbol, success: false, error: translatedError });
        }
      }

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      console.log(`[MassTrade] 📈 Resultado: ${successful} exitosos, ${failed} fallidos de ${total}`);

      // Guardar ejecución en DB
      await MassTradeConfigModel.createExecution(configId, req.user.userId, {
        side,
        leverage: config.leverage,
        symbols_count: total,
        successful,
        failed,
        results,
      });

      sendEvent('complete', { successful, failed, total, results });
      res.end();

    } catch (error: any) {
      console.error(`[MassTrade] ❌ Error general:`, error);
      // If headers already sent (SSE started), send error event
      if (res.headersSent) {
        const sendEvent = (event: string, data: any) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        sendEvent('error', { error: error.message });
        res.end();
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  }

  // ─── Close All Positions (SSE - Sequential) ────────────────

  static async closeAll(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const configId = parseInt(req.params.id);
      const config = await MassTradeConfigModel.findById(configId, req.user.userId);
      if (!config) { res.status(404).json({ error: 'Configuración no encontrada' }); return; }

      const credentials = await CredentialsModel.findById(config.credential_id, req.user.userId);
      if (!credentials) { res.status(400).json({ error: 'Credencial no encontrada o eliminada' }); return; }

      const decryptedCredentials = BitgetService.getDecryptedCredentials({
        api_key: credentials.api_key,
        api_secret: credentials.api_secret,
        passphrase: credentials.passphrase,
      });

      // Optional: only close specific symbols
      const retrySymbols: string[] | undefined = req.body.retrySymbols;
      const symbolsToClose = retrySymbols && retrySymbols.length > 0
        ? config.symbols.filter(sc => retrySymbols.includes(sc.symbol))
        : config.symbols;

      if (symbolsToClose.length === 0) {
        res.status(400).json({ error: 'No hay símbolos para cerrar' });
        return;
      }

      // SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const sendEvent = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const bitgetService = new BitgetService();
      const total = symbolsToClose.length;
      const results: Array<{ symbol: string; success: boolean; orderId?: string; error?: string }> = [];

      sendEvent('start', { total, configName: config.name, action: 'close' });
      console.log(`[MassTrade] 🔴 Cerrando posiciones de ${total} símbolos...`);

      sendEvent('phase', { phase: 'closing', message: 'Cerrando posiciones a mercado...' });

      for (let i = 0; i < symbolsToClose.length; i++) {
        const symCfg = symbolsToClose[i];
        const symbol = symCfg.symbol;

        sendEvent('trade_start', { index: i, total, symbol });

        try {
          // Get open positions for this symbol
          const positions = await bitgetService.getPositions(decryptedCredentials, symbol, config.product_type);

          if (!positions || positions.length === 0) {
            results.push({ symbol, success: false, error: 'Sin posición abierta' });
            sendEvent('trade_done', { index: i, total, symbol, success: false, error: 'Sin posición abierta' });
            console.log(`[MassTrade] ⚠️ ${symbol}: Sin posición abierta`);
            continue;
          }

          // Close each position found for this symbol (could be long and short)
          for (const position of positions) {
            const posSize = position.available || position.total || position.openDelegateSize;
            if (!posSize || parseFloat(posSize) <= 0) continue;

            const holdSide = position.holdSide || 'long';
            const closeSide: 'buy' | 'sell' = holdSide === 'long' ? 'sell' : 'buy';

            const timestamp = Date.now();
            const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
            const clientOid = `MC_${symbol.substring(0, 8)}_${timestamp}_${random}`.substring(0, 64);

            await bitgetService.placeOrder(
              decryptedCredentials,
              {
                symbol,
                productType: config.product_type,
                marginMode: 'isolated',
                marginCoin: config.margin_coin,
                size: posSize,
                side: closeSide,
                tradeSide: 'close',
                orderType: 'market',
                clientOid,
              },
              { userId: req.user!.userId, strategyId: null }
            );
          }

          results.push({ symbol, success: true });
          sendEvent('trade_done', { index: i, total, symbol, success: true });
          console.log(`[MassTrade] ✅ ${symbol}: Posición cerrada (${i + 1}/${total})`);

        } catch (err: any) {
          const translatedError = translateBitgetError(err.message);
          console.error(`[MassTrade] ❌ ${symbol}: ${err.message}`);
          results.push({ symbol, success: false, error: translatedError });
          sendEvent('trade_done', { index: i, total, symbol, success: false, error: translatedError });
        }
      }

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      console.log(`[MassTrade] 📉 Cierre: ${successful} cerradas, ${failed} fallidas de ${total}`);

      sendEvent('complete', { successful, failed, total, results });
      res.end();

    } catch (error: any) {
      console.error(`[MassTrade] ❌ Error general cierre:`, error);
      if (res.headersSent) {
        const sendEvent = (event: string, data: any) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        sendEvent('error', { error: error.message });
        res.end();
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  }

  // ─── Execution History ──────────────────────────────────────

  static async getExecutions(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const limit = parseInt(req.query.limit as string) || 20;
      const executions = await MassTradeConfigModel.getExecutions(req.user.userId, limit);
      res.json(executions);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
