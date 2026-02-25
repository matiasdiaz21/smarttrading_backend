import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config';
import { decrypt } from '../utils/encryption';

export interface BybitCredentials {
  apiKey: string;
  apiSecret: string;
}

interface ContractInfoCache {
  [key: string]: {
    data: { minTradeNum: string; sizeMultiplier: string; minTradeUSDT: string; volumePlace: string; pricePlace: string };
    timestamp: number;
  };
}
const contractInfoCache: ContractInfoCache = {};
const CONTRACT_CACHE_TTL = 5 * 60 * 1000;

export class BybitService {
  private apiBaseUrl: string;

  constructor() {
    this.apiBaseUrl = (config.bybit?.apiBaseUrl || 'https://api.bybit.com').replace(/\/+$/, '');
  }


  private async makeRequest(
    method: 'GET' | 'POST',
    endpoint: string,
    credentials: BybitCredentials,
    params?: Record<string, string>,
    body?: any
  ): Promise<any> {
    const recvWindow = 5000;
    const timestamp = Date.now();
    const queryString = params && method === 'GET' ? new URLSearchParams(params).toString() : '';
    const bodyStr = body && method === 'POST' ? JSON.stringify(body) : '';
    const signPayload = method === 'GET' ? queryString : bodyStr;
    const signMessage = timestamp + credentials.apiKey + recvWindow + signPayload;
    const signature = crypto.createHmac('sha256', credentials.apiSecret).update(signMessage).digest('hex');

    const headers: Record<string, string> = {
      'X-BAPI-API-KEY': credentials.apiKey,
      'X-BAPI-TIMESTAMP': String(timestamp),
      'X-BAPI-SIGN': signature,
      'X-BAPI-RECV-WINDOW': String(recvWindow),
      'Content-Type': 'application/json',
    };

    const url = queryString ? `${this.apiBaseUrl}${endpoint}?${queryString}` : `${this.apiBaseUrl}${endpoint}`;
    const response = await axios({ method, url, headers, data: method === 'POST' ? body : undefined });

    const data = response.data;
    if (data.retCode !== 0) {
      throw new Error(`Bybit API: ${data.retMsg || data.retCode}`);
    }
    return data.result;
  }

  static getDecryptedCredentials(encrypted: { api_key: string; api_secret: string }): BybitCredentials {
    return {
      apiKey: decrypt(encrypted.api_key),
      apiSecret: decrypt(encrypted.api_secret),
    };
  }

  async getContractInfo(symbol: string, category: string = 'linear'): Promise<{
    minTradeNum: string;
    sizeMultiplier: string;
    minTradeUSDT: string;
    volumePlace: string;
    pricePlace: string;
  }> {
    const cacheKey = `${symbol}_${category}`;
    const cached = contractInfoCache[cacheKey];
    if (cached && Date.now() - cached.timestamp < CONTRACT_CACHE_TTL) {
      return cached.data;
    }

    const result = await axios.get(`${this.apiBaseUrl}/v5/market/instruments-info`, {
      params: { category, symbol: symbol.toUpperCase() },
    });
    const list = result.data?.result?.list;
    if (!list || list.length === 0) throw new Error('Bybit: no instrument info');

    const inst = list[0];
    const lot = inst.lotSizeFilter || {};
    const priceFilter = inst.priceFilter || {};
    const tickSize = priceFilter.tickSize || '0.01';
    const qtyStep = lot.qtyStep || '0.001';
    const minOrderQty = lot.minOrderQty || '0.001';
    const minNotional = lot.minNotionalValue || '5';
    const priceScale = inst.priceScale != null ? String(inst.priceScale) : '2';
    const volDecimals = qtyStep.includes('.') ? (qtyStep.split('.')[1] || '').length : 2;

    const data = {
      minTradeNum: minOrderQty,
      sizeMultiplier: qtyStep,
      minTradeUSDT: minNotional,
      volumePlace: String(volDecimals),
      pricePlace: priceScale,
    };
    contractInfoCache[cacheKey] = { data, timestamp: Date.now() };
    return data;
  }

