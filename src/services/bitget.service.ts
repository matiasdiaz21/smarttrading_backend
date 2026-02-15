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

export class BitgetService {
  private apiBaseUrl: string;

  constructor() {
    this.apiBaseUrl = config.bitget.apiBaseUrl;
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
      userId: number;
      strategyId: number | null;
      symbol: string;
      operationType: string;
      orderId?: string;
      clientOid?: string;
    }
  ): Promise<any> {
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
        errorMessage = `Bitget API Error: ${response.data.msg}`;
        throw new Error(errorMessage);
      }
    } catch (error: any) {
      responseStatus = error.response?.status || null;
      responseData = error.response?.data || null;
      errorMessage = error.response?.data?.msg || error.message;
      
      throw new Error(
        `Bitget API Request Failed: ${errorMessage}`
      );
    } finally {
      // Guardar log si se proporcionó contexto
      if (logContext) {
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
            logContext.strategyId,
            logContext.symbol,
            logContext.operationType,
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
            logContext.clientOid || null
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
  async getContractInfo(
    symbol: string,
    productType: string = 'USDT-FUTURES'
  ): Promise<{
    minTradeNum: string;
    sizeMultiplier: string;
    minTradeUSDT: string;
    volumePlace: string;
    pricePlace: string;
  }> {
    try {
      const response = await axios.get(
        `${this.apiBaseUrl}/api/v2/mix/market/contracts`,
        {
          params: {
            symbol,
            productType: productType.toLowerCase(),
          },
        }
      );

      if (response.data.code === '00000' && response.data.data && response.data.data.length > 0) {
        const contract = response.data.data[0];
        return {
          minTradeNum: contract.minTradeNum || '0.01',
          sizeMultiplier: contract.sizeMultiplier || '0.01',
          minTradeUSDT: contract.minTradeUSDT || '5',
          volumePlace: contract.volumePlace || '2',
          pricePlace: contract.pricePlace || '1',
        };
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
      clientOid?: string;
    },
    logContext?: {
      userId: number;
      strategyId: number | null;
      orderId?: string;
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
    }

    if (orderData.clientOid) {
      orderPayload.clientOid = orderData.clientOid;
    }

    const result = await this.makeRequest(
      'POST', 
      endpoint, 
      credentials, 
      orderPayload,
      logContext ? {
        userId: logContext.userId,
        strategyId: logContext.strategyId,
        symbol: orderData.symbol,
        operationType: 'placeOrder',
        orderId: logContext.orderId,
        clientOid: orderData.clientOid,
      } : undefined
    );
    
    const orderId = result.orderId || result.clientOid;
    const clientOid = result.clientOid || orderData.clientOid || '';
    
    return {
      orderId,
      clientOid,
    };
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

  // Obtener historial de órdenes del usuario desde Bitget
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
      
      // Construir query parameters
      const params: any = {
        productType: productType,
        limit: limit.toString(),
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

      // Construir el requestPath con query parameters para la firma
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
        // La respuesta tiene la estructura: { entrustedList: [...], endId: "..." }
        if (data && data.entrustedList) {
          return data.entrustedList;
        }
        return [];
      } else {
        throw new Error(`Bitget API Error: ${response.data.msg}`);
      }
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
    }
  ): Promise<any> {
    try {
      const holdSide = side === 'buy' ? 'long' : 'short';
      const endpoint = '/api/v2/mix/order/place-tpsl-order';
      
      console.log(`[Bitget] 🚀 Configurando TP/SL en PARALELO para ${symbol} ${holdSide}...`);
      
      // Aplicar precisión de precio según contractInfo
      const pricePlace = contractInfo?.pricePlace ? parseInt(contractInfo.pricePlace) : 4;
      const formattedTP = parseFloat(takeProfitPrice.toFixed(pricePlace));
      const formattedSL = parseFloat(stopLossPrice.toFixed(pricePlace));
      
      console.log(`[Bitget] 📊 Precisión de precio: ${pricePlace} decimales`);
      console.log(`[Bitget] 📊 TP: ${takeProfitPrice} → ${formattedTP}`);
      console.log(`[Bitget] 📊 SL: ${stopLossPrice} → ${formattedSL}`);
      
      // Obtener precio actual para validar TP
      let currentPrice: number | null = null;
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
      
      // Generar clientOids únicos más cortos (solo timestamp + random, sin hrtime)
      const timestamp = Date.now();
      const baseId = `${timestamp}${Math.floor(Math.random() * 1000)}`;
      const tpRandom = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const slRandom = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      
      // Preparar ambas órdenes
      const tpClientOid = `TP_${symbol.substring(0, 8)}_${baseId}_${tpRandom}`.substring(0, 64); // Limitar a 64 caracteres
      const tpPayload: any = {
        marginCoin: marginCoin.toUpperCase(),
        productType: productType.toLowerCase(),
        symbol: symbol.toUpperCase(),
        planType: 'pos_profit',
        triggerPrice: formattedTP.toString(),
        triggerType: 'fill_price',
        executePrice: formattedTP.toString(),
        holdSide,
        size: positionSize || 'all',
        clientOid: tpClientOid,
      };

      const slClientOid = `SL_${symbol.substring(0, 8)}_${baseId}_${slRandom}`.substring(0, 64);
      const slPayload: any = {
        marginCoin: marginCoin.toUpperCase(),
        productType: productType.toLowerCase(),
        symbol: symbol.toUpperCase(),
        planType: 'pos_loss',
        triggerPrice: formattedSL.toString(),
        triggerType: 'fill_price',
        executePrice: formattedSL.toString(),
        holdSide,
        size: positionSize || 'all',
        clientOid: slClientOid,
      };
      
      // Validar que TP sea mayor que el precio actual para long, o menor para short
      // SIEMPRE configurar el TP, solo mostrar advertencia si parece inválido
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
      
      // Ejecutar órdenes en PARALELO
      console.log(`[Bitget] 📋 Ejecutando TP y SL simultáneamente...`);
      console.log(`[Bitget]   - TP en ${takeProfitPrice}`);
      console.log(`[Bitget]   - SL en ${stopLossPrice}`);
      
      const promises: Promise<any>[] = [];
      
      // SIEMPRE agregar TP
      promises.push(
        this.makeRequest('POST', endpoint, credentials, tpPayload, logContext ? {
          userId: logContext.userId,
          strategyId: logContext.strategyId,
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
      
      // Siempre agregar SL
      promises.push(
        this.makeRequest('POST', endpoint, credentials, slPayload, logContext ? {
          userId: logContext.userId,
          strategyId: logContext.strategyId,
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
    }
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
      
      // Obtener precio actual para validar TP
      let currentPrice: number | null = null;
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
      
      // Generar timestamp único
      const timestamp = Date.now();
      const baseId = `${timestamp}${Math.floor(Math.random() * 1000)}`;
      
      // Preparar órdenes: SL (100%) + TP (100%)
      const orders: Array<{type: string; payload: any; description: string}> = [];
      
      // 1. Stop Loss (cierra toda la posición)
      const slRandom = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const slClientOid = `SL_${symbol.substring(0, 8)}_${baseId}_${slRandom}`.substring(0, 64);
      const slPayload: any = {
        marginCoin: marginCoin.toUpperCase(),
        productType: productType.toLowerCase(),
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

      // 2. Take Profit final (100% de la posición al precio de TP)
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
      
      const tpRandom = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const tpClientOid = `TP_F_${symbol.substring(0, 8)}_${baseId}_${tpRandom}`.substring(0, 64);
      const tpPayload: any = {
        marginCoin: marginCoin.toUpperCase(),
        productType: productType.toLowerCase(),
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

      // Ejecutar ambas órdenes en PARALELO
      console.log(`[Bitget] 📋 Ejecutando ${orders.length} órdenes TP/SL simultáneamente...`);
      orders.forEach(order => console.log(`[Bitget]   - ${order.description}`));
      
      const results = await Promise.all(
        orders.map(async (order) => {
          try {
            const result = await this.makeRequest('POST', endpoint, credentials, order.payload, logContext ? {
              userId: logContext.userId,
              strategyId: logContext.strategyId,
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

      // Obtener precio actual para validar take profit si se proporciona
      let currentPrice: number | null = null;
      if (takeProfitPrice) {
        try {
          const tickerPrice = await this.getTickerPrice(symbol, productType);
          const parsedPrice = parseFloat(tickerPrice);
          if (!isNaN(parsedPrice) && parsedPrice > 0) {
            currentPrice = parsedPrice;
            console.log(`[BitgetService] 📊 Precio actual de ${symbol}: ${currentPrice}`);
          } else {
            console.error(`[BitgetService] ❌ Precio inválido obtenido: "${tickerPrice}". No se validará TP.`);
          }
        } catch (priceError: any) {
          console.error(`[BitgetService] ❌ Error al obtener precio actual: ${priceError.message}. No se validará TP.`);
        }
      }

      // Usar el endpoint place-pos-tpsl para establecer/modificar stop loss
      const endpoint = '/api/v2/mix/order/place-pos-tpsl';
      const payload: any = {
        marginCoin,
        productType: productType.toLowerCase(), // Bitget requiere lowercase
        symbol,
        holdSide,
        stopLossTriggerPrice: formattedStopLoss.toString(),
        stopLossTriggerType: 'fill_price', // Usar fill_price para activación precisa
        stopLossExecutePrice: formattedStopLoss.toString(), // Precio de ejecución igual al trigger
      };

      // Si hay take profit, validarlo y incluirlo solo si es válido
      if (takeProfitPrice) {
        const formattedTakeProfit = parseFloat(takeProfitPrice.toFixed(pricePlace));
        console.log(`[BitgetService] 📊 Take Profit: ${takeProfitPrice} → ${formattedTakeProfit}`);
        
        // Validar que TP sea correcto según el tipo de posición
        // Para LONG: TP debe ser > precio actual
        // Para SHORT: TP debe ser < precio actual
        // Solo incluir TP si se pudo validar correctamente
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

      return await this.makeRequest('POST', endpoint, credentials, payload, logContext ? {
        userId: logContext.userId,
        strategyId: logContext.strategyId,
        symbol: symbol,
        operationType: 'modifyStopLoss',
        orderId: logContext.orderId,
      } : undefined);
    } catch (error: any) {
      throw new Error(`Error al modificar stop loss: ${error.message}`);
    }
  }

  // Obtener órdenes trigger pendientes (TP/SL) para un símbolo
  async getPendingTriggerOrders(
    credentials: BitgetCredentials,
    symbol: string,
    productType: string = 'USDT-FUTURES',
    planType?: string // 'pos_profit' | 'pos_loss' | undefined (all)
  ): Promise<any[]> {
    try {
      const params: any = {
        productType: productType.toLowerCase(),
        symbol: symbol.toUpperCase(),
      };
      if (planType) {
        params.planType = planType;
      }

      const queryString = Object.keys(params)
        .map(key => `${key}=${params[key]}`)
        .join('&');
      const endpoint = `/api/v2/mix/order/orders-plan-pending?${queryString}`;

      const result = await this.makeRequest('GET', endpoint, credentials);
      const orders = result?.entrustedList || result || [];
      console.log(`[Bitget] 📋 Órdenes trigger pendientes para ${symbol}: ${Array.isArray(orders) ? orders.length : 0}`);
      return Array.isArray(orders) ? orders : [];
    } catch (error: any) {
      console.error(`[Bitget] ❌ Error al obtener órdenes trigger pendientes: ${error.message}`);
      return [];
    }
  }

  // Cancelar todas las órdenes trigger (TP/SL) pendientes para un símbolo
  async cancelAllTriggerOrders(
    credentials: BitgetCredentials,
    symbol: string,
    productType: string = 'USDT-FUTURES',
    marginCoin: string = 'USDT',
    logContext?: {
      userId: number;
      strategyId: number | null;
      orderId?: string;
    }
  ): Promise<{ cancelled: number; failed: number }> {
    try {
      console.log(`[Bitget] 🗑️ Cancelando todas las órdenes trigger para ${symbol}...`);

      // Obtener todas las órdenes trigger pendientes
      const pendingOrders = await this.getPendingTriggerOrders(credentials, symbol, productType);

      if (pendingOrders.length === 0) {
        console.log(`[Bitget] ℹ️ No hay órdenes trigger pendientes para cancelar en ${symbol}`);
        return { cancelled: 0, failed: 0 };
      }

      console.log(`[Bitget] 📋 Encontradas ${pendingOrders.length} órdenes trigger pendientes para cancelar`);

      const endpoint = '/api/v2/mix/order/cancel-plan-order';
      let cancelled = 0;
      let failed = 0;

      // Cancelar cada orden individualmente
      for (const order of pendingOrders) {
        try {
          const orderId = order.orderId || order.id;
          if (!orderId) {
            console.warn(`[Bitget] ⚠️ Orden sin ID, omitiendo`);
            failed++;
            continue;
          }

          const payload = {
            symbol: symbol.toUpperCase(),
            productType: productType.toLowerCase(),
            marginCoin: marginCoin.toUpperCase(),
            orderId: orderId,
          };

          await this.makeRequest('POST', endpoint, credentials, payload, logContext ? {
            userId: logContext.userId,
            strategyId: logContext.strategyId,
            symbol: symbol,
            operationType: 'cancelTriggerOrder',
            orderId: logContext.orderId,
          } : undefined);

          console.log(`[Bitget] ✅ Orden trigger ${orderId} (${order.planType || 'unknown'}) cancelada`);
          cancelled++;
        } catch (cancelError: any) {
          console.error(`[Bitget] ❌ Error al cancelar orden trigger: ${cancelError.message}`);
          failed++;
        }
      }

      console.log(`[Bitget] 🗑️ Resultado: ${cancelled} canceladas, ${failed} fallidas de ${pendingOrders.length}`);
      return { cancelled, failed };
    } catch (error: any) {
      console.error(`[Bitget] ❌ Error al cancelar órdenes trigger: ${error.message}`);
      return { cancelled: 0, failed: 0 };
    }
  }

  // Obtener posiciones abiertas
  async getPositions(
    credentials: BitgetCredentials,
    symbol?: string,
    productType: string = 'USDT-FUTURES'
  ): Promise<any> {
    let endpoint = `/api/v2/mix/position/all-position?productType=${productType}`;
    if (symbol) {
      endpoint += `&symbol=${symbol}`;
    }
    
    const result = await this.makeRequest('GET', endpoint, credentials);
    
    // Log para ver estructura de posiciones abiertas
    if (result && result.length > 0) {
      console.log('[BitgetService] Open position fields:', Object.keys(result[0]));
      console.log('[BitgetService] Open position example:', JSON.stringify(result[0], null, 2));
    }
    
    return result;
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

