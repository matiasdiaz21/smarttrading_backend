import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { config } from '../config';
import { decrypt } from '../utils/encryption';
import BitgetOperationLogModel from '../models/BitgetOperationLog';

interface BitgetCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}

interface PriceCache {
  [symbol: string]: {
    price: string;
    timestamp: number;
  };
}

// Cache simple en memoria con TTL de 5 segundos
const priceCache: PriceCache = {};
const CACHE_TTL = 5000; // 5 segundos

// Cache de información de contratos (no cambia frecuentemente) - TTL 5 minutos
interface ContractInfoCache {
  [key: string]: {
    data: { minTradeNum: string; sizeMultiplier: string; minTradeUSDT: string; volumePlace: string; pricePlace: string };
    timestamp: number;
  };
}
const contractInfoCache: ContractInfoCache = {};
const CONTRACT_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/** Longitud máxima de clientOid en Bitget (error 40305 si se supera o caracteres no permitidos). */
const BITGET_CLIENT_OID_MAX_LEN = 64;

/** trade_id Pine/webhook para cruzar logs; null si no hay id usable (p. ej. placeholder ENTRY en clientOid). */
function normalizeTradeIdForLog(v: string | number | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === 'N/A' || s === 'ENTRY') return null;
  return s.length > 64 ? s.substring(0, 64) : s;
}

/** Genera clientOid válido para Bitget: solo [a-zA-Z0-9_], máx 64 chars (evita error 40305). Escalable y seguro. */
function makeBitgetClientOid(prefix: string, symbol: string, baseId: string, suffix: string): string {
  const safeSymbol = (symbol || '').replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
  const safeBaseId = (baseId || '').replace(/[^a-zA-Z0-9_]/g, '').substring(0, 28);
  const safeSuffix = (suffix || '').replace(/[^a-zA-Z0-9_]/g, '').substring(0, 8);
  const raw = `${prefix}_${safeSymbol}_${safeBaseId}_${safeSuffix}`;
  const sanitized = raw.replace(/[^a-zA-Z0-9_]/g, '');
  return sanitized.substring(0, BITGET_CLIENT_OID_MAX_LEN);
}

export class BitgetService {
  private apiBaseUrl: string;

  constructor() {
    this.apiBaseUrl = config.bitget.apiBaseUrl.replace(/\/+$/, '');
  }

  private generateSignature(
    timestamp: string,
    method: string,
    requestPath: string,
    body: string,
    secret: string
  ): string {
    const message = timestamp + method + requestPath + body;
    return crypto.createHmac('sha256', secret).update(message).digest('base64');
  }

  private async makeRequest(
    method: 'GET' | 'POST',
    endpoint: string,
    credentials: BitgetCredentials,
    body?: any,
    logContext?: {
      userId?: number;
      strategyId?: number | null;
      tradeId?: string | number | null;
      symbol?: string;
      operationType?: string;
      orderId?: string;
      clientOid?: string;
      metrics?: { apiCalls: number };
    }
  ): Promise<any> {
    if (logContext?.metrics) logContext.metrics.apiCalls = (logContext.metrics.apiCalls || 0) + 1;
    const timestamp = Date.now().toString();
    const requestPath = endpoint;
    const bodyString = body ? JSON.stringify(body) : '';

    const signature = this.generateSignature(
      timestamp,
      method,
      requestPath,
      bodyString,
      credentials.apiSecret
    );

    const headers: any = {
      'ACCESS-KEY': credentials.apiKey,
      'ACCESS-SIGN': signature,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': credentials.passphrase,
      'Content-Type': 'application/json',
      'locale': 'en-US',
    };

    const fullUrl = `${this.apiBaseUrl}${endpoint}`;
    let response: any = null;
    let success = false;
    let errorMessage: string | null = null;
    let responseStatus: number | null = null;
    let responseData: any = null;

    try {
      response = await axios({
        method,
        url: fullUrl,
        headers,
        data: body,
      });

      responseStatus = response.status;
      responseData = response.data;

      if (response.data.code === '00000') {
        success = true;
        return response.data.data;
      } else {
        const apiCode = response.data.code ?? '';
        errorMessage = `Bitget API Error: ${response.data.msg}`;
        throw new Error(`[${apiCode}] ${errorMessage}`);
      }
    } catch (error: any) {
      responseStatus = error.response?.status || null;
      responseData = error.response?.data || null;
      const apiCode = (error.response?.data?.code ?? '').toString();
      errorMessage = error.response?.data?.msg || error.message;
      // 22002 "No position to close": tratar como éxito en log cuando es orden de cierre (posición ya cerrada por SL/TP)
      if ((apiCode === '22002' || (errorMessage && String(errorMessage).includes('No position to close'))) &&
          (body?.tradeSide === 'close' || body?.reduceOnly === 'YES')) {
        success = true;
      }
      const msg = apiCode ? `[${apiCode}] ${errorMessage}` : errorMessage;
      throw new Error(`Bitget API Request Failed: ${msg}`);
    } finally {
      // Guardar log solo si se proporcionó contexto con userId (evitar cuando solo se pasa metrics)
      if (logContext && logContext.userId != null) {
        try {
          console.log(`[BitgetService] 📝 Intentando guardar log de operación:`, {
            userId: logContext.userId,
            strategyId: logContext.strategyId,
            symbol: logContext.symbol,
            operationType: logContext.operationType,
            method,
            endpoint,
            success,
          });
          
          const logId = await BitgetOperationLogModel.create(
            logContext.userId,
            logContext.strategyId ?? null,
            logContext.symbol ?? '',
            logContext.operationType ?? '',
            method,
            endpoint,
            fullUrl,
            body || null,
            headers,
            responseData,
            responseStatus,
            success,
            errorMessage,
            logContext.orderId || null,
            logContext.clientOid || null,
            normalizeTradeIdForLog(logContext.tradeId)
          );
          
          console.log(`[BitgetService] ✅ Log de operación guardado exitosamente con ID: ${logId}`);
        } catch (logError: any) {
          // No fallar la operación principal si falla el log
          console.error('[BitgetService] ❌ Error al guardar log de operación:', logError.message);
          console.error('[BitgetService] Stack trace:', logError.stack);
          console.error('[BitgetService] Detalles del error:', {
            name: logError.name,
            code: logError.code,
            errno: logError.errno,
            sqlState: logError.sqlState,
            sqlMessage: logError.sqlMessage,
          });
        }
      } else {
        console.warn(`[BitgetService] ⚠️ No se proporcionó logContext para la operación: ${method} ${endpoint}`);
      }
    }
  }

  async getTickerPrice(
    symbol: string,
    productType: string = 'USDT-FUTURES'
  ): Promise<string> {
    // Verificar cache
    const cacheKey = `${symbol}_${productType}`;
    const cached = priceCache[cacheKey];
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.price;
    }