  calculateOrderSize(
    requestedSize: string | number,
    minTradeNum: string,
    sizeMultiplier: string
  ): string {
    const requested = parseFloat(String(requestedSize));
    const minTrade = parseFloat(minTradeNum);
    const multiplier = parseFloat(sizeMultiplier);
    let size = Math.max(requested, minTrade);
    size = Math.ceil(size / multiplier) * multiplier;
    return size.toFixed(8).replace(/\.?0+$/, '');
  }

  async placeOrder(
    credentials: BybitCredentials,
    orderData: {
      symbol: string;
      side: 'buy' | 'sell';
      orderType: 'limit' | 'market';
      qty: string;
      price?: string;
      takeProfit?: string;
      stopLoss?: string;
      reduceOnly?: boolean;
      orderLinkId?: string;
    }
  ): Promise<{ orderId: string; orderLinkId: string }> {
    const category = 'linear';
    const side = orderData.side === 'buy' ? 'Buy' : 'Sell';
    const orderType = orderData.orderType === 'market' ? 'Market' : 'Limit';
    const payload: any = {
      category,
      symbol: orderData.symbol.toUpperCase(),
      side,
      orderType,
      qty: orderData.qty,
      positionIdx: 0,
    };
    if (orderData.price) payload.price = orderData.price;
    if (orderData.orderType === 'market') payload.timeInForce = 'IOC';
    else payload.timeInForce = 'GTC';
    if (orderData.takeProfit) payload.takeProfit = orderData.takeProfit;
    if (orderData.stopLoss) payload.stopLoss = orderData.stopLoss;
    if (orderData.reduceOnly) payload.reduceOnly = true;
    if (orderData.orderLinkId) payload.orderLinkId = orderData.orderLinkId;

    const result = await this.makeRequest('POST', '/v5/order/create', credentials, undefined, payload);
    return {
      orderId: result.orderId || '',
      orderLinkId: result.orderLinkId || orderData.orderLinkId || '',
    };
  }

  async openPositionWithFullTPSL(
    credentials: BybitCredentials,
    orderData: {
      symbol: string;
      size: string;
      price: string;
      side: 'buy' | 'sell';
      orderType: 'limit' | 'market';
      clientOid?: string;
    },
    tpslData: {
      stopLossPrice: number;
      takeProfitPrice: number;
      takeProfitPartialPrice?: number;
    },
    contractInfo?: { pricePlace?: string; volumePlace?: string; minTradeNum?: string; sizeMultiplier?: string },
    _logContext?: { userId: number; strategyId: number | null }
  ): Promise<{
    success: boolean;
    orderId?: string;
    orderResult?: any;
    tpslResults: Array<{ type: string; success: boolean; result?: any; error?: string }>;
    method: 'preset_only' | string;
    error?: string;
    payloads?: any;
  }> {
    const pricePlace = contractInfo?.pricePlace ? parseInt(contractInfo.pricePlace) : 4;
    const formattedSL = parseFloat(tpslData.stopLossPrice.toFixed(pricePlace)).toString();
    const formattedTP = parseFloat(tpslData.takeProfitPrice.toFixed(pricePlace)).toString();

    try {
      const result = await this.placeOrder(credentials, {
        symbol: orderData.symbol,
        side: orderData.side,
        orderType: orderData.orderType,
        qty: orderData.size,
        price: orderData.orderType === 'limit' ? orderData.price : undefined,
        takeProfit: formattedTP,
        stopLoss: formattedSL,
        orderLinkId: orderData.clientOid,
      });
      return {
        success: true,
        orderId: result.orderId,
        orderResult: result,
        tpslResults: [{ type: 'open_with_sl_tp', success: true, result }],
        method: 'preset_only',
        payloads: { takeProfit: formattedTP, stopLoss: formattedSL },
      };
    } catch (error: any) {
      return {
        success: false,
        tpslResults: [{ type: 'open_with_sl_tp', success: false, error: error.message }],
        method: 'preset_only',
        error: error.message,
      };
    }
  }

