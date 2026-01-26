import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { config } from '../config';
import { decrypt } from '../utils/encryption';

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
    body?: any
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

    try {
      const response = await axios({
        method,
        url: `${this.apiBaseUrl}${endpoint}`,
        headers,
        data: body,
      });

      if (response.data.code === '00000') {
        return response.data.data;
      } else {
        throw new Error(`Bitget API Error: ${response.data.msg}`);
      }
    } catch (error: any) {
      throw new Error(
        `Bitget API Request Failed: ${error.response?.data?.msg || error.message}`
      );
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

    const result = await this.makeRequest('POST', endpoint, credentials, orderPayload);
    
    return {
      orderId: result.orderId || result.clientOid,
      clientOid: result.clientOid || orderData.clientOid || '',
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
    marginCoin: string = 'USDT'
  ): Promise<any> {
    try {
      const holdSide = side === 'buy' ? 'long' : 'short';
      
      const endpoint = '/api/v2/mix/order/place-tpsl-order';
      const payload: any = {
        marginCoin,
        productType: productType.toLowerCase(),
        symbol,
        planType: 'pos_profit', // Profit plan (TP)
        triggerPrice: takeProfitPrice.toString(),
        triggerType: 'fill_price',
        executePrice: takeProfitPrice.toString(),
        holdSide,
        size: 'all', // Cerrar toda la posición en TP
      };

      console.log(`[Bitget] 🎯 Configurando Take Profit en ${takeProfitPrice} para ${symbol} ${holdSide}`);
      await this.makeRequest('POST', endpoint, credentials, payload);

      // Configurar Stop Loss
      const slPayload: any = {
        marginCoin,
        productType: productType.toLowerCase(),
        symbol,
        planType: 'pos_loss', // Loss plan (SL)
        triggerPrice: stopLossPrice.toString(),
        triggerType: 'fill_price',
        executePrice: stopLossPrice.toString(),
        holdSide,
        size: 'all', // Cerrar toda la posición en SL
      };

      console.log(`[Bitget] 🛑 Configurando Stop Loss en ${stopLossPrice} para ${symbol} ${holdSide}`);
      return await this.makeRequest('POST', endpoint, credentials, slPayload);
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
    marginCoin: string = 'USDT'
  ): Promise<any> {
    try {
      const holdSide = side === 'buy' ? 'long' : 'short';
      const endpoint = '/api/v2/mix/order/place-tpsl-order';
      
      const results: any[] = [];

      // 1. Configurar Stop Loss (cierra toda la posición)
      console.log(`[Bitget] 🛑 Configurando Stop Loss en ${stopLossPrice} para ${symbol} ${holdSide}`);
      const slPayload: any = {
        marginCoin: marginCoin.toUpperCase(),
        productType: productType.toLowerCase(),
        symbol: symbol.toUpperCase(),
        planType: 'pos_loss',
        triggerPrice: stopLossPrice.toString(),
        triggerType: 'fill_price',
        executePrice: stopLossPrice.toString(),
        holdSide,
        size: 'all', // Cerrar toda la posición en SL
        clientOid: `SL_${symbol}_${Date.now()}`,
      };
      
      const slResult = await this.makeRequest('POST', endpoint, credentials, slPayload);
      results.push({ type: 'stop_loss', result: slResult });
      console.log(`[Bitget] ✅ Stop Loss configurado exitosamente`);

      // 2. Si hay breakeven, configurar Take Profit parcial (50%) en breakeven
      if (breakevenPrice && breakevenPrice > 0) {
        const positionSizeNum = parseFloat(positionSize);
        const breakevenSize = (positionSizeNum * 0.5).toString(); // 50% de la posición
        
        console.log(`[Bitget] 🎯 Configurando Take Profit PARCIAL (50% = ${breakevenSize}) en breakeven ${breakevenPrice} para ${symbol} ${holdSide}`);
        const breakevenPayload: any = {
          marginCoin: marginCoin.toUpperCase(),
          productType: productType.toLowerCase(),
          symbol: symbol.toUpperCase(),
          planType: 'pos_profit',
          triggerPrice: breakevenPrice.toString(),
          triggerType: 'fill_price',
          executePrice: breakevenPrice.toString(),
          holdSide,
          size: breakevenSize, // Cerrar 50% de la posición en breakeven
          clientOid: `TP_BREAKEVEN_${symbol}_${Date.now()}`,
        };
        
        const breakevenResult = await this.makeRequest('POST', endpoint, credentials, breakevenPayload);
        results.push({ type: 'breakeven_tp_50', result: breakevenResult });
        console.log(`[Bitget] ✅ Take Profit parcial (50%) en breakeven configurado exitosamente`);
      }

      // 3. Configurar Take Profit final (50% restante o 100% si no hay breakeven) en takeProfit
      let finalTPSize: string;
      let finalTPDescription: string;
      
      if (breakevenPrice && breakevenPrice > 0) {
        // Si hay breakeven, cerrar el 50% restante en takeProfit
        const positionSizeNum = parseFloat(positionSize);
        finalTPSize = (positionSizeNum * 0.5).toString(); // 50% restante
        finalTPDescription = '50% restante';
      } else {
        // Si no hay breakeven, cerrar el 100% en takeProfit
        finalTPSize = 'all';
        finalTPDescription = '100%';
      }
      
      console.log(`[Bitget] 🎯 Configurando Take Profit FINAL (${finalTPDescription} = ${finalTPSize}) en ${takeProfitPrice} para ${symbol} ${holdSide}`);
      const tpPayload: any = {
        marginCoin: marginCoin.toUpperCase(),
        productType: productType.toLowerCase(),
        symbol: symbol.toUpperCase(),
        planType: 'pos_profit',
        triggerPrice: takeProfitPrice.toString(),
        triggerType: 'fill_price',
        executePrice: takeProfitPrice.toString(),
        holdSide,
        size: finalTPSize, // Cerrar el resto de la posición en TP final
        clientOid: `TP_FINAL_${symbol}_${Date.now()}`,
      };
      
      const tpResult = await this.makeRequest('POST', endpoint, credentials, tpPayload);
      results.push({ type: 'take_profit_final', result: tpResult });
      console.log(`[Bitget] ✅ Take Profit final (${finalTPDescription}) configurado exitosamente`);

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
    takeProfitPrice?: number
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

      return await this.makeRequest('POST', endpoint, credentials, payload);
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
    
    return await this.makeRequest('GET', endpoint, credentials);
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
    holdSide?: 'long' | 'short'
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
      const result = await this.makeRequest('POST', endpoint, credentials, payload);
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

