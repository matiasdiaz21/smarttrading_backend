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
          await BitgetOperationLogModel.create(
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
        } catch (logError: any) {
          // No fallar la operación principal si falla el log
          console.error('[BitgetService] Error al guardar log de operación:', logError.message);
        }
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

      if (response.data.code === '00000' && response.data.data) {
        const price = response.data.data.last;
        
        // Actualizar cache
        priceCache[cacheKey] = {
          price,
          timestamp: Date.now(),
        };
        
        return price;
      } else {
        throw new Error('Failed to get ticker price');
      }
    } catch (error: any) {
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
      
      // Generar clientOids únicos para TP y SL usando timestamp de alta precisión
      const tpslTimestamp = `${Date.now()}_${process.hrtime.bigint()}`;
      const tpRandom = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      const slRandom = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      
      // Preparar ambas órdenes
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
        clientOid: `TP_${symbol}_${tpslTimestamp}_${tpRandom}`,
      };

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
        clientOid: `SL_${symbol}_${tpslTimestamp}_${slRandom}`,
      };

      // Ejecutar AMBAS órdenes en PARALELO
      console.log(`[Bitget] 📋 Ejecutando TP y SL simultáneamente...`);
      console.log(`[Bitget]   - TP en ${takeProfitPrice}`);
      console.log(`[Bitget]   - SL en ${stopLossPrice}`);
      
      const [tpResult, slResult] = await Promise.all([
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
        }),
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
      ]);
      
      const successCount = [tpResult, slResult].filter(r => r.success).length;
      console.log(`[Bitget] ✅ TP/SL configurado: ${successCount}/2 órdenes exitosas`);

      return [tpResult, slResult];
    } catch (error: any) {
      throw new Error(`Error al configurar TP/SL: ${error.message}`);
    }
  }

  // Configurar múltiples órdenes TP/SL incluyendo breakeven parcial
  // Configura: Stop Loss, Take Profit parcial (50%) en breakeven, Take Profit final (50%) en takeProfit
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
      
      console.log(`[Bitget] 🚀 Configurando TP/SL en PARALELO para ${symbol} ${holdSide}...`);
      
      // Aplicar precisión de precio según contractInfo
      const pricePlace = contractInfo?.pricePlace ? parseInt(contractInfo.pricePlace) : 4;
      const formattedSL = parseFloat(stopLossPrice.toFixed(pricePlace));
      const formattedBreakeven = breakevenPrice ? parseFloat(breakevenPrice.toFixed(pricePlace)) : null;
      const formattedTP = parseFloat(takeProfitPrice.toFixed(pricePlace));
      
      console.log(`[Bitget] 📊 Precisión de precio: ${pricePlace} decimales`);
      console.log(`[Bitget] 📊 SL: ${stopLossPrice} → ${formattedSL}`);
      if (formattedBreakeven) console.log(`[Bitget] 📊 Breakeven: ${breakevenPrice} → ${formattedBreakeven}`);
      console.log(`[Bitget] 📊 TP: ${takeProfitPrice} → ${formattedTP}`);
      
      // Generar timestamp único de alta precisión para todas las órdenes TP/SL
      const advancedTpslTimestamp = `${Date.now()}_${process.hrtime.bigint()}`;
      
      // Preparar todas las órdenes
      const orders: Array<{type: string; payload: any; description: string}> = [];
      
      // 1. Stop Loss (cierra toda la posición)
      const slRandom = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
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
        clientOid: `SL_${symbol}_${advancedTpslTimestamp}_${slRandom}`,
      };
      orders.push({ type: 'stop_loss', payload: slPayload, description: `SL en ${formattedSL}` });

      // 2. Take Profit parcial en breakeven (si existe)
      if (formattedBreakeven && formattedBreakeven > 0) {
        const positionSizeNum = parseFloat(positionSize);
        const breakevenSize = (positionSizeNum * 0.5).toFixed(contractInfo?.volumePlace ? parseInt(contractInfo.volumePlace) : 0);
        const breakevenRandom = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        
        const breakevenPayload: any = {
          marginCoin: marginCoin.toUpperCase(),
          productType: productType.toLowerCase(),
          symbol: symbol.toUpperCase(),
          planType: 'pos_profit',
          triggerPrice: formattedBreakeven.toString(),
          triggerType: 'fill_price',
          executePrice: formattedBreakeven.toString(),
          holdSide,
          size: breakevenSize,
          clientOid: `TP_BREAKEVEN_${symbol}_${advancedTpslTimestamp}_${breakevenRandom}`,
        };
        orders.push({ type: 'breakeven_tp_50', payload: breakevenPayload, description: `TP 50% (${breakevenSize}) en breakeven ${formattedBreakeven}` });
      }

      // 3. Take Profit final
      let finalTPSize: string;
      let finalTPDescription: string;
      
      if (formattedBreakeven && formattedBreakeven > 0) {
        const positionSizeNum = parseFloat(positionSize);
        finalTPSize = (positionSizeNum * 0.5).toFixed(contractInfo?.volumePlace ? parseInt(contractInfo.volumePlace) : 0);
        finalTPDescription = `50% restante (${finalTPSize})`;
      } else {
        finalTPSize = positionSize;
        finalTPDescription = `100% (${finalTPSize})`;
      }
      
      const tpFinalRandom = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      const tpPayload: any = {
        marginCoin: marginCoin.toUpperCase(),
        productType: productType.toLowerCase(),
        symbol: symbol.toUpperCase(),
        planType: 'pos_profit',
        triggerPrice: formattedTP.toString(),
        triggerType: 'fill_price',
        executePrice: formattedTP.toString(),
        holdSide,
        size: finalTPSize,
        clientOid: `TP_FINAL_${symbol}_${advancedTpslTimestamp}_${tpFinalRandom}`,
      };
      orders.push({ type: 'take_profit_final', payload: tpPayload, description: `TP ${finalTPDescription} en ${formattedTP}` });

      // Ejecutar TODAS las órdenes en PARALELO
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

      // Usar el endpoint place-pos-tpsl para establecer/modificar stop loss
      const endpoint = '/api/v2/mix/order/place-pos-tpsl';
      const payload: any = {
        marginCoin,
        productType: productType.toLowerCase(), // Bitget requiere lowercase
        symbol,
        holdSide,
        stopLossTriggerPrice: stopLossPrice.toString(),
        stopLossTriggerType: 'fill_price', // Usar fill_price para activación precisa
        stopLossExecutePrice: stopLossPrice.toString(), // Precio de ejecución igual al trigger
      };

      // Si hay take profit, incluirlo también
      if (takeProfitPrice) {
        payload.stopSurplusTriggerPrice = takeProfitPrice.toString();
        payload.stopSurplusTriggerType = 'fill_price';
        payload.stopSurplusExecutePrice = takeProfitPrice.toString();
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