  async moveStopLossToBreakeven(
    credentials: BybitCredentials,
    symbol: string,
    side: 'buy' | 'sell',
    newStopLossPrice: number,
    _positionSize: string,
    _productType?: string,
    _marginCoin?: string,
    contractInfo?: { pricePlace?: string },
    _logContext?: { userId: number; strategyId: number | null; orderId?: string }
  ): Promise<{ success: boolean; steps: Array<{ type: string; success: boolean; result?: any; error?: string }> }> {
    const pricePlace = contractInfo?.pricePlace ? parseInt(contractInfo.pricePlace) : 4;
    const stopLoss = parseFloat(newStopLossPrice.toFixed(pricePlace)).toString();
    const steps: Array<{ type: string; success: boolean; result?: any; error?: string }> = [];

    try {
      await this.makeRequest('POST', '/v5/position/trading-stop', credentials, undefined, {
        category: 'linear',
        symbol: symbol.toUpperCase(),
        positionIdx: 0,
        stopLoss,
        tpslMode: 'Full',
      });
      steps.push({ type: 'set_trading_stop_be', success: true, result: { stopLoss } });
      return { success: true, steps };
    } catch (error: any) {
      steps.push({ type: 'set_trading_stop_be', success: false, error: error.message });
      return { success: false, steps };
    }
  }

  async getPositions(
    credentials: BybitCredentials,
    symbol?: string,
    category: string = 'linear'
  ): Promise<any[]> {
    const params: Record<string, string> = { category };
    if (symbol) params.symbol = symbol.toUpperCase();
    else params.settleCoin = 'USDT';
    const result = await this.makeRequest('GET', '/v5/position/list', credentials, params);
    const list = result?.list || [];
    return list.map((p: any) => ({
      symbol: p.symbol,
      holdSide: p.side === 'Buy' ? 'long' : 'short',
      total: p.size || '0',
      available: p.size || '0',
      averageOpenPrice: p.avgPrice || '',
      size: p.size,
      side: p.side,
      avgPrice: p.avgPrice,
    }));
  }

  async setLeverage(
    credentials: BybitCredentials,
    symbol: string,
    leverage: number,
    _category: string = 'linear'
  ): Promise<void> {
    await this.makeRequest('POST', '/v5/position/set-leverage', credentials, undefined, {
      category: 'linear',
      symbol: symbol.toUpperCase(),
      buyLeverage: String(leverage),
      sellLeverage: String(leverage),
    });
  }

  async cancelAllTriggerOrders(
    credentials: BybitCredentials,
    symbol: string,
    _category: string = 'linear',
    _marginCoin?: string
  ): Promise<{ cancelled: number }> {
    try {
      await this.makeRequest('POST', '/v5/order/cancel-all', credentials, undefined, {
        category: 'linear',
        symbol: symbol.toUpperCase(),
        orderFilter: 'StopOrder',
      });
      return { cancelled: 1 };
    } catch {
      return { cancelled: 0 };
    }
  }

  async validateConnection(credentials: BybitCredentials): Promise<{ valid: boolean; message: string }> {
    try {
      await this.makeRequest('GET', '/v5/position/list', credentials, { category: 'linear', settleCoin: 'USDT' });
      return { valid: true, message: 'Bybit connection successful' };
    } catch (error: any) {
      return { valid: false, message: error.message || 'Invalid API key or secret' };
    }
  }

  async closePositionAndCancelTriggers(
    credentials: BybitCredentials,
    positionData: { symbol: string; side: 'buy' | 'sell'; productType?: string; marginMode?: string },
    _logContext?: { userId: number; strategyId: number | null; orderId?: string }
  ): Promise<{ success: boolean; closedSize?: string; cancelledTriggers?: any; remainingTriggers?: number; error?: string }> {
    const symbol = positionData.symbol.toUpperCase();
    const holdSide = positionData.side === 'buy' ? 'long' : 'short';
    const closeSide = positionData.side === 'buy' ? 'sell' : 'buy';

    try {
      const positions = await this.getPositions(credentials, symbol, 'linear');
      const position = positions.find(
        (p: any) => p.holdSide === holdSide && parseFloat(p.total || '0') > 0
      );
      let closedSize = '0';

      if (position && parseFloat(position.total) > 0) {
        closedSize = position.total;
        await this.placeOrder(credentials, {
          symbol,
          side: closeSide,
          orderType: 'market',
          qty: closedSize,
          reduceOnly: true,
        });
      }

      try {
        await this.makeRequest('POST', '/v5/order/cancel-all', credentials, undefined, {
          category: 'linear',
          symbol,
          orderFilter: 'StopOrder',
        });
      } catch (_) {}

      return { success: true, closedSize, cancelledTriggers: {}, remainingTriggers: 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