    try {
      const response = await axios.get(
        `${this.apiBaseUrl}/api/v2/mix/market/ticker`,
        {
          params: {
            symbol,
            productType,
          },
        }
      );

      console.log(`[BitgetService] 🔍 Ticker response COMPLETO para ${symbol}:`, JSON.stringify(response.data, null, 2));

      if (response.data.code === '00000' && response.data.data) {
        // La API v2 de Bitget devuelve un array en data, no un objeto directo
        const tickerData = Array.isArray(response.data.data) ? response.data.data[0] : response.data.data;
        
        console.log(`[BitgetService] 🔍 Ticker data extraído:`, JSON.stringify(tickerData, null, 2));
        console.log(`[BitgetService] 🔍 Tipo de tickerData:`, typeof tickerData);
        console.log(`[BitgetService] 🔍 Es array:`, Array.isArray(tickerData));
        
        if (tickerData) {
          console.log(`[BitgetService] 🔍 Campos disponibles en tickerData:`, Object.keys(tickerData));
          console.log(`[BitgetService] 🔍 Valores de campos de precio:`);
          console.log(`[BitgetService]   - lastPr: ${tickerData.lastPr} (tipo: ${typeof tickerData.lastPr})`);
          console.log(`[BitgetService]   - last: ${tickerData.last} (tipo: ${typeof tickerData.last})`);
          console.log(`[BitgetService]   - close: ${tickerData.close} (tipo: ${typeof tickerData.close})`);
          console.log(`[BitgetService]   - bestAsk: ${tickerData.bestAsk} (tipo: ${typeof tickerData.bestAsk})`);
          console.log(`[BitgetService]   - bestBid: ${tickerData.bestBid} (tipo: ${typeof tickerData.bestBid})`);
        }
        
        // Intentar obtener el precio de diferentes campos posibles
        const price = tickerData?.lastPr || tickerData?.last || tickerData?.close;
        
        // Validar que el precio sea válido
        if (!price || price === '' || isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
          console.error(`[BitgetService] ❌ Precio inválido recibido de Bitget: ${price}`);
          console.error(`[BitgetService] ❌ Estructura completa de tickerData:`, tickerData);
          console.error(`[BitgetService] ❌ Response.data completo:`, response.data);
          throw new Error(`Invalid price received from Bitget: ${price}`);
        }
        
        console.log(`[BitgetService] ✅ Precio obtenido exitosamente: ${price} (campo usado: ${tickerData?.lastPr ? 'lastPr' : tickerData?.last ? 'last' : 'close'})`);
        
        // Actualizar cache
        priceCache[cacheKey] = {
          price,
          timestamp: Date.now(),
        };
        
        return price;
      } else {
        console.error(`[BitgetService] ❌ Respuesta inválida de Bitget:`, response.data);
        throw new Error(`Failed to get ticker price: ${response.data?.msg || 'Unknown error'}`);
      }
    } catch (error: any) {
      console.error(`[BitgetService] ❌ Error al obtener precio de ticker para ${symbol}:`, error.message);
      if (error.response) {
        console.error(`[BitgetService] ❌ Response data:`, error.response.data);
      }
      throw new Error(
        `Failed to get ticker price: ${error.response?.data?.msg || error.message}`
      );
    }
  }

  // Obtener información del contrato (minTradeNum, sizeMultiplier, etc.)
  // Usa cache en memoria con TTL de 5 minutos (la info de contratos no cambia frecuentemente)
  async getContractInfo(
    symbol: string,
    productType: string = 'USDT-FUTURES',
    options?: { metrics?: { apiCalls: number } }
  ): Promise<{
    minTradeNum: string;
    sizeMultiplier: string;
    minTradeUSDT: string;
    volumePlace: string;
    pricePlace: string;
  }> {
    // Check cache first
    const cacheKey = `${symbol}_${productType}`;
    const cached = contractInfoCache[cacheKey];
    if (cached && Date.now() - cached.timestamp < CONTRACT_CACHE_TTL) {
      console.log(`[Bitget] 📦 getContractInfo cache HIT para ${symbol} (${Math.round((Date.now() - cached.timestamp) / 1000)}s old)`);
      return cached.data;
    }

    try {
      const response = await axios.get(
        `${this.apiBaseUrl}/api/v2/mix/market/contracts`,
        {
          params: {
            symbol,
            productType: productType.toUpperCase(),
          },
        }
      );

      if (response.data.code === '00000' && response.data.data && response.data.data.length > 0) {
        if (options?.metrics) options.metrics.apiCalls = (options.metrics.apiCalls || 0) + 1;
        const contract = response.data.data[0];
        const data = {
          minTradeNum: contract.minTradeNum || '0.01',
          sizeMultiplier: contract.sizeMultiplier || '0.01',
          minTradeUSDT: contract.minTradeUSDT || '5',
          volumePlace: contract.volumePlace || '2',
          pricePlace: contract.pricePlace || '1',
        };
        // Store in cache
        contractInfoCache[cacheKey] = { data, timestamp: Date.now() };
        console.log(`[Bitget] 📦 getContractInfo cache MISS para ${symbol} — cacheado por ${CONTRACT_CACHE_TTL / 1000}s`);
        return data;
      } else {
        throw new Error('Failed to get contract info');
      }
    } catch (error: any) {
      throw new Error(
        `Failed to get contract info: ${error.response?.data?.msg || error.message}`
      );
    }
  }

  // Calcular el tamaño correcto de la orden basándose en los requisitos del contrato
  calculateOrderSize(
    requestedSize: string | number,
    minTradeNum: string,
    sizeMultiplier: string
  ): string {
    const requested = parseFloat(requestedSize.toString());
    const minTrade = parseFloat(minTradeNum);
    const multiplier = parseFloat(sizeMultiplier);

    // Si el tamaño solicitado es menor al mínimo, usar el mínimo
    let size = Math.max(requested, minTrade);

    // Asegurar que el tamaño sea múltiplo de sizeMultiplier
    // Redondear hacia arriba al múltiplo más cercano
    size = Math.ceil(size / multiplier) * multiplier;

    // Redondear a los decimales apropiados (usar volumePlace si está disponible)
    // Por ahora, usar hasta 8 decimales para evitar problemas de precisión
    return size.toFixed(8).replace(/\.?0+$/, '');
  }

  /**
   * Tamaño redondeado hacia ABAJO al múltiplo del contrato (para TP final = resto de posición).
   * Así parcial + final = totalSize y no queda posición abierta por redondeo.
   */
  calculateOrderSizeFloor(
    size: number,
    sizeMultiplier: number,
    minTradeNum: number,
    volumePlace: number
  ): string {
    let s = Math.max(size, 0);
    s = Math.floor(s / sizeMultiplier) * sizeMultiplier;
    if (s < minTradeNum) s = minTradeNum;
    return s.toFixed(volumePlace).replace(/\.?0+$/, '');
  }

  async placeOrder(
    credentials: BitgetCredentials,
    orderData: {
      symbol: string;
      productType: string;
      marginMode: string;
      marginCoin: string;
      size: string;
      price?: string;
      side: 'buy' | 'sell';
      tradeSide?: 'open' | 'close';
      orderType: 'limit' | 'market';
      force?: string;
      holdSide?: string;
      clientOid?: string;
      presetStopLossPrice?: string;
      presetStopSurplusPrice?: string;
      reduceOnly?: string;
    },
    logContext?: {
      userId?: number;
      strategyId?: number | null;
      tradeId?: string | number | null;
      orderId?: string;
      metrics?: { apiCalls: number };
    }
  ): Promise<{ orderId: string; clientOid: string }> {
    const endpoint = '/api/v2/mix/order/place-order';
    
    const orderPayload: any = {
      symbol: orderData.symbol,
      productType: orderData.productType,
      marginMode: orderData.marginMode,
      marginCoin: orderData.marginCoin,
      size: orderData.size,
      side: orderData.side,
      orderType: orderData.orderType,
    };

    if (orderData.price) {
      orderPayload.price = orderData.price;
    }

    if (orderData.tradeSide) {
      orderPayload.tradeSide = orderData.tradeSide;
    }

    if (orderData.force) {
      orderPayload.force = orderData.force;
    } else if (orderData.orderType === 'limit') {
      orderPayload.force = 'gtc';
    } else if (orderData.orderType === 'market' && (orderData.tradeSide === 'close' || orderData.reduceOnly === 'YES')) {
      // Cierre a mercado: IOC para que se ejecute de inmediato a precio de mercado (no quedar como pendiente).
      orderPayload.force = 'ioc';
    }

    if (orderData.clientOid) {
      orderPayload.clientOid = orderData.clientOid;
    }

    if (orderData.holdSide) {
      orderPayload.holdSide = orderData.holdSide;
    }

    if (orderData.presetStopLossPrice) {
      orderPayload.presetStopLossPrice = orderData.presetStopLossPrice;
    }

    if (orderData.presetStopSurplusPrice) {
      orderPayload.presetStopSurplusPrice = orderData.presetStopSurplusPrice;
    }

    if (orderData.reduceOnly) {
      orderPayload.reduceOnly = orderData.reduceOnly;
    }

    try {
      const result = await this.makeRequest(
        'POST',
        endpoint,
        credentials,
        orderPayload,
        logContext ? {
          userId: logContext.userId,
          strategyId: logContext.strategyId,
          tradeId: logContext.tradeId,
          symbol: orderData.symbol,
          operationType: 'placeOrder',
          orderId: logContext.orderId,
          clientOid: orderData.clientOid,
          metrics: logContext.metrics,
        } : undefined
      );
      const orderId = result.orderId || result.clientOid;
      const clientOid = result.clientOid || orderData.clientOid || '';
      return { orderId, clientOid };
    } catch (err: any) {
      const msg = err?.message || '';
      const isNoPositionToClose = (orderPayload.tradeSide === 'close' || orderPayload.reduceOnly === 'YES') &&
        (msg.includes('22002') || msg.includes('No position to close'));
      if (isNoPositionToClose) {
        return { orderId: 'N/A', clientOid: orderData.clientOid || '' };
      }
      throw err;
    }
  }

  /**
   * Cancela una orden abierta (limit/market pendiente) en mix/futures.
   * POST /api/v2/mix/order/cancel-order
   */
  async cancelOpenOrder(
    credentials: BitgetCredentials,
    orderId: string,
    symbol: string,
    productType: string,
    marginCoin: string = 'USDT',
    logContext?: { userId: number; strategyId: number | null; tradeId?: string | number | null }
  ): Promise<void> {
    const endpoint = '/api/v2/mix/order/cancel-order';
    await this.makeRequest('POST', endpoint, credentials, {
      orderId,
      symbol: symbol.toUpperCase(),
      productType: productType.toUpperCase(),
      marginCoin: marginCoin.toUpperCase(),
    }, logContext ? { ...logContext, symbol, operationType: 'cancelOrder', orderId } : undefined);
  }

  /**
   * Abre posición LIMIT con SL y TP parcial 50% + TP final 50%.
   * Solo place-order (órdenes limit). Sin triggers.
   * 1) Limit open + presetStopLossPrice
   * 2) Tras breve espera: 2 órdenes limit de cierre (50% en TP parcial, 50% en TP final).
   */
  async openPositionWithFullTPSL(
    credentials: BitgetCredentials,
    orderData: {
      symbol: string;
      productType: string;
      marginMode: string;
      marginCoin: string;
      size: string;
      price: string;
      side: 'buy' | 'sell';
      orderType: 'limit' | 'market';
      clientOid?: string;
    },
    tpslData: {
      stopLossPrice: number;
      takeProfitPrice: number;
      /** Precio del take profit parcial (50%). Si no se pasa, se usa un solo TP 100% en takeProfitPrice (1 sola llamada con preset). */
      takeProfitPartialPrice?: number;
    },
    contractInfo?: any,
    logContext?: {
      userId: number;
      strategyId: number | null;
      tradeId?: string | number | null;
    }
  ): Promise<{
    success: boolean;
    orderId?: string;
    orderResult?: any;
    tpslResults: Array<{ type: string; success: boolean; result?: any; error?: string }>;
    method: 'limit_open_sl_plus_limit_tp50_tp50' | 'preset_only' | 'open_with_sl_and_normal_plan_tps';
    error?: string;
    payloads?: any;
    bitgetApiCalls?: number;
  }> {
    const steps: Array<{ type: string; success: boolean; result?: any; error?: string }> = [];
    const pricePlace = contractInfo?.pricePlace ? parseInt(contractInfo.pricePlace) : 4;
    const volumePlace = contractInfo?.volumePlace ? parseInt(contractInfo.volumePlace) : 2;
    const sizeMultiplier = parseFloat(contractInfo?.sizeMultiplier || '0.01');
    const minTradeNum = parseFloat(contractInfo?.minTradeNum || '0.01');
    const totalSize = parseFloat(String(orderData.size));
    const hasPartialTP = tpslData.takeProfitPartialPrice != null && tpslData.takeProfitPartialPrice > 0;

    try {
      const formattedSL = parseFloat(tpslData.stopLossPrice.toFixed(pricePlace)).toString();
      const formattedTP = parseFloat(tpslData.takeProfitPrice.toFixed(pricePlace)).toString();

      // Sin TP parcial: 1 llamada con preset SL + TP
      if (!hasPartialTP) {
        const result = await this.placeOrder(credentials, {
          ...orderData,
          tradeSide: 'open',
          presetStopLossPrice: formattedSL,
          presetStopSurplusPrice: formattedTP,
        }, logContext ? { ...logContext, orderId: undefined } : undefined);
        steps.push({ type: 'open_with_sl_tp', success: true, result });
        return {
          success: true,
          orderId: result.orderId,
          orderResult: result,
          tpslResults: steps,
          method: 'preset_only',
          payloads: { endpoint: 'POST /api/v2/mix/order/place-order', presetStopLossPrice: formattedSL, presetStopSurplusPrice: formattedTP },
          bitgetApiCalls: 1,
        };
      }

      const formattedTPPartial = parseFloat(tpslData.takeProfitPartialPrice!.toFixed(pricePlace)).toString();
      
      // Logging para debugging de cálculo de tamaños
      console.log(`[Bitget] 📊 Cálculo de tamaños para ${orderData.symbol}:`);
      console.log(`  - totalSize: ${totalSize}`);
      console.log(`  - sizeMultiplier: ${sizeMultiplier}`);
      console.log(`  - minTradeNum: ${minTradeNum}`);
      console.log(`  - volumePlace: ${volumePlace}`);
      const minTradeNumStr = (contractInfo?.minTradeNum ?? String(minTradeNum)).toString();
      const sizeMultiplierStr = (contractInfo?.sizeMultiplier ?? String(sizeMultiplier)).toString();
      const halfSizeStr = this.calculateOrderSize(String(totalSize / 2), minTradeNumStr, sizeMultiplierStr);
      const halfSize = parseFloat(halfSizeStr);
      // TP final cierra el RESTANTE (totalSize - parcial) para no dejar posición abierta por redondeo
      const remainderSize = totalSize - halfSize;
      const remainderSizeStr = this.calculateOrderSizeFloor(remainderSize, sizeMultiplier, minTradeNum, volumePlace);
      console.log(`  - halfSize (calculateOrderSize): ${halfSizeStr} (TP parcial)`);
      console.log(`  - remainderSize (TP final = cierre total restante): ${remainderSizeStr}`);
      
      const canDoPartial = totalSize >= 2 * minTradeNum - 1e-8 && halfSize >= minTradeNum - 1e-8;
      console.log(`  - canDoPartial: ${canDoPartial} (totalSize >= ${2 * minTradeNum} && halfSize >= ${minTradeNum})`);

      if (!canDoPartial) {
        const result = await this.placeOrder(credentials, {
          ...orderData,
          tradeSide: 'open',
          presetStopLossPrice: formattedSL,
          presetStopSurplusPrice: formattedTP,
        }, logContext ? { ...logContext, orderId: undefined } : undefined);
        steps.push({ type: 'open_with_sl_tp_fallback', success: true, result });
        return {
          success: true,
          orderId: result.orderId,
          orderResult: result,
          tpslResults: steps,
          method: 'preset_only',
          payloads: { endpoint: 'POST /api/v2/mix/order/place-order', presetStopLossPrice: formattedSL, presetStopSurplusPrice: formattedTP },
          bitgetApiCalls: 1,
        };
      }

      const holdSide = orderData.side === 'buy' ? 'long' : 'short';
      const closeSide = orderData.side === 'buy' ? 'buy' : 'sell';
      const tradeSideClose = 'close' as const;
      // baseId con alta entropía para evitar error 40786 (Duplicate clientOid)
      const timestamp = Date.now();
      const randomSuffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const random5 = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
      const hexEntropy = crypto.randomBytes(4).toString('hex');
      const baseId = `${timestamp}_${randomSuffix}_${random5}_${hexEntropy}`;

      // 1) Orden de apertura (market o limit según orderData) SIN preset SL/TP
      let openResult = await this.placeOrder(credentials, {
        ...orderData,
        tradeSide: 'open',
        // NO usar presetStopLossPrice para evitar error 45062
        price: orderData.price,
        orderType: orderData.orderType,
      }, logContext ? { ...logContext, orderId: undefined } : undefined);
      steps.push({ type: orderData.orderType === 'limit' ? 'limit_open' : 'market_open', success: true, result: openResult });
      console.log(`[Bitget] ✅ Orden ${orderData.orderType} abierta. OrderId: ${openResult.orderId}. Colocando SL y TPs...`);

      let getOrderStatusCalls = 0;
      let fallbackExtraCalls = 0; // cancel + place-order when limit timeout
      // Si es orden limit, esperar a que esté filled antes de colocar TPs
      if (orderData.orderType === 'limit') {
        const pollIntervalMs = 2000;
        const maxAttempts = 30; // 60 s máximo
        let orderFilled = false;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
          try {
            const raw = await this.getOrderStatus(credentials, openResult.orderId, orderData.symbol, orderData.productType);
            getOrderStatusCalls += 1;
            const detail = raw && (raw.entrustedList && raw.entrustedList[0]) ? raw.entrustedList[0] : raw;
            const state = (detail && (detail.state || detail.status)) || '';
            if (state === 'filled') {
              orderFilled = true;
              console.log(`[Bitget] ✅ Orden de apertura filled (intento ${attempt}). Colocando SL y TPs...`);
              break;
            }
            if (state === 'canceled' || state === 'cancelled') {
              throw new Error('La orden de apertura fue cancelada');
            }
            console.log(`[Bitget] ⏳ Orden estado: ${state}, reintento ${attempt}/${maxAttempts}`);
          } catch (e: any) {
            if (attempt === maxAttempts) throw e;
            console.warn(`[Bitget] Poll order status: ${e.message}`);
          }
        }
        if (!orderFilled) {
          // Fallback: cancelar limit y abrir con market para no perder la señal
          try {
            console.warn('[Bitget] ⏱️ Timeout 60s: limit no se llenó. Cancelando limit y abriendo con market...');
            await this.cancelOpenOrder(credentials, openResult.orderId, orderData.symbol, orderData.productType, orderData.marginCoin, logContext);
            fallbackExtraCalls += 1;
            const marketResult = await this.placeOrder(credentials, {
              ...orderData,
              orderType: 'market',
              price: '',
              tradeSide: 'open',
            }, logContext ? { ...logContext, orderId: undefined } : undefined);
            fallbackExtraCalls += 1;
            openResult = marketResult;
            console.log('[Bitget] ✅ Apertura con market. OrderId:', openResult.orderId);
          } catch (fallbackErr: any) {
            console.error('[Bitget] ❌ Fallback market falló:', fallbackErr.message);
            throw new Error('Timeout: la orden de apertura no se llenó en 60s. Colocá manualmente las limit de cierre 50%+50% cuando esté filled.');
          }
        }
      }

      // 2) Colocar Stop Loss usando placeTpslOrder
      const slRandom = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const slPayload = {
        symbol: orderData.symbol,
        productType: orderData.productType,
        marginCoin: orderData.marginCoin,
        planType: 'pos_loss' as const,
        triggerPrice: formattedSL,
        triggerType: 'fill_price',
        executePrice: formattedSL,
        holdSide,
        size: orderData.size,
        clientOid: makeBitgetClientOid('SL', orderData.symbol, baseId, slRandom),
      };
      console.log(`[Bitget] 📤 Colocando SL: place-tpsl-order, size=${orderData.size}, triggerPrice=${formattedSL}, holdSide=${holdSide}`);
      const slResult = await this.placeTpslOrder(credentials, slPayload, logContext ? { ...logContext, orderId: openResult.orderId } : undefined);
      steps.push({ type: 'stop_loss', success: true, result: slResult });

      // 3) Colocar Take Profit parcial usando normal_plan (trigger order)
      const planEndpoint = '/api/v2/mix/order/place-plan-order';
      const tpRandom1 = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const tpPartialPayload = {
        planType: 'normal_plan',
        symbol: orderData.symbol.toUpperCase(),
        productType: orderData.productType.toUpperCase(),
        marginMode: orderData.marginMode,
        marginCoin: orderData.marginCoin.toUpperCase(),
        size: halfSizeStr,
        price: '0', // Para market execution
        triggerPrice: formattedTPPartial,
        triggerType: 'fill_price',
        side: closeSide as 'buy' | 'sell',
        tradeSide: 'close',
        orderType: 'market',
        holdSide,
        reduceOnly: 'YES',
        clientOid: makeBitgetClientOid('TP_BE', orderData.symbol, baseId, tpRandom1),
      };
      console.log(`[Bitget] 📤 Colocando TP parcial (50%): place-plan-order, size=${halfSizeStr}, triggerPrice=${formattedTPPartial}, holdSide=${holdSide}`);
      
      let tpPartialResult;
      try {
        tpPartialResult = await this.makeRequest('POST', planEndpoint, credentials, tpPartialPayload, logContext ? {
          userId: logContext.userId,
          strategyId: logContext.strategyId,
          tradeId: logContext.tradeId,
          symbol: orderData.symbol,
          operationType: 'take_profit_partial',
          orderId: openResult.orderId,
          clientOid: tpPartialPayload.clientOid,
        } : undefined);
        steps.push({ type: 'take_profit_partial', success: true, result: tpPartialResult });
      } catch (tpPartialError: any) {
        const isMinOrderError = tpPartialError.message && (
          tpPartialError.message.includes('Min. order amount') || tpPartialError.message.includes('43070')
        );
        if (isMinOrderError) {
          console.warn(`[Bitget] ⚠️ TP parcial rechazado por tamaño mínimo (${halfSizeStr}). Error: ${tpPartialError.message}`);
          console.log(`[Bitget] 🔄 Intentando TP parcial con tamaño mínimo ajustado...`);
          const minSizeValid = Math.max(minTradeNum * 2, minTradeNum);
          const adjustedSizeStr = this.calculateOrderSize(String(minSizeValid), minTradeNumStr, sizeMultiplierStr);
          console.log(`[Bitget] 📤 Reintentando TP parcial con size ajustado: ${adjustedSizeStr}`);
          
          try {
            const adjustedPayload = { ...tpPartialPayload, size: adjustedSizeStr };
            tpPartialResult = await this.makeRequest('POST', planEndpoint, credentials, adjustedPayload, logContext ? {
              userId: logContext.userId,
              strategyId: logContext.strategyId,
              tradeId: logContext.tradeId,
              symbol: orderData.symbol,
              operationType: 'take_profit_partial_adjusted',
              orderId: openResult.orderId,
              clientOid: adjustedPayload.clientOid,
            } : undefined);
            steps.push({ type: 'take_profit_partial', success: true, result: tpPartialResult });
            console.log(`[Bitget] ✅ TP parcial ajustado colocado exitosamente`);
          } catch (retryError: any) {
            console.error(`[Bitget] ❌ Error en retry de TP parcial: ${retryError.message}`);
            steps.push({ type: 'take_profit_partial', success: false, error: retryError.message });
          }
        } else {
          console.error(`[Bitget] ❌ Error en TP parcial: ${tpPartialError.message}`);
          steps.push({ type: 'take_profit_partial', success: false, error: tpPartialError.message });
        }
      }

      // 4) Colocar Take Profit final usando normal_plan (cierra el RESTANTE para no dejar posición abierta)
      const tpRandom2 = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const tpFinalPayload = {
        planType: 'normal_plan',
        symbol: orderData.symbol.toUpperCase(),
        productType: orderData.productType.toUpperCase(),
        marginMode: orderData.marginMode,
        marginCoin: orderData.marginCoin.toUpperCase(),
        size: remainderSizeStr,
        price: '0', // Para market execution
        triggerPrice: formattedTP,
        triggerType: 'fill_price',
        side: closeSide as 'buy' | 'sell',
        tradeSide: 'close',
        orderType: 'market',
        holdSide,
        reduceOnly: 'YES',
        clientOid: makeBitgetClientOid('TP_F', orderData.symbol, baseId, tpRandom2),
      };
      console.log(`[Bitget] 📤 Colocando TP final (resto): place-plan-order, size=${remainderSizeStr}, triggerPrice=${formattedTP}, holdSide=${holdSide}`);
      
      let tpFinalResult;
      try {
        tpFinalResult = await this.makeRequest('POST', planEndpoint, credentials, tpFinalPayload, logContext ? {
          userId: logContext.userId,
          strategyId: logContext.strategyId,
          tradeId: logContext.tradeId,
          symbol: orderData.symbol,
          operationType: 'take_profit_final',
          orderId: openResult.orderId,
          clientOid: tpFinalPayload.clientOid,
        } : undefined);
        steps.push({ type: 'take_profit_final', success: true, result: tpFinalResult });
      } catch (tpFinalError: any) {
        const isMinOrderErrorFinal = tpFinalError.message && (
          tpFinalError.message.includes('Min. order amount') || tpFinalError.message.includes('43070')
        );
        if (isMinOrderErrorFinal) {
          console.warn(`[Bitget] ⚠️ TP final rechazado por tamaño mínimo (${halfSizeStr}). Error: ${tpFinalError.message}`);
          console.log(`[Bitget] 🔄 Intentando TP final con tamaño mínimo ajustado...`);
          const minSizeValid = Math.max(minTradeNum * 2, minTradeNum);
          const adjustedSizeStr = this.calculateOrderSize(String(minSizeValid), minTradeNumStr, sizeMultiplierStr);
          console.log(`[Bitget] 📤 Reintentando TP final con size ajustado: ${adjustedSizeStr}`);
          
          try {
            const adjustedPayload = { ...tpFinalPayload, size: adjustedSizeStr };
            tpFinalResult = await this.makeRequest('POST', planEndpoint, credentials, adjustedPayload, logContext ? {
              userId: logContext.userId,
              strategyId: logContext.strategyId,
              tradeId: logContext.tradeId,
              symbol: orderData.symbol,
              operationType: 'take_profit_final_adjusted',
              orderId: openResult.orderId,
              clientOid: adjustedPayload.clientOid,
            } : undefined);
            steps.push({ type: 'take_profit_final', success: true, result: tpFinalResult });
            console.log(`[Bitget] ✅ TP final ajustado colocado exitosamente`);
          } catch (retryError: any) {
            console.error(`[Bitget] ❌ Error en retry de TP final: ${retryError.message}`);
            steps.push({ type: 'take_profit_final', success: false, error: retryError.message });
          }
        } else {
          console.error(`[Bitget] ❌ Error en TP final: ${tpFinalError.message}`);
          steps.push({ type: 'take_profit_final', success: false, error: tpFinalError.message });
        }
      }

      // 1 place-order + 1 place-tpsl-order + 2 place-plan-order + getOrderStatus (limit only) + fallback (cancel+place if timeout)
      const bitgetApiCalls = 1 + 1 + 2 + getOrderStatusCalls + fallbackExtraCalls;
      return {
        success: true,
        orderId: openResult.orderId,
        orderResult: openResult,
        tpslResults: steps,
        method: 'open_with_sl_and_normal_plan_tps',
        payloads: {
          open: { orderType: orderData.orderType, price: orderData.price, size: orderData.size },
          stopLoss: { triggerPrice: formattedSL, size: orderData.size },
          takeProfitPartial: { triggerPrice: formattedTPPartial, size: halfSizeStr },
          takeProfitFinal: { triggerPrice: formattedTP, size: remainderSizeStr },
        },
        bitgetApiCalls,
      };
    } catch (error: any) {
      console.error(`[Bitget] ❌ openPositionWithFullTPSL error:`, error.message);
      return {
        success: false,
        tpslResults: steps,
        method: hasPartialTP ? 'open_with_sl_and_normal_plan_tps' : 'preset_only',
        error: error.message,
      };
    }
  }

  /**
   * Coloca triggers SL + TPs para una posición que YA existe (sin abrir posición).
   * Usa los mismos endpoints que openPositionWithFullTPSL:
   * - SL: place-tpsl-order con pos_loss
   * - TPs: place-plan-order con normal_plan (permite múltiples parciales)
   */
  async setPositionTPSLTriggers(
    credentials: BitgetCredentials,
    positionData: {
      symbol: string;
      productType: string;
      marginMode: string;
      marginCoin: string;
      side: 'buy' | 'sell';
      size: string;
    },
    tpslData: {
      stopLossPrice: number;
      takeProfitPrice: number;
      breakevenPrice?: number;
    },
    contractInfo?: any,
    logContext?: { userId: number; strategyId: number | null; orderId?: string; tradeId?: string | number | null },
    currentPrice?: number
  ): Promise<Array<{ type: string; success: boolean; result?: any; error?: string }>> {
    const results: Array<{ type: string; success: boolean; result?: any; error?: string }> = [];

    try {
      const holdSide = positionData.side === 'buy' ? 'long' : 'short';
      const closeSide = positionData.side === 'buy' ? 'sell' : 'buy';
      const pricePlace = contractInfo?.pricePlace ? parseInt(contractInfo.pricePlace) : 4;
      const volumePlace = contractInfo?.volumePlace ? parseInt(contractInfo.volumePlace) : 2;
      const minTradeNum = parseFloat(contractInfo?.minTradeNum || '0.01');
      const sizeMultiplier = parseFloat(contractInfo?.sizeMultiplier || '0.01');
      const fullSize = parseFloat(positionData.size);

      const formattedSL = parseFloat(tpslData.stopLossPrice.toFixed(pricePlace)).toString();
      const formattedTP = parseFloat(tpslData.takeProfitPrice.toFixed(pricePlace)).toString();
      const fullSizeStr = fullSize.toFixed(volumePlace).replace(/\.?0+$/, '');

      const timestamp = Date.now();
      const baseId = `${timestamp}${Math.floor(Math.random() * 1000)}`;
      const tpslEndpoint = '/api/v2/mix/order/place-tpsl-order';
      const planEndpoint = '/api/v2/mix/order/place-plan-order';

      const makeLogCtx = (opType: string, clientOid: string) => logContext ? {
        userId: logContext.userId, strategyId: logContext.strategyId, tradeId: logContext.tradeId,
        symbol: positionData.symbol, operationType: opType,
        orderId: logContext.orderId, clientOid,
      } : undefined;

      // SL con place-tpsl-order + pos_loss
      const slOid = makeBitgetClientOid('SL', positionData.symbol, baseId, String(Math.floor(Math.random() * 1000)));
      try {
        const slResult = await this.makeRequest('POST', tpslEndpoint, credentials, {
          marginCoin: positionData.marginCoin.toUpperCase(),
          productType: positionData.productType.toUpperCase(),
          symbol: positionData.symbol.toUpperCase(),
          planType: 'pos_loss',
          triggerPrice: formattedSL,
          triggerType: 'fill_price',
          executePrice: formattedSL,
          holdSide,
          size: fullSizeStr,
          clientOid: slOid,
        }, makeLogCtx('stop_loss', slOid));
        console.log(`[Bitget] ✅ SL colocado en ${formattedSL}`);
        results.push({ type: 'stop_loss', success: true, result: slResult });
      } catch (e: any) {
        console.error(`[Bitget] ❌ Error SL: ${e.message}`);
        results.push({ type: 'stop_loss', success: false, error: e.message });
      }

      // Determinar si usar TPs parciales o TP único (evitar 43070: cada tramo debe ser >= minTradeNum)
      const minSizeForPartial = 2 * minTradeNum;
      const usePartialTps = tpslData.breakevenPrice && tpslData.breakevenPrice > 0 && fullSize >= minSizeForPartial - 1e-8;
      
      if (usePartialTps) {
        // TPs parciales (50% BE + 50% final) con normal_plan; cada mitad >= minTradeNum
        let halfSize = Math.floor((fullSize / 2) / sizeMultiplier) * sizeMultiplier;
        if (halfSize < minTradeNum) halfSize = minTradeNum;
        const halfSizeStr = halfSize.toFixed(volumePlace).replace(/\.?0+$/, '');
        const formattedBE = parseFloat(tpslData.breakevenPrice!.toFixed(pricePlace)).toString();

        // TP breakeven (50%)
        const tpBeOid = makeBitgetClientOid('TP_BE', positionData.symbol, baseId, String(Math.floor(Math.random() * 1000)));
        try {
          const tpBeResult = await this.makeRequest('POST', planEndpoint, credentials, {
            planType: 'normal_plan',
            symbol: positionData.symbol.toUpperCase(),
            productType: positionData.productType.toUpperCase(),
            marginMode: positionData.marginMode,
            marginCoin: positionData.marginCoin.toUpperCase(),
            size: halfSizeStr,
            price: '0',
            triggerPrice: formattedBE,
            triggerType: 'fill_price',
            side: closeSide,
            tradeSide: 'close',
            orderType: 'market',
            holdSide,
            clientOid: tpBeOid,
          }, makeLogCtx('take_profit_partial', tpBeOid));
          console.log(`[Bitget] ✅ TP_BE colocado en ${formattedBE} (${halfSizeStr})`);
          results.push({ type: 'take_profit_partial', success: true, result: tpBeResult });
        } catch (e: any) {
          console.error(`[Bitget] ❌ Error TP_BE: ${e.message}`);
          results.push({ type: 'take_profit_partial', success: false, error: e.message });
        }

        // TP final (50%)
        const tpFOid = makeBitgetClientOid('TP_F', positionData.symbol, baseId, String(Math.floor(Math.random() * 1000)));
        try {
          const tpFResult = await this.makeRequest('POST', planEndpoint, credentials, {
            planType: 'normal_plan',
            symbol: positionData.symbol.toUpperCase(),
            productType: positionData.productType.toUpperCase(),
            marginMode: positionData.marginMode,
            marginCoin: positionData.marginCoin.toUpperCase(),
            size: halfSizeStr,
            price: '0',
            triggerPrice: formattedTP,
            triggerType: 'fill_price',
            side: closeSide,
            tradeSide: 'close',
            orderType: 'market',
            holdSide,
            clientOid: tpFOid,
          }, makeLogCtx('take_profit_final', tpFOid));
          console.log(`[Bitget] ✅ TP_F colocado en ${formattedTP} (${halfSizeStr})`);
          results.push({ type: 'take_profit_final', success: true, result: tpFResult });
        } catch (e: any) {
          console.error(`[Bitget] ❌ Error TP_F: ${e.message}`);
          results.push({ type: 'take_profit_final', success: false, error: e.message });
        }
      } else {
        // TP único (100%) con normal_plan
        const tpOid = makeBitgetClientOid('TP', positionData.symbol, baseId, String(Math.floor(Math.random() * 1000)));
        try {
          const tpResult = await this.makeRequest('POST', planEndpoint, credentials, {
            planType: 'normal_plan',
            symbol: positionData.symbol.toUpperCase(),
            productType: positionData.productType.toUpperCase(),
            marginMode: positionData.marginMode,
            marginCoin: positionData.marginCoin.toUpperCase(),
            size: fullSizeStr,
            price: '0',
            triggerPrice: formattedTP,
            triggerType: 'fill_price',
            side: closeSide,
            tradeSide: 'close',
            orderType: 'market',
            holdSide,
            clientOid: tpOid,
          }, makeLogCtx('take_profit', tpOid));
          console.log(`[Bitget] ✅ TP colocado en ${formattedTP} (${fullSizeStr})`);
          results.push({ type: 'take_profit', success: true, result: tpResult });
        } catch (e: any) {
          console.error(`[Bitget] ❌ Error TP: ${e.message}`);
          results.push({ type: 'take_profit', success: false, error: e.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`[Bitget] Triggers: ${successCount}/${results.length} OK`);
    } catch (error: any) {
      console.error(`[Bitget] ❌ setPositionTPSLTriggers error: ${error.message}`);
      results.push({ type: 'general_error', success: false, error: error.message });
    }

    return results;
  }

  /**
   * Breakeven simplificado: solo cancela el SL viejo y pone nuevo SL en precio de entrada.
   * Los TPs parciales ya están configurados desde el ENTRY.
   */
  async moveStopLossToBreakeven(
    credentials: BitgetCredentials,
    symbol: string,
    side: 'buy' | 'sell',
    newStopLossPrice: number,
    positionSize: string,
    productType: string = 'USDT-FUTURES',
    marginCoin: string = 'USDT',
    contractInfo?: any,
    logContext?: {
      userId?: number;
      strategyId?: number | null;
      orderId?: string;
      tradeId?: string | number | null;
      metrics?: { apiCalls: number };
    }
  ): Promise<{ success: boolean; steps: Array<{ type: string; success: boolean; result?: any; error?: string }> }> {
    const results: Array<{ type: string; success: boolean; result?: any; error?: string }> = [];
    
    try {
      const holdSide = side === 'buy' ? 'long' : 'short';
      const pricePlace = contractInfo?.pricePlace ? parseInt(contractInfo.pricePlace) : 4;
      const formattedSL = parseFloat(newStopLossPrice.toFixed(pricePlace));
      
      console.log(`[Bitget] 🔄 Moviendo SL a breakeven (${formattedSL}) para ${symbol} ${holdSide}...`);
      
      // Paso 1: Cancelar solo las órdenes pos_loss (SL) — no tocar los TPs
      const pendingSLOrders = await this.getPendingTriggerOrders(credentials, symbol, productType, 'pos_loss', logContext?.metrics ? { metrics: logContext.metrics } : undefined);
      
      if (pendingSLOrders.length > 0) {
        const cancelEndpoint = '/api/v2/mix/order/cancel-plan-order';
        const cancelResults = await Promise.all(
          pendingSLOrders.map(async (order) => {
            const orderId = order.orderId || order.id;
            if (!orderId) return { type: 'cancel_sl', success: false, error: 'No orderId' };
            try {
              await this.makeRequest('POST', cancelEndpoint, credentials, {
                symbol: symbol.toUpperCase(),
                productType: productType.toUpperCase(),
                marginCoin: marginCoin.toUpperCase(),
                orderId,
              }, logContext ? {
                userId: logContext.userId, strategyId: logContext.strategyId, tradeId: logContext.tradeId,
                symbol, operationType: 'cancelSL_forBreakeven', orderId: logContext.orderId, metrics: logContext.metrics,
              } : undefined);
              console.log(`[Bitget] ✅ SL viejo cancelado (${orderId})`);
              return { type: 'cancel_old_sl', success: true, result: { orderId } };
            } catch (e: any) {
              console.error(`[Bitget] ❌ Error cancelando SL ${orderId}: ${e.message}`);
              return { type: 'cancel_old_sl', success: false, error: e.message };
            }
          })
        );
        results.push(...cancelResults);
      } else {
        console.log(`[Bitget] ℹ️ No hay SL pendiente para cancelar`);
      }
      
      // Paso 2: Colocar nuevo SL en precio de breakeven
      const tpslEndpoint = '/api/v2/mix/order/place-tpsl-order';
      const timestamp = Date.now();
      const slClientOid = makeBitgetClientOid('SL_BE', symbol, String(timestamp), String(Math.floor(Math.random() * 1000)));
      
      const slPayload = {
        marginCoin: marginCoin.toUpperCase(),
        productType: productType.toUpperCase(),
        symbol: symbol.toUpperCase(),
        planType: 'pos_loss',
        triggerPrice: formattedSL.toString(),
        triggerType: 'fill_price',
        executePrice: formattedSL.toString(),
        holdSide,
        size: positionSize,
        clientOid: slClientOid,
      };
      
      try {
        const slResult = await this.makeRequest('POST', tpslEndpoint, credentials, slPayload, logContext ? {
          userId: logContext.userId, strategyId: logContext.strategyId, tradeId: logContext.tradeId,
          symbol, operationType: 'newSL_breakeven', orderId: logContext.orderId, clientOid: slClientOid, metrics: logContext.metrics,
        } : undefined);
        console.log(`[Bitget] ✅ Nuevo SL en breakeven (${formattedSL}) configurado`);
        results.push({ type: 'new_sl_breakeven', success: true, result: slResult });
      } catch (e: any) {
        console.error(`[Bitget] ❌ Error colocando nuevo SL: ${e.message}`);
        results.push({ type: 'new_sl_breakeven', success: false, error: e.message });
      }
      
      const slOk = results.some(r => r.type === 'new_sl_breakeven' && r.success);
      return { success: slOk, steps: results };
      
    } catch (error: any) {
      console.error(`[Bitget] ❌ moveStopLossToBreakeven error:`, error.message);
      return { success: false, steps: [...results, { type: 'error', success: false, error: error.message }] };
    }
  }

  async placeTpslOrder(
    credentials: BitgetCredentials,
    tpslData: {
      symbol: string;
      productType: string;
      marginCoin: string;
      planType: 'pos_profit' | 'pos_loss';
      triggerPrice: string;
      triggerType?: string;
      executePrice?: string;
      holdSide: string;
      size: string;
      clientOid?: string;
    },
    logContext?: {
      userId: number;
      strategyId: number | null;
      orderId?: string;
      tradeId?: string | number | null;
    }
  ): Promise<any> {
    const endpoint = '/api/v2/mix/order/place-tpsl-order';

    const payload: any = {
      symbol: tpslData.symbol.toUpperCase(),
      productType: tpslData.productType.toUpperCase(),
      marginCoin: tpslData.marginCoin.toUpperCase(),
      planType: tpslData.planType,
      triggerPrice: tpslData.triggerPrice,
      triggerType: tpslData.triggerType || 'fill_price',
      holdSide: tpslData.holdSide,
      size: tpslData.size,
    };

    if (tpslData.executePrice) {
      payload.executePrice = tpslData.executePrice;
    }
    if (tpslData.clientOid) {
      payload.clientOid = tpslData.clientOid;
    }

    const operationType = tpslData.planType === 'pos_profit' ? 'setTakeProfit' : 'setStopLoss';

    return this.makeRequest('POST', endpoint, credentials, payload, logContext ? {
      userId: logContext.userId,
      strategyId: logContext.strategyId,
      tradeId: logContext.tradeId,
      symbol: tpslData.symbol,
      operationType,
      orderId: logContext.orderId,
      clientOid: tpslData.clientOid,
    } : undefined);
  }

  async getOrderStatus(
    credentials: BitgetCredentials,
    orderId: string,
    symbol: string,
    productType: string = 'USDT-FUTURES'
  ): Promise<any> {
    const endpoint = `/api/v2/mix/order/detail?orderId=${orderId}&symbol=${symbol}&productType=${productType}`;
    
    return await this.makeRequest('GET', endpoint, credentials);
  }

  // Obtener historial de órdenes del usuario desde Bitget (con paginación automática)
  async getOrdersHistory(
    credentials: BitgetCredentials,
    productType: string = 'USDT-FUTURES',
    limit: number = 100,
    startTime?: number,
    endTime?: number,
    symbol?: string
  ): Promise<any[]> {
    try {
      const endpoint = '/api/v2/mix/order/orders-history';
      const allOrders: any[] = [];
      let idLessThan: string | undefined;
      const maxPages = 10; // Máximo 10 páginas (1000 órdenes) para evitar loops infinitos

      for (let page = 0; page < maxPages; page++) {
        const params: any = {
          productType: productType,
          limit: '100', // Máximo por request de Bitget
        };

        if (symbol) params.symbol = symbol;
        if (startTime) params.startTime = startTime.toString();
        if (endTime) params.endTime = endTime.toString();
        if (idLessThan) params.idLessThan = idLessThan;

        const queryString = Object.keys(params)
          .map(key => `${key}=${params[key]}`)
          .join('&');
        const requestPath = `${endpoint}?${queryString}`;

        const timestamp = Date.now().toString();
        const signature = this.generateSignature(
          timestamp,
          'GET',
          requestPath,
          '',
          credentials.apiSecret
        );

        const headers: any = {
          'ACCESS-KEY': credentials.apiKey,
          'ACCESS-SIGN': signature,
          'ACCESS-TIMESTAMP': timestamp,
          'ACCESS-PASSPHRASE': credentials.passphrase,
          'Content-Type': 'application/json',
          'locale': 'en-US',
        };

        const response = await axios({
          method: 'GET',
          url: `${this.apiBaseUrl}${endpoint}`,
          headers,
          params,
        });

        if (response.data.code !== '00000') {
          throw new Error(`Bitget API Error: ${response.data.msg}`);
        }

        const data = response.data.data;
        if (!data || !data.entrustedList || data.entrustedList.length === 0) {
          break; // No hay más órdenes
        }

        allOrders.push(...data.entrustedList);
        console.log(`[BitgetService] Página ${page + 1}: ${data.entrustedList.length} órdenes (total acumulado: ${allOrders.length})`);

        // Si devolvió menos de 100, no hay más páginas
        if (data.entrustedList.length < 100) break;

        // Usar endId como cursor para la siguiente página
        if (data.endId) {
          idLessThan = data.endId;
        } else {
          break;
        }

        // Si ya tenemos suficientes órdenes según el limit solicitado, parar
        if (limit > 0 && allOrders.length >= limit) break;
      }

      console.log(`[BitgetService] Total órdenes obtenidas: ${allOrders.length}`);
      return allOrders;
    } catch (error: any) {
      console.error(`[BitgetService] Error al obtener historial de órdenes:`, error);
      throw new Error(`Error al obtener historial de órdenes de Bitget: ${error.response?.data?.msg || error.message}`);
    }
  }

  // Establecer TP/SL para una posición recién abierta (método básico - mantiene compatibilidad)
  async setPositionTPSL(
    credentials: BitgetCredentials,
    symbol: string,
    side: 'buy' | 'sell',
    stopLossPrice: number,
    takeProfitPrice: number,
    productType: string = 'USDT-FUTURES',
    marginCoin: string = 'USDT',
    positionSize?: string,
    contractInfo?: any,
    logContext?: {
      userId: number;
      strategyId: number | null;
      orderId?: string;
      tradeId?: string | number | null;
    },
    knownCurrentPrice?: number
  ): Promise<any> {
    try {
      const holdSide = side === 'buy' ? 'long' : 'short';
      const endpoint = '/api/v2/mix/order/place-tpsl-order';
      
      console.log(`[Bitget] 🚀 Configurando TP/SL en PARALELO para ${symbol} ${holdSide}...`);

      // If positionSize not provided, query current position to get total size
      if (!positionSize) {
        try {
          console.log(`[Bitget] 📋 positionSize no proporcionado, consultando posición abierta...`);
          const posResponse = await this.makeRequest('GET',
            `/api/v2/mix/position/single-position?symbol=${symbol.toUpperCase()}&productType=${productType.toUpperCase()}&marginCoin=${marginCoin.toUpperCase()}`,
            credentials
          );
          const positions = posResponse?.data || [];
          const pos = positions.find((p: any) => p.holdSide === holdSide);
          if (pos && pos.total) {
            positionSize = pos.total;
            console.log(`[Bitget] ✅ Tamaño de posición obtenido: ${positionSize}`);
          } else {
            console.error(`[Bitget] ❌ No se encontró posición ${holdSide} para ${symbol}. No se puede configurar TP/SL.`);
            return [];
          }
        } catch (posError: any) {
          console.error(`[Bitget] ❌ Error al obtener posición: ${posError.message}. No se puede configurar TP/SL sin tamaño.`);
          return [];
        }
      }
      
      // Aplicar precisión de precio según contractInfo
      const pricePlace = contractInfo?.pricePlace ? parseInt(contractInfo.pricePlace) : 4;
      const formattedTP = parseFloat(takeProfitPrice.toFixed(pricePlace));
      const formattedSL = parseFloat(stopLossPrice.toFixed(pricePlace));
      
      console.log(`[Bitget] 📊 Precisión de precio: ${pricePlace} decimales`);
      console.log(`[Bitget] 📊 TP: ${takeProfitPrice} → ${formattedTP}`);
      console.log(`[Bitget] 📊 SL: ${stopLossPrice} → ${formattedSL}`);
      
      // Usar precio conocido si se proporcionó, sino obtener de Bitget (optimización: ahorra 1 API call)
      let currentPrice: number | null = knownCurrentPrice || null;
      if (!currentPrice) {
        try {
          const tickerPrice = await this.getTickerPrice(symbol, productType);
          const parsedPrice = parseFloat(tickerPrice);
          if (!isNaN(parsedPrice) && parsedPrice > 0) {
            currentPrice = parsedPrice;
            console.log(`[Bitget] 📊 Precio actual de ${symbol}: ${currentPrice}`);
          } else {
            console.error(`[Bitget] ❌ Precio inválido obtenido: "${tickerPrice}". Continuando sin validación de precio.`);
          }
        } catch (priceError: any) {
          console.error(`[Bitget] ❌ Error al obtener precio actual: ${priceError.message}. Continuando sin validación de precio.`);
        }
      } else {
        console.log(`[Bitget] 📊 Usando precio conocido para validación: ${currentPrice} (sin llamada extra a Bitget)`);
      }
      
      // Generar clientOids únicos más cortos (solo timestamp + random, sin hrtime)
      const timestamp = Date.now();
      const baseId = `${timestamp}${Math.floor(Math.random() * 1000)}`;
      const tpRandom = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const slRandom = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      
      // Preparar ambas órdenes
      const tpClientOid = makeBitgetClientOid('TP', symbol, baseId, tpRandom);
      const tpPayload: any = {
        marginCoin: marginCoin.toUpperCase(),
        productType: productType.toUpperCase(),
        symbol: symbol.toUpperCase(),
        planType: 'pos_profit',
        triggerPrice: formattedTP.toString(),
        triggerType: 'fill_price',
        executePrice: formattedTP.toString(),
        holdSide,
        size: positionSize,
        clientOid: tpClientOid,
      };

      const slClientOid = makeBitgetClientOid('SL', symbol, baseId, slRandom);
      const slPayload: any = {
        marginCoin: marginCoin.toUpperCase(),
        productType: productType.toUpperCase(),
        symbol: symbol.toUpperCase(),
        planType: 'pos_loss',
        triggerPrice: formattedSL.toString(),
        triggerType: 'fill_price',
        executePrice: formattedSL.toString(),
        holdSide,
        size: positionSize,
        clientOid: slClientOid,
      };
      
      // Validar que TP sea mayor que el precio actual para long, o menor para short
      let isValidTP = true;
      if (currentPrice !== null) {
        isValidTP = (holdSide === 'long' && formattedTP > currentPrice) ||
                     (holdSide === 'short' && formattedTP < currentPrice);
        
        if (!isValidTP) {
          console.warn(`[Bitget] ⚠️ ADVERTENCIA: Take Profit (${formattedTP}) podría no ser válido para posición ${holdSide} con precio actual ${currentPrice}. Se configurará de todas formas.`);
        }
      } else {
        console.warn(`[Bitget] ⚠️ No se pudo obtener precio actual. Se configurará TP sin validación.`);
      }

      // Validar que SL sea menor que el precio actual para long, o mayor para short
      let isValidSL = true;
      if (currentPrice !== null) {
        isValidSL = (holdSide === 'long' && formattedSL < currentPrice) ||
                     (holdSide === 'short' && formattedSL > currentPrice);
        
        if (!isValidSL) {
          console.warn(`[Bitget] ⚠️ Stop Loss (${formattedSL}) no es válido para ${holdSide} con precio actual ${currentPrice}. Para ${holdSide}, SL debe ser ${holdSide === 'long' ? 'menor' : 'mayor'} que el precio actual. Se omitirá SL.`);
        }
      }
      
      // Ejecutar órdenes en PARALELO (solo las válidas)
      console.log(`[Bitget] 📋 Ejecutando TP y SL simultáneamente...`);
      console.log(`[Bitget]   - TP en ${takeProfitPrice} (${isValidTP ? 'válido' : 'OMITIDO - inválido'})`);
      console.log(`[Bitget]   - SL en ${stopLossPrice} (${isValidSL ? 'válido' : 'OMITIDO - inválido'})`);
      
      const promises: Promise<any>[] = [];
      
      // Agregar TP solo si es válido
      if (isValidTP) {
        promises.push(
          this.makeRequest('POST', endpoint, credentials, tpPayload, logContext ? {
            userId: logContext.userId,
            strategyId: logContext.strategyId,
            tradeId: logContext.tradeId,
            symbol: symbol,
            operationType: 'setTakeProfit',
            orderId: logContext.orderId,
            clientOid: tpPayload.clientOid,
          } : undefined).then(result => {
            console.log(`[Bitget] ✅ Take Profit configurado exitosamente`);
            return { type: 'take_profit', result, success: true };
          }).catch(error => {
            console.error(`[Bitget] ❌ Error en Take Profit: ${error.message}`);
            return { type: 'take_profit', error: error.message, success: false };
          })
        );
      } else {
        // TP omitido - agregar resultado sintético de fallo
        promises.push(
          Promise.resolve({ type: 'take_profit', error: `TP (${formattedTP}) inválido para ${holdSide} con precio ${currentPrice}`, success: false, skipped: true })
        );
      }
      
      // Agregar SL solo si es válido
      if (isValidSL) {
        promises.push(
          this.makeRequest('POST', endpoint, credentials, slPayload, logContext ? {
            userId: logContext.userId,
            strategyId: logContext.strategyId,
            tradeId: logContext.tradeId,
            symbol: symbol,
            operationType: 'setStopLoss',
            orderId: logContext.orderId,
            clientOid: slPayload.clientOid,
          } : undefined).then(result => {
            console.log(`[Bitget] ✅ Stop Loss configurado exitosamente`);
            return { type: 'stop_loss', result, success: true };
          }).catch(error => {
            console.error(`[Bitget] ❌ Error en Stop Loss: ${error.message}`);
            return { type: 'stop_loss', error: error.message, success: false };
          })
        );
      } else {
        // SL omitido - agregar resultado sintético de fallo
        promises.push(
          Promise.resolve({ type: 'stop_loss', error: `SL (${formattedSL}) inválido para ${holdSide} con precio ${currentPrice}`, success: false, skipped: true })
        );
      }
      
      const results = await Promise.all(promises);
      const tpResult = results[0];
      const slResult = results[1];
      
      const successCount = results.filter(r => r.success).length;
      console.log(`[Bitget] ✅ TP/SL configurado: ${successCount}/${promises.length} órdenes exitosas`);

      return [tpResult, slResult];
    } catch (error: any) {
      throw new Error(`Error al configurar TP/SL: ${error.message}`);
    }
  }

  /**
   * Configura en la apertura: SL 100% + TP 50% en breakeven + TP 50% en takeProfit.
   * Todo en una sola pasada al abrir; no hace falta alerta BREAKEVEN posterior.
   * Si Bitget rechaza (ej. límite de órdenes plan), el caller puede hacer fallback a setAdvancedPositionTPSL.
   */
  async setPositionTPSLWithPartialAtOpen(
    credentials: BitgetCredentials,
    symbol: string,
    side: 'buy' | 'sell',
    stopLossPrice: number,
    breakevenPrice: number,
    takeProfitPrice: number,
    positionSize: string,
    productType: string = 'USDT-FUTURES',
    marginCoin: string = 'USDT',
    contractInfo?: any,
    logContext?: {
      userId: number;
      strategyId: number | null;
      orderId?: string;
      tradeId?: string | number | null;
    },
    knownCurrentPrice?: number
  ): Promise<{ results: any[]; success: boolean; fallbackRecommended?: boolean }> {
    try {
      const holdSide = side === 'buy' ? 'long' : 'short';
      const endpoint = '/api/v2/mix/order/place-tpsl-order';

      const pricePlace = contractInfo?.pricePlace ? parseInt(contractInfo.pricePlace) : 4;
      const sizeMultiplier = parseFloat(contractInfo?.sizeMultiplier || '0.01');
      const minTradeNum = parseFloat(contractInfo?.minTradeNum || '0.01');
      const volumePlace = contractInfo?.volumePlace ? parseInt(contractInfo.volumePlace) : 2;

      const formattedSL = parseFloat(stopLossPrice.toFixed(pricePlace));
      const formattedBE = parseFloat(breakevenPrice.toFixed(pricePlace));
      const formattedTP = parseFloat(takeProfitPrice.toFixed(pricePlace));

      const totalSize = parseFloat(positionSize);
      let halfSize = Math.floor((totalSize / 2) / sizeMultiplier) * sizeMultiplier;
      if (halfSize < minTradeNum) {
        console.warn(`[Bitget] ⚠️ 50% de posición (${halfSize}) < mínimo (${minTradeNum}). Se recomienda fallback a TP/SL sin parcial.`);
        return { results: [], success: false, fallbackRecommended: true };
      }
      const halfSizeStr = halfSize.toFixed(volumePlace).replace(/\.?0+$/, '');

      let currentPrice: number | null = knownCurrentPrice ?? null;
      if (!currentPrice) {
        try {
          const tickerPrice = await this.getTickerPrice(symbol, productType);
          const parsed = parseFloat(tickerPrice);
          if (!isNaN(parsed) && parsed > 0) currentPrice = parsed;
        } catch (_) {}
      }

      const isValidSL = currentPrice == null || (holdSide === 'long' && formattedSL < currentPrice) || (holdSide === 'short' && formattedSL > currentPrice);
      const isValidTP = currentPrice == null || (holdSide === 'long' && formattedTP > currentPrice) || (holdSide === 'short' && formattedTP < currentPrice);
      const isValidBE = currentPrice == null || (holdSide === 'long' && formattedBE > currentPrice) || (holdSide === 'short' && formattedBE < currentPrice);

      const timestamp = Date.now();
      const rs = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const r5 = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
      const baseId = `${timestamp}_${rs}_${r5}_${crypto.randomBytes(4).toString('hex')}`;

      const orders: Array<{ type: string; payload: any }> = [];

      if (isValidSL) {
        orders.push({
          type: 'stop_loss',
          payload: {
            marginCoin: marginCoin.toUpperCase(),
            productType: productType.toUpperCase(),
            symbol: symbol.toUpperCase(),
            planType: 'pos_loss',
            triggerPrice: formattedSL.toString(),
            triggerType: 'fill_price',
            executePrice: formattedSL.toString(),
            holdSide,
            size: positionSize,
            clientOid: makeBitgetClientOid('SL', symbol, baseId, String(Math.floor(Math.random() * 1000))),
          },
        });
      }

      if (isValidBE) {
        orders.push({
          type: 'take_profit_partial',
          payload: {
            marginCoin: marginCoin.toUpperCase(),
            productType: productType.toUpperCase(),
            symbol: symbol.toUpperCase(),
            planType: 'pos_profit',
            triggerPrice: formattedBE.toString(),
            triggerType: 'fill_price',
            executePrice: formattedBE.toString(),
            holdSide,
            size: halfSizeStr,
            clientOid: makeBitgetClientOid('TP_BE', symbol, baseId, String(Math.floor(Math.random() * 1000))),
          },
        });
      }

      if (isValidTP) {
        orders.push({
          type: 'take_profit_final',
          payload: {
            marginCoin: marginCoin.toUpperCase(),
            productType: productType.toUpperCase(),
            symbol: symbol.toUpperCase(),
            planType: 'pos_profit',
            triggerPrice: formattedTP.toString(),
            triggerType: 'fill_price',
            executePrice: formattedTP.toString(),
            holdSide,
            size: halfSizeStr,
            clientOid: makeBitgetClientOid('TP_F', symbol, baseId, String(Math.floor(Math.random() * 1000))),
          },
        });
      }

      console.log(`[Bitget] 🚀 Configurando TP/SL con parcial al abrir: SL 100%, TP 50% en BE, TP 50% en TP final (${orders.length} órdenes)`);

      const results = await Promise.all(
        orders.map(async (order) => {
          try {
            const result = await this.makeRequest('POST', endpoint, credentials, order.payload, logContext ? {
              userId: logContext.userId,
              strategyId: logContext.strategyId,
              tradeId: logContext.tradeId,
              symbol: symbol,
              operationType: order.type,
              orderId: logContext.orderId,
              clientOid: order.payload.clientOid,
            } : undefined);
            return { type: order.type, result, success: true };
          } catch (error: any) {
            console.error(`[Bitget] ❌ Error en ${order.type}: ${error.message}`);
            return { type: order.type, error: error.message, success: false };
          }
        })
      );

      const slOk = results.some(r => r.type === 'stop_loss' && r.success);
      const tpPartialOk = results.some(r => r.type === 'take_profit_partial' && r.success);
      const tpFinalOk = results.some(r => r.type === 'take_profit_final' && r.success);
      const success = slOk && (tpPartialOk || tpFinalOk); // al menos un TP
      if (!success && (results.some(r => r.error && /size|exceed|limit|reduce/i.test(r.error)))) {
        return { results, success: false, fallbackRecommended: true };
      }
      return { results, success };
    } catch (error: any) {
      console.error(`[Bitget] ❌ setPositionTPSLWithPartialAtOpen:`, error.message);
      return { results: [], success: false, fallbackRecommended: true };
    }
  }

  // Configurar TP/SL para estrategias con breakeven
  // Al abrir el trade: SL (100%) + TP (100%) al precio final
  // El breakeven se manejará cuando TradingView envíe la alerta BREAKEVEN
  // (processBreakevenAlert cancelará estos triggers, cerrará 50% y creará nuevos SL+TP para el 50% restante)
  async setAdvancedPositionTPSL(
    credentials: BitgetCredentials,
    symbol: string,
    side: 'buy' | 'sell',
    stopLossPrice: number,
    breakevenPrice: number | null,
    takeProfitPrice: number,
    positionSize: string, // Tamaño total de la posición
    productType: string = 'USDT-FUTURES',
    marginCoin: string = 'USDT',
    contractInfo?: any,
    logContext?: {
      userId: number;
      strategyId: number | null;
      orderId?: string;
      tradeId?: string | number | null;
    },
    knownCurrentPrice?: number
  ): Promise<any> {
    try {
      const holdSide = side === 'buy' ? 'long' : 'short';
      const endpoint = '/api/v2/mix/order/place-tpsl-order';
      
      console.log(`[Bitget] 🚀 Configurando TP/SL (100% SL + 100% TP) para ${symbol} ${holdSide}...`);
      if (breakevenPrice) {
        console.log(`[Bitget] ℹ️ Breakeven (${breakevenPrice}) se procesará cuando TradingView envíe la alerta BREAKEVEN`);
      }
      
      // Aplicar precisión de precio según contractInfo
      const pricePlace = contractInfo?.pricePlace ? parseInt(contractInfo.pricePlace) : 4;
      const formattedSL = parseFloat(stopLossPrice.toFixed(pricePlace));
      const formattedTP = parseFloat(takeProfitPrice.toFixed(pricePlace));
      
      console.log(`[Bitget] 📊 Precisión de precio: ${pricePlace} decimales`);
      console.log(`[Bitget] 📊 SL: ${stopLossPrice} → ${formattedSL}`);
      console.log(`[Bitget] 📊 TP: ${takeProfitPrice} → ${formattedTP}`);
      
      // Usar precio conocido si se proporcionó, sino obtener de Bitget (optimización: ahorra 1 API call)
      let currentPrice: number | null = knownCurrentPrice || null;
      if (!currentPrice) {
        try {
          const tickerPrice = await this.getTickerPrice(symbol, productType);
          const parsedPrice = parseFloat(tickerPrice);
          if (!isNaN(parsedPrice) && parsedPrice > 0) {
            currentPrice = parsedPrice;
            console.log(`[Bitget] 📊 Precio actual de ${symbol}: ${currentPrice}`);
          } else {
            console.error(`[Bitget] ❌ Precio inválido obtenido: "${tickerPrice}". No se validará TP.`);
          }
        } catch (priceError: any) {
          console.error(`[Bitget] ❌ Error al obtener precio actual: ${priceError.message}. No se validará TP.`);
        }
      } else {
        console.log(`[Bitget] 📊 Usando precio conocido para validación: ${currentPrice} (sin llamada extra a Bitget)`);
      }
      
      // Generar timestamp único
      const timestamp = Date.now();
      const baseId = `${timestamp}${Math.floor(Math.random() * 1000)}`;
      
      // Preparar órdenes: SL (100%) + TP (100%)
      const orders: Array<{type: string; payload: any; description: string}> = [];
      
      // Validar SL contra precio actual
      let isValidSL = true;
      if (currentPrice !== null) {
        isValidSL = (holdSide === 'long' && formattedSL < currentPrice) ||
                     (holdSide === 'short' && formattedSL > currentPrice);
        if (!isValidSL) {
          console.warn(`[Bitget] ⚠️ Stop Loss (${formattedSL}) no es válido para ${holdSide} con precio actual ${currentPrice}. Se omitirá SL.`);
        }
      }

      // 1. Stop Loss (cierra toda la posición) - solo si es válido
      if (isValidSL) {
        const slRandom = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        const slClientOid = makeBitgetClientOid('SL', symbol, baseId, slRandom);
        const slPayload: any = {
          marginCoin: marginCoin.toUpperCase(),
          productType: productType.toUpperCase(),
          symbol: symbol.toUpperCase(),
          planType: 'pos_loss',
          triggerPrice: formattedSL.toString(),
          triggerType: 'fill_price',
          executePrice: formattedSL.toString(),
          holdSide,
          size: positionSize,
          clientOid: slClientOid,
        };
        orders.push({ type: 'stop_loss', payload: slPayload, description: `SL 100% (${positionSize}) en ${formattedSL}` });
      }

      // 2. Take Profit final (100% de la posición al precio de TP)
      // Validar que TP sea mayor que el precio actual para long, o menor para short
      let isValidTP = true;
      if (currentPrice !== null) {
        isValidTP = (holdSide === 'long' && formattedTP > currentPrice) ||
                     (holdSide === 'short' && formattedTP < currentPrice);
        if (!isValidTP) {
          console.warn(`[Bitget] ⚠️ ADVERTENCIA: Take Profit (${formattedTP}) no es válido para posición ${holdSide} con precio actual ${currentPrice}. Se omitirá TP.`);
        }
      } else {
        console.warn(`[Bitget] ⚠️ No se pudo obtener precio actual. Se configurará TP sin validación.`);
      }
      
      // Solo agregar TP si es válido o si no se pudo validar (currentPrice null)
      if (isValidTP || currentPrice === null) {
        const tpRandom = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        const tpClientOid = makeBitgetClientOid('TP_F', symbol, baseId, tpRandom);
        const tpPayload: any = {
          marginCoin: marginCoin.toUpperCase(),
          productType: productType.toUpperCase(),
          symbol: symbol.toUpperCase(),
          planType: 'pos_profit',
          triggerPrice: formattedTP.toString(),
          triggerType: 'fill_price',
          executePrice: formattedTP.toString(),
          holdSide,
          size: positionSize,
          clientOid: tpClientOid,
        };
        orders.push({ type: 'take_profit_final', payload: tpPayload, description: `TP 100% (${positionSize}) en ${formattedTP}` });
      }

      // Ejecutar ambas órdenes en PARALELO
      console.log(`[Bitget] 📋 Ejecutando ${orders.length} órdenes TP/SL simultáneamente...`);
      orders.forEach(order => console.log(`[Bitget]   - ${order.description}`));
      
      const results = await Promise.all(
        orders.map(async (order) => {
          try {
            const result = await this.makeRequest('POST', endpoint, credentials, order.payload, logContext ? {
              userId: logContext.userId,
              strategyId: logContext.strategyId,
              tradeId: logContext.tradeId,
              symbol: symbol,
              operationType: order.type,
              orderId: logContext.orderId,
              clientOid: order.payload.clientOid,
            } : undefined);
            console.log(`[Bitget] ✅ ${order.description} configurado exitosamente`);
            return { type: order.type, result, success: true };
          } catch (error: any) {
            console.error(`[Bitget] ❌ Error en ${order.description}: ${error.message}`);
            return { type: order.type, error: error.message, success: false };
          }
        })
      );
      
      const successCount = results.filter(r => r.success).length;
      console.log(`[Bitget] ✅ TP/SL configurado: ${successCount}/${orders.length} órdenes exitosas`);

      return results;
    } catch (error: any) {
      console.error(`[Bitget] ❌ Error al configurar TP/SL avanzado:`, error);
      throw new Error(`Error al configurar TP/SL avanzado: ${error.message}`);
    }
  }

  // Modificar stop loss de una posición usando place-pos-tpsl
  // Este endpoint permite establecer o modificar stop loss y take profit para una posición existente
  async modifyPositionStopLoss(
    credentials: BitgetCredentials,
    symbol: string,
    stopLossPrice: number,
    productType: string = 'USDT-FUTURES',
    marginCoin: string = 'USDT',
    takeProfitPrice?: number,
    contractInfo?: any,
    logContext?: {
      userId: number;
      strategyId: number | null;
      orderId?: string;
      tradeId?: string | number | null;
    }
  ): Promise<any> {
    try {
      // Obtener la posición para determinar holdSide y tamaño
      const positions = await this.getPositions(credentials, symbol, productType);
      if (!positions || positions.length === 0) {
        throw new Error('No se encontró posición abierta para el símbolo');
      }

      const position = positions[0];
      const holdSide = position.holdSide || (parseFloat(position.size) > 0 ? 'long' : 'short');

      // Aplicar precisión de precio según contractInfo
      const pricePlace = contractInfo?.pricePlace ? parseInt(contractInfo.pricePlace) : 4;
      const formattedStopLoss = parseFloat(stopLossPrice.toFixed(pricePlace));
      console.log(`[BitgetService] 📊 Precisión de precio: ${pricePlace} decimales`);
      console.log(`[BitgetService] 📊 Stop Loss: ${stopLossPrice} → ${formattedStopLoss}`);

      // Obtener precio actual para validar SL y TP
      let currentPrice: number | null = null;
      try {
        const tickerPrice = await this.getTickerPrice(symbol, productType);
        const parsedPrice = parseFloat(tickerPrice);
        if (!isNaN(parsedPrice) && parsedPrice > 0) {
          currentPrice = parsedPrice;
          console.log(`[BitgetService] 📊 Precio actual de ${symbol}: ${currentPrice}`);
        } else {
          console.error(`[BitgetService] ❌ Precio inválido obtenido: "${tickerPrice}".`);
        }
      } catch (priceError: any) {
        console.error(`[BitgetService] ❌ Error al obtener precio actual: ${priceError.message}`);
      }

      // Validar SL contra precio actual
      let isValidSL = true;
      if (currentPrice !== null) {
        isValidSL = (holdSide === 'long' && formattedStopLoss < currentPrice) ||
                     (holdSide === 'short' && formattedStopLoss > currentPrice);
        if (!isValidSL) {
          console.warn(`[BitgetService] ⚠️ Stop Loss (${formattedStopLoss}) no es válido para ${holdSide} con precio actual ${currentPrice}. Para ${holdSide}, SL debe ser ${holdSide === 'long' ? 'menor' : 'mayor'} que el precio actual. Se omitirá SL del payload.`);
        }
      }

      // Usar el endpoint place-pos-tpsl para establecer/modificar stop loss
      const endpoint = '/api/v2/mix/order/place-pos-tpsl';
      const payload: any = {
        marginCoin,
        productType: productType.toUpperCase(),
        symbol,
        holdSide,
      };

      // Incluir SL solo si es válido
      if (isValidSL) {
        payload.stopLossTriggerPrice = formattedStopLoss.toString();
        payload.stopLossTriggerType = 'fill_price';
        payload.stopLossExecutePrice = formattedStopLoss.toString();
        console.log(`[BitgetService] ✅ Stop Loss incluido: ${formattedStopLoss}`);
      }

      // Si hay take profit, validarlo y incluirlo solo si es válido
      if (takeProfitPrice) {
        const formattedTakeProfit = parseFloat(takeProfitPrice.toFixed(pricePlace));
        console.log(`[BitgetService] 📊 Take Profit: ${takeProfitPrice} → ${formattedTakeProfit}`);
        
        let isValidTP = false;
        if (currentPrice !== null) {
          isValidTP = (holdSide === 'long' && formattedTakeProfit > currentPrice) ||
                       (holdSide === 'short' && formattedTakeProfit < currentPrice);
        }
        
        if (currentPrice === null) {
          console.warn(`[BitgetService] ⚠️ No se pudo obtener precio actual. Se omitirá TP para evitar errores.`);
        } else if (!isValidTP) {
          console.warn(`[BitgetService] ⚠️ Take Profit (${formattedTakeProfit}) no es válido para posición ${holdSide} con precio actual ${currentPrice}. Se omitirá TP.`);
        }
        
        if (currentPrice !== null && isValidTP) {
          payload.stopSurplusTriggerPrice = formattedTakeProfit.toString();
          payload.stopSurplusTriggerType = 'fill_price';
          payload.stopSurplusExecutePrice = formattedTakeProfit.toString();
          console.log(`[BitgetService] ✅ Take Profit incluido en la modificación: ${formattedTakeProfit}`);
        }
      }

      // Verificar que haya algo que enviar
      const hasSL = !!payload.stopLossTriggerPrice;
      const hasTP = !!payload.stopSurplusTriggerPrice;
      if (!hasSL && !hasTP) {
        console.warn(`[BitgetService] ⚠️ Ni SL ni TP son válidos para ${holdSide} con precio actual ${currentPrice}. No se enviará la solicitud.`);
        return { skipped: true, reason: `SL (${formattedStopLoss}) y TP no son válidos para ${holdSide} con precio ${currentPrice}` };
      }
      if (!hasSL) {
        console.warn(`[BitgetService] ⚠️ Enviando solo TP (SL omitido por precio inválido)`);
      }

      return await this.makeRequest('POST', endpoint, credentials, payload, logContext ? {
        userId: logContext.userId,
        strategyId: logContext.strategyId,
        tradeId: logContext.tradeId,
        symbol: symbol,
        operationType: 'modifyStopLoss',
        orderId: logContext.orderId,
      } : undefined);
    } catch (error: any) {
      throw new Error(`Error al modificar stop loss: ${error.message}`);
    }
  }

  // Obtener órdenes trigger pendientes (TP/SL) para un símbolo.
  // Bitget GET orders-plan-pending exige planType con valores: normal_plan | track_plan | profit_loss.
  // pos_loss y pos_profit se obtienen con planType=profit_loss y filtrando por order.planType.
  async getPendingTriggerOrders(
    credentials: BitgetCredentials,
    symbol: string,
    productType: string = 'USDT-FUTURES',
    planType?: string, // 'pos_profit' | 'pos_loss' | 'normal_plan' | undefined (all)
    options?: { metrics?: { apiCalls: number } }
  ): Promise<any[]> {
    const fetchByApiPlanType = async (apiType: string): Promise<any[]> => {
      const params: Record<string, string> = {
        productType: productType.toUpperCase(),
        symbol: symbol.toUpperCase(),
        planType: apiType,
      };
      const queryString = Object.keys(params).map(key => `${key}=${params[key]}`).join('&');
      const endpoint = `/api/v2/mix/order/orders-plan-pending?${queryString}`;
      const result = await this.makeRequest('GET', endpoint, credentials, undefined, options?.metrics ? { metrics: options.metrics } : undefined);
      const orders = result?.entrustedList ?? result?.data?.entrustedList ?? (Array.isArray(result) ? result : []);
      return Array.isArray(orders) ? orders : [];
    };

    const filterByPlanType = (orders: any[], filter: string): any[] => {
      if (!filter) return orders;
      return orders.filter(o => (o.planType || '').toLowerCase() === filter.toLowerCase());
    };

    try {
      let list: any[];
      if (planType === 'pos_loss' || planType === 'pos_profit') {
        const profitLossOrders = await fetchByApiPlanType('profit_loss');
        list = filterByPlanType(profitLossOrders, planType);
      } else if (planType === 'normal_plan' || planType === 'track_plan') {
        list = await fetchByApiPlanType(planType);
      } else {
        const [normalPlan, trackPlan, profitLoss] = await Promise.all([
          fetchByApiPlanType('normal_plan'),
          fetchByApiPlanType('track_plan'),
          fetchByApiPlanType('profit_loss'),
        ]);
        const byId = new Map<string, any>();
        for (const o of [...normalPlan, ...trackPlan, ...profitLoss]) {
          const id = o.orderId || o.id;
          if (id && !byId.has(id)) byId.set(id, o);
        }
        list = Array.from(byId.values());
      }
      console.log(`[Bitget] 📋 Órdenes trigger pendientes para ${symbol}: ${list.length}`);
      return list;
    } catch (error: any) {
      console.error(`[Bitget] ❌ Error al obtener órdenes trigger pendientes: ${error.message}`);
      return [];
    }
  }

  // Cancelar todas las órdenes trigger (TP/SL) pendientes para un símbolo.
  // Usa listado por tipo (pos_loss, pos_profit, normal_plan) y hace una segunda pasada si quedan pendientes.
  async cancelAllTriggerOrders(
    credentials: BitgetCredentials,
    symbol: string,
    productType: string = 'USDT-FUTURES',
    marginCoin: string = 'USDT',
    logContext?: {
      userId: number;
      strategyId: number | null;
      orderId?: string;
      tradeId?: string | number | null;
    }
  ): Promise<{ cancelled: number; failed: number; remaining: number }> {
    const endpoint = '/api/v2/mix/order/cancel-plan-order';
    const cancelOne = async (order: any): Promise<boolean> => {
      const orderId = order.orderId || order.id;
      if (!orderId) return false;
      try {
        await this.makeRequest('POST', endpoint, credentials, {
          symbol: symbol.toUpperCase(),
          productType: productType.toUpperCase(),
          marginCoin: marginCoin.toUpperCase(),
          orderId,
        }, logContext ? {
          userId: logContext.userId,
          strategyId: logContext.strategyId,
          tradeId: logContext.tradeId,
          symbol,
          operationType: 'cancelTriggerOrder',
          orderId: logContext.orderId,
        } : undefined);
        console.log(`[Bitget] ✅ Orden trigger ${orderId} (${order.planType || 'unknown'}) cancelada`);
        return true;
      } catch (e: any) {
        console.error(`[Bitget] ❌ Error al cancelar orden trigger ${orderId}: ${e.message}`);
        return false;
      }
    };

    try {
      console.log(`[Bitget] 🗑️ Cancelando todas las órdenes trigger para ${symbol}...`);
      let pendingOrders = await this.getPendingTriggerOrders(credentials, symbol, productType);

      if (pendingOrders.length === 0) {
        console.log(`[Bitget] ℹ️ No hay órdenes trigger pendientes para cancelar en ${symbol}`);
        return { cancelled: 0, failed: 0, remaining: 0 };
      }

      console.log(`[Bitget] 📋 Encontradas ${pendingOrders.length} órdenes trigger pendientes para cancelar`);

      const results = await Promise.all(pendingOrders.map(cancelOne));
      let cancelled = results.filter(r => r === true).length;
      let failed = results.length - cancelled;

      const stillPending = await this.getPendingTriggerOrders(credentials, symbol, productType);
      if (stillPending.length > 0) {
        console.log(`[Bitget] 🔄 Segunda pasada: ${stillPending.length} triggers aún pendientes`);
        const retryResults = await Promise.all(stillPending.map(cancelOne));
        cancelled += retryResults.filter(r => r === true).length;
        failed += retryResults.filter(r => r === false).length;
      }

      const remaining = await this.getPendingTriggerOrders(credentials, symbol, productType).then(l => l.length);
      console.log(`[Bitget] 🗑️ Resultado: ${cancelled} canceladas, ${failed} fallidas, ${remaining} restantes`);
      return { cancelled, failed, remaining };
    } catch (error: any) {
      console.error(`[Bitget] ❌ Error al cancelar órdenes trigger: ${error.message}`);
      throw error;
    }
  }

  // Obtener posiciones abiertas
  async getPositions(
    credentials: BitgetCredentials,
    symbol?: string,
    productType: string = 'USDT-FUTURES',
    options?: { metrics?: { apiCalls: number } }
  ): Promise<any> {
    let endpoint = `/api/v2/mix/position/all-position?productType=${productType}`;
    if (symbol) {
      endpoint += `&symbol=${symbol}`;
    }
    
    const result = await this.makeRequest('GET', endpoint, credentials, undefined, options?.metrics ? { metrics: options.metrics } : undefined);
    
    // Log para diagnóstico: qué devolvió la API (símbolos y cantidad)
    if (result && Array.isArray(result)) {
      const symbolsReturned = result.map((p: any) => p.symbol || p.symbolName || '?').filter(Boolean);
      console.log('[BitgetService] getPositions: requested symbol=', symbol, '| positions returned=', result.length, '| symbols=', symbolsReturned.join(', ') || 'none');
      if (result.length > 0) {
        console.log('[BitgetService] Open position fields:', Object.keys(result[0]));
        // Solo loguear ejemplo del símbolo solicitado si existe, sino el primero
        const forSymbol = symbol ? result.find((p: any) => (p.symbol || p.symbolName || '').toUpperCase() === symbol?.toUpperCase()) : result[0];
        console.log('[BitgetService] Open position example:', JSON.stringify(forSymbol || result[0], null, 2));
      }
    } else if (result && !Array.isArray(result)) {
      console.log('[BitgetService] getPositions: result is not an array:', typeof result, Object.keys(result || {}));
    }
    
    return result;
  }

  /**
   * Cierra una posición (market) y cancela todos sus triggers (normal_plan y pos_loss)
   */
  async closePositionAndCancelTriggers(
    credentials: BitgetCredentials,
    positionData: {
      symbol: string;
      side: 'buy' | 'sell';
      productType?: string;
      marginMode?: string;
    },
    logContext?: { userId: number; strategyId: number | null; orderId?: string; tradeId?: string | number | null }
  ): Promise<{ success: boolean; closedSize?: string; cancelledTriggers?: any; remainingTriggers?: number; error?: string }> {
    try {
      const symbol = positionData.symbol.toUpperCase();
      const productType = (positionData.productType || 'USDT-FUTURES').toUpperCase();
      const holdSide = positionData.side === 'buy' ? 'long' : 'short';
      const marginCoin = 'USDT';

      console.log(`[Bitget] 🔄 Intentando cerrar posición ${holdSide} de ${symbol}...`);

      // 1) Obtener la posición actual para saber el tamaño (filtrar por symbol: la API puede devolver todas las posiciones)
      const positionsRaw = await this.getPositions(credentials, symbol, productType);
      const positions = Array.isArray(positionsRaw) ? positionsRaw : [];
      const position = positions.find((p: any) => {
        const pSymbol = (p.symbol || p.symbolName || '').toUpperCase();
        const matchSymbol = pSymbol === symbol;
        const matchSide = (p.holdSide || '').toLowerCase() === holdSide;
        const size = parseFloat(p.total || p.openDelegateSize || p.available || '0');
        const hasSize = size > 0;
        return matchSymbol && matchSide && hasSize;
      });

      let closedSize = '0';

      if (!position) {
        const symbolsInResponse = positions.map((p: any) => `${p.symbol || p.symbolName}:${(p.holdSide || '').toLowerCase()}=${p.total || p.available || '0'}`);
        console.warn(`[Bitget] ⚠️ No se encontró posición abierta ${holdSide} para ${symbol}. Solo se cancelarán triggers. Posiciones devueltas por API: [${symbolsInResponse.join(', ')}]`);
      } else {
        // Usar la misma prioridad que el filtro: total primero (evita size 0 cuando available=0)
        const sizeToClose = position.total ?? position.available ?? position.openDelegateSize ?? '0';
        closedSize = String(sizeToClose);
        const closeSide = positionData.side === 'buy' ? 'sell' : 'buy';
        const sizeNum = parseFloat(closedSize);
        if (sizeNum <= 0) {
          console.warn(`[Bitget] ⚠️ Tamaño a cerrar inválido (${closedSize}). No se envía placeOrder; solo se cancelarán triggers.`);
        } else {
          console.log(`[Bitget] 📋 Posición a cerrar: symbol=${position.symbol || position.symbolName}, holdSide=${position.holdSide}, size=${sizeToClose}`);
          console.log(`[Bitget] 📤 Enviando orden market para cerrar ${sizeToClose} contratos...`);
          try {
            await this.placeOrder(credentials, {
              symbol,
              productType,
              marginMode: positionData.marginMode || position.marginMode || 'isolated',
              marginCoin,
              size: closedSize,
              side: closeSide,
              tradeSide: 'close',
              orderType: 'market',
              holdSide,
              reduceOnly: 'YES'
            }, logContext);
            console.log(`[Bitget] ✅ Posición cerrada exitosamente.`);
          } catch (closeError: any) {
            const isNoPositionToClose = closeError.message && (
              closeError.message.includes('No position to close') || closeError.message.includes('22002')
            );
            if (isNoPositionToClose) {
              console.warn(`[Bitget] ⚠️ Posición ya no existe (probablemente cerrada por SL/TP). Error: ${closeError.message}`);
              console.log(`[Bitget] 🔄 Continuando con cancelación de triggers...`);
            } else {
              throw closeError;
            }
          }
        }
      }

      // 3) Cancelar todos los triggers pendientes para este símbolo
      console.log(`[Bitget] 🗑️ Buscando triggers pendientes para cancelar...`);
      const cancelledTriggers = await this.cancelAllTriggerOrders(credentials, symbol, productType, marginCoin, logContext);
      
      // 4) Verificar si quedaron triggers
      let remainingTriggers = 0;
      try {
        const remainingNormal = await this.getPendingTriggerOrders(credentials, symbol, productType, 'normal_plan');
        const remainingLoss = await this.getPendingTriggerOrders(credentials, symbol, productType, 'pos_loss');
        const remainingProfit = await this.getPendingTriggerOrders(credentials, symbol, productType, 'pos_profit');
        remainingTriggers = remainingNormal.length + remainingLoss.length + remainingProfit.length;
        if (remainingTriggers > 0) {
          console.warn(`[Bitget] ⚠️ Quedaron ${remainingTriggers} triggers sin cancelar para ${symbol}`);
        } else {
          console.log(`[Bitget] ✅ Todos los triggers de ${symbol} fueron cancelados.`);
        }
      } catch (e) {}

      return {
        success: true,
        closedSize,
        cancelledTriggers,
        remainingTriggers
      };
    } catch (error: any) {
      console.error(`[Bitget] ❌ Error en closePositionAndCancelTriggers:`, error.message);
      return { success: false, error: error.message };
    }
  }

  // Obtener historial de posiciones cerradas
  async getPositionHistory(
    credentials: BitgetCredentials,
    productType: string = 'USDT-FUTURES',
    startTime?: number,
    endTime?: number,
    pageSize: number = 100,
    symbol?: string
  ): Promise<any[]> {
    try {
      const endpoint = '/api/v2/mix/position/history-position';
      
      const params: any = {
        productType: productType,
        pageSize: pageSize.toString(),
      };
      
      if (symbol) {
        params.symbol = symbol;
      }
      
      if (startTime) {
        params.startTime = startTime.toString();
      }
      
      if (endTime) {
        params.endTime = endTime.toString();
      }

      const queryString = Object.keys(params)
        .map(key => `${key}=${params[key]}`)
        .join('&');
      const requestPath = `${endpoint}?${queryString}`;

      const timestamp = Date.now().toString();
      const bodyString = '';

      const signature = this.generateSignature(
        timestamp,
        'GET',
        requestPath,
        bodyString,
        credentials.apiSecret
      );

      const headers: any = {
        'ACCESS-KEY': credentials.apiKey,
        'ACCESS-SIGN': signature,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': credentials.passphrase,
        'Content-Type': 'application/json',
        'locale': 'en-US',
      };

      const response = await axios({
        method: 'GET',
        url: `${this.apiBaseUrl}${endpoint}`,
        headers,
        params,
      });

      if (response.data.code === '00000') {
        const data = response.data.data;
        if (data && data.list) {
          console.log('[BitgetService] Position history response - Total positions:', data.list.length);
          if (data.list.length > 0) {
            console.log('[BitgetService] First position fields:', Object.keys(data.list[0]));
            console.log('[BitgetService] First position data:', JSON.stringify(data.list[0], null, 2));
          }
          return data.list;
        }
        return [];
      } else {
        throw new Error(`Bitget API Error: ${response.data.msg}`);
      }
    } catch (error: any) {
      console.error(`[BitgetService] Error al obtener historial de posiciones:`, error);
      throw new Error(`Error al obtener historial de posiciones de Bitget: ${error.response?.data?.msg || error.message}`);
    }
  }

  // Configurar apalancamiento para un símbolo
  async setLeverage(
    credentials: BitgetCredentials,
    symbol: string,
    leverage: number,
    productType: string = 'USDT-FUTURES',
    marginCoin: string = 'USDT',
    holdSide?: 'long' | 'short',
    logContext?: {
      userId: number;
      strategyId: number | null;
      orderId?: string;
      tradeId?: string | number | null;
    }
  ): Promise<any> {
    const endpoint = '/api/v2/mix/account/set-leverage';
    
    // Asegurar que productType esté en el formato correcto (mayúsculas con guión)
    const normalizedProductType = productType.toUpperCase();
    
    const payload: any = {
      symbol: symbol.toUpperCase(),
      productType: normalizedProductType,
      marginCoin: marginCoin.toUpperCase(),
      leverage: leverage.toString(),
    };

    // Si se especifica holdSide, agregarlo (necesario para posiciones bidireccionales en modo isolated)
    if (holdSide) {
      payload.holdSide = holdSide;
    }

    console.log(`[BitgetService] 🔧 Configurando leverage a ${leverage}x para ${symbol} (${normalizedProductType}, ${marginCoin.toUpperCase()}, holdSide: ${holdSide || 'N/A'})`);
    
    try {
      const result = await this.makeRequest('POST', endpoint, credentials, payload, logContext ? {
        userId: logContext.userId,
        strategyId: logContext.strategyId,
        tradeId: logContext.tradeId,
        symbol: symbol,
        operationType: 'setLeverage',
        orderId: logContext.orderId,
      } : undefined);
      console.log(`[BitgetService] ✅ Leverage configurado exitosamente:`, result);
      return result;
    } catch (error: any) {
      console.error(`[BitgetService] ❌ Error al configurar leverage:`, error.message);
      console.error(`[BitgetService] Payload enviado:`, JSON.stringify(payload, null, 2));
      throw error; // Re-lanzar el error para que el llamador pueda manejarlo
    }
  }

  /**
   * Obtiene la tasa de comisión de trading desde Bitget (API v2 common trade-rate).
   * Requiere autenticación. Retorna maker y taker en decimal (ej. 0.0006 = 0.06%).
   * Si el endpoint falla o no existe, retorna null para usar valores por defecto.
   */
  async getTradeFeeRate(credentials: BitgetCredentials): Promise<{ maker: number; taker: number } | null> {
    try {
      const endpoint = '/api/v2/common/trade-rate';
      const data = await this.makeRequest('GET', endpoint, credentials);
      if (!data) return null;
      const maker = data.makerFeeRate ?? data.maker ?? data.makerFee;
      const taker = data.takerFeeRate ?? data.taker ?? data.takerFee;
      if (Array.isArray(data) && data.length > 0) {
        const first = data[0];
        const m = first.makerFeeRate ?? first.maker ?? first.makerFee;
        const t = first.takerFeeRate ?? first.taker ?? first.takerFee;
        const makerNum = typeof m === 'string' ? parseFloat(m) : Number(m);
        const takerNum = typeof t === 'string' ? parseFloat(t) : Number(t);
        if (Number.isFinite(makerNum) && Number.isFinite(takerNum)) {
          return { maker: makerNum, taker: takerNum };
        }
      }
      const makerNum = typeof maker === 'string' ? parseFloat(maker) : Number(maker);
      const takerNum = typeof taker === 'string' ? parseFloat(taker) : Number(taker);
      if (Number.isFinite(makerNum) && Number.isFinite(takerNum)) {
        return { maker: makerNum, taker: takerNum };
      }
      return null;
    } catch {
      return null;
    }
  }

  // Obtener saldo de la cuenta de futuros
  async getAccountBalance(
    credentials: BitgetCredentials,
    productType: string = 'USDT-FUTURES',
    marginCoin: string = 'USDT'
  ): Promise<{ available: number; equity: number; unrealizedPL: number; marginCoin: string }> {
    const endpoint = `/api/v2/mix/account/accounts?productType=${productType.toUpperCase()}`;
    const result = await this.makeRequest('GET', endpoint, credentials);

    if (!result || !Array.isArray(result) || result.length === 0) {
      throw new Error('No se pudo obtener información de la cuenta');
    }

    const account = result.find((a: any) => a.marginCoin?.toUpperCase() === marginCoin.toUpperCase()) || result[0];
    return {
      available: parseFloat(account.available || account.crossedMaxAvailable || '0'),
      equity: parseFloat(account.accountEquity || account.usdtEquity || '0'),
      unrealizedPL: parseFloat(account.unrealizedPL || '0'),
      marginCoin: account.marginCoin || marginCoin,
    };
  }

  // Validar conexión con Bitget usando las credenciales
  async validateConnection(credentials: BitgetCredentials): Promise<{ valid: boolean; message: string }> {
    try {
      // Intentar obtener información de la cuenta de futuros como prueba de conexión
      const endpoint = '/api/v2/mix/account/accounts';
      const params = 'productType=USDT-FUTURES';
      
      const timestamp = Date.now().toString();
      const requestPath = `${endpoint}?${params}`;
      const bodyString = '';
      
      const signature = this.generateSignature(
        timestamp,
        'GET',
        requestPath,
        bodyString,
        credentials.apiSecret
      );

      const headers: any = {
        'ACCESS-KEY': credentials.apiKey,
        'ACCESS-SIGN': signature,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': credentials.passphrase,
        'Content-Type': 'application/json',
        'locale': 'en-US',
      };

      const response = await axios({
        method: 'GET',
        url: `${this.apiBaseUrl}${requestPath}`,
        headers,
      });

      if (response.data.code === '00000') {
        return {
          valid: true,
          message: 'Conexión exitosa. Las credenciales son válidas.',
        };
      } else {
        return {
          valid: false,
          message: `Error de Bitget: ${response.data.msg || 'Credenciales inválidas'}`,
        };
      }
    } catch (error: any) {
      return {
        valid: false,
        message: `Error al validar conexión: ${error.response?.data?.msg || error.message}`,
      };
    }
  }

  // Helper para obtener credenciales desencriptadas
  static getDecryptedCredentials(encryptedCredentials: {
    api_key: string;
    api_secret: string;
    passphrase: string;
  }): BitgetCredentials {
    return {
      apiKey: decrypt(encryptedCredentials.api_key),
      apiSecret: decrypt(encryptedCredentials.api_secret),
      passphrase: decrypt(encryptedCredentials.passphrase),
    };
  }
}

