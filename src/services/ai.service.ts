import axios from 'axios';
import { AiConfigModel, AiConfigRow } from '../models/AiConfig';
import { AiAssetModel, AiAssetRow, AssetCategory } from '../models/AiAsset';
import { AiPredictionModel, AiPredictionRow } from '../models/AiPrediction';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const BITGET_API_URL = 'https://api.bitget.com';

// ===================== Technical Indicators =====================

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TechnicalIndicators {
  rsi: number;
  macd: { macd: number; signal: number; histogram: number };
}

function calculateEMA(prices: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);

  // First EMA is SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  ema[period - 1] = sum / period;

  for (let i = period; i < prices.length; i++) {
    ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1];
  }

  return ema;
}

function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  // Initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Smoothed RSI
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number; signal: number; histogram: number } {
  if (closes.length < slowPeriod + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  const emaFast = calculateEMA(closes, fastPeriod);
  const emaSlow = calculateEMA(closes, slowPeriod);

  // MACD line = EMA(fast) - EMA(slow)
  const macdLine: number[] = [];
  for (let i = slowPeriod - 1; i < closes.length; i++) {
    if (emaFast[i] !== undefined && emaSlow[i] !== undefined) {
      macdLine.push(emaFast[i] - emaSlow[i]);
    }
  }

  if (macdLine.length < signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  // Signal line = EMA(signalPeriod) of MACD line
  const signalLine = calculateEMA(macdLine, signalPeriod);

  const lastMacd = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];

  return {
    macd: Math.round(lastMacd * 100000) / 100000,
    signal: Math.round(lastSignal * 100000) / 100000,
    histogram: Math.round((lastMacd - lastSignal) * 100000) / 100000,
  };
}

/** ATR(14): Average True Range para volatilidad y tamaños de SL/TP */
function calculateATR(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) return 0;
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const atrValues: number[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  atrValues.push(sum / period);
  for (let i = period; i < tr.length; i++) {
    atrValues.push((atrValues[atrValues.length - 1] * (period - 1) + tr[i]) / period);
  }
  const last = atrValues[atrValues.length - 1];
  return Math.round(last * 100000) / 100000;
}

/** Bollinger Bands (20, 2): middle=SMA20, upper/lower, %B = (close - lower)/(upper - lower) */
function calculateBollingerBands(
  closes: number[],
  period: number = 20,
  stdDevMult: number = 2
): { middle: number; upper: number; lower: number; percentB: number } {
  if (closes.length < period) {
    const c = closes[closes.length - 1];
    return { middle: c, upper: c, lower: c, percentB: 0.5 };
  }
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, p) => s + (p - middle) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = middle + stdDevMult * std;
  const lower = middle - stdDevMult * std;
  const lastClose = closes[closes.length - 1];
  const bandWidth = upper - lower;
  const percentB = bandWidth === 0 ? 0.5 : (lastClose - lower) / bandWidth;
  return {
    middle: Math.round(middle * 100000) / 100000,
    upper: Math.round(upper * 100000) / 100000,
    lower: Math.round(lower * 100000) / 100000,
    percentB: Math.round(percentB * 1000) / 1000,
  };
}

function lastEmaValue(ema: number[], period: number): number {
  const idx = ema.length - 1;
  if (idx < period - 1 || ema[idx] == null) return 0;
  return Math.round(ema[idx] * 100000) / 100000;
}

/** Últimos valores de EMA(9), EMA(21), EMA(30), EMA(50), EMA(100) para tendencia y SMC */
function getEMASummary(closes: number[]): {
  ema9: number; ema21: number; ema30: number; ema50: number; ema100: number;
} {
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema30 = calculateEMA(closes, 30);
  const ema50 = calculateEMA(closes, 50);
  const ema100 = calculateEMA(closes, 100);
  return {
    ema9: lastEmaValue(ema9, 9),
    ema21: lastEmaValue(ema21, 21),
    ema30: lastEmaValue(ema30, 30),
    ema50: lastEmaValue(ema50, 50),
    ema100: lastEmaValue(ema100, 100),
  };
}

/** Descripción técnica: precio vs EMAs 9/21/50 (alcista/bajista/lateral) */
function describePriceStructure(
  close: number,
  ema9: number,
  ema21: number,
  ema50: number
): string {
  if (!ema21 || !ema50) return 'EMAs insuficientes';
  const above21 = close > ema21;
  const above50 = close > ema50;
  const ema21Above50 = ema21 > ema50;
  if (above21 && above50 && ema21Above50) return 'Alcista: precio > EMA21 > EMA50';
  if (!above21 && !above50 && !ema21Above50) return 'Bajista: precio < EMA21 < EMA50';
  if (above50 && !above21) return 'Corrección en tendencia alcista: precio entre EMA21 y EMA50';
  if (!above50 && above21) return 'Rebote en tendencia bajista: precio entre EMA50 y EMA21';
  return 'Lateral o cruces recientes; confirmar con RSI/MACD';
}

/** Estructura tipo Smart Money: EMAs 30/50/100 como filtro de tendencia y zonas de rechazo */
function describeSMCStructure(
  close: number,
  ema30: number,
  ema50: number,
  ema100: number
): string {
  if (!ema30 || !ema50 || !ema100) return 'EMAs 30/50/100 insuficientes';
  const above30 = close > ema30;
  const above50 = close > ema50;
  const above100 = close > ema100;
  const alignBull = ema30 > ema50 && ema50 > ema100;
  const alignBear = ema30 < ema50 && ema50 < ema100;
  const dist30 = Math.abs(close - ema30) / ema30;
  const dist50 = Math.abs(close - ema50) / ema50;
  const near30 = dist30 <= 0.005;
  const near50 = dist50 <= 0.005;
  if (above30 && above50 && above100 && alignBull) return 'Tendencia alcista SMC: precio > EMA30 > EMA50 > EMA100';
  if (!above30 && !above50 && !above100 && alignBear) return 'Tendencia bajista SMC: precio < EMA30 < EMA50 < EMA100';
  if (above100 && !above30 && alignBear) return 'Posible rechazo bajista en EMA30: precio bajo EMA30, estructura 4H bajista';
  if (!above100 && above30 && alignBull) return 'Posible rechazo alcista en EMA30: precio sobre EMA30, estructura 4H alcista';
  if (near30 && above50) return 'Precio en zona EMA30; rechazo alcista aquí apoyaría LONG';
  if (near30 && !above50) return 'Precio en zona EMA30; rechazo bajista aquí apoyaría SHORT';
  if (near50) return 'Precio en zona EMA50; posible zona de rechazo o cambio de tendencia';
  if (above50 && !alignBull) return 'Precio sobre EMA50 pero EMAs no alineadas; esperar confluencia';
  if (!above50 && !alignBear) return 'Precio bajo EMA50 pero EMAs no alineadas; esperar confluencia';
  return 'Estructura SMC no clara; confirmar con RSI/MACD y velas';
}

// ===================== Bitget Market Data =====================

async function fetchCandles(
  symbol: string,
  granularity: string,
  limit: number = 168,
  productType: string = 'USDT-FUTURES'
): Promise<Candle[]> {
  try {
    const response = await axios.get(`${BITGET_API_URL}/api/v2/mix/market/candles`, {
      params: {
        symbol: symbol.toUpperCase(),
        productType: productType.toUpperCase(),
        granularity,
        limit: String(limit),
      },
    });

    if (response.data.code === '00000' && Array.isArray(response.data.data)) {
      // Bitget returns: [timestamp, open, high, low, close, volume, quoteVolume]
      return response.data.data.map((c: any[]) => ({
        timestamp: parseInt(c[0]),
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5]),
      })).reverse(); // oldest first
    }
    throw new Error(`Bitget candles error: ${response.data.msg || 'Unknown'}`);
  } catch (error: any) {
    console.error(`[AI Service] Error fetching candles for ${symbol} ${granularity}:`, error.message);
    throw error;
  }
}

async function fetchCurrentPrice(symbol: string, productType: string = 'USDT-FUTURES'): Promise<number> {
  try {
    const response = await axios.get(`${BITGET_API_URL}/api/v2/mix/market/ticker`, {
      params: {
        symbol: symbol.toUpperCase(),
        productType: productType.toUpperCase(),
      },
    });

    if (response.data.code === '00000' && response.data.data && response.data.data.length > 0) {
      return parseFloat(response.data.data[0].lastPr || response.data.data[0].last);
    }
    throw new Error(`Bitget ticker error: ${response.data.msg || 'Unknown'}`);
  } catch (error: any) {
    console.error(`[AI Service] Error fetching price for ${symbol}:`, error.message);
    throw error;
  }
}

// ===================== Cross-Asset Context =====================

interface CrossAssetContext {
  btcPrice: number;
  btcChange24h: number;       // % change
  btcRsi: number;
  btcTrend: string;           // 'bullish' | 'bearish' | 'neutral'
  btcMacdHistogram: number;
  riskSentiment: string;      // 'risk-on' | 'risk-off' | 'neutral'
  usdStrengthProxy: string;   // derived from BTC inverse: BTC up = USD weak
}

/**
 * Fetch BTC data to derive cross-market context:
 * - BTC price & trend → risk sentiment (risk-on/risk-off)
 * - BTC inverse → rough USD strength proxy
 * Used for commodities (gold inversely correlated with USD) and forex.
 */
async function fetchCrossAssetContext(): Promise<CrossAssetContext | null> {
  try {
    const [btcCandles, btcPrice] = await Promise.all([
      fetchCandles('BTCUSDT', '4H', 42, 'USDT-FUTURES'),
      fetchCurrentPrice('BTCUSDT', 'USDT-FUTURES'),
    ]);

    const btcCloses = btcCandles.map(c => c.close);
    const btcRsi = calculateRSI(btcCloses);
    const btcMacd = calculateMACD(btcCloses);
    const btcEmas = getEMASummary(btcCloses);

    // 24h change from 4H candles (last 6 candles = 24h)
    const last6 = btcCandles.slice(-6);
    const btcChange24h = last6.length > 0
      ? ((btcPrice - last6[0].open) / last6[0].open) * 100
      : 0;

    // Trend from EMAs
    let btcTrend: string = 'neutral';
    if (btcPrice > btcEmas.ema21 && btcEmas.ema9 > btcEmas.ema21) btcTrend = 'bullish';
    else if (btcPrice < btcEmas.ema21 && btcEmas.ema9 < btcEmas.ema21) btcTrend = 'bearish';

    // Risk sentiment: BTC bullish + RSI healthy = risk-on; BTC bearish = risk-off
    let riskSentiment: string = 'neutral';
    if (btcTrend === 'bullish' && btcRsi > 45 && btcMacd.histogram > 0) riskSentiment = 'risk-on';
    else if (btcTrend === 'bearish' && btcRsi < 45 && btcMacd.histogram < 0) riskSentiment = 'risk-off';

    // USD proxy: BTC up strongly = weaker USD; BTC down = stronger USD (rough)
    let usdStrengthProxy: string = 'neutral';
    if (btcChange24h > 2 && btcTrend === 'bullish') usdStrengthProxy = 'débil (BTC alcista, flujos hacia riesgo)';
    else if (btcChange24h < -2 && btcTrend === 'bearish') usdStrengthProxy = 'fuerte (BTC bajista, flujos hacia refugio/USD)';
    else if (btcChange24h > 0.5) usdStrengthProxy = 'ligeramente débil';
    else if (btcChange24h < -0.5) usdStrengthProxy = 'ligeramente fuerte';

    console.log(`[AI Service] 🌐 Cross-asset: BTC=${btcPrice} (${btcChange24h.toFixed(2)}%), RSI=${btcRsi.toFixed(1)}, Trend=${btcTrend}, Risk=${riskSentiment}, USD=${usdStrengthProxy}`);

    return {
      btcPrice,
      btcChange24h: Math.round(btcChange24h * 100) / 100,
      btcRsi: Math.round(btcRsi * 100) / 100,
      btcTrend,
      btcMacdHistogram: btcMacd.histogram,
      riskSentiment,
      usdStrengthProxy,
    };
  } catch (error: any) {
    console.warn(`[AI Service] ⚠️ No se pudo obtener contexto cross-asset: ${error.message}`);
    return null;
  }
}

// ===================== Format data for prompt =====================

function formatCandlesForPrompt(candles: Candle[], maxRows: number = 30): string {
  const step = Math.max(1, Math.floor(candles.length / maxRows));
  const sampled = candles.filter((_, i) => i % step === 0 || i === candles.length - 1);

  const lines = sampled.map(c => {
    const date = new Date(c.timestamp).toISOString().slice(0, 16);
    return `${date} | O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${Math.round(c.volume)}`;
  });

  return lines.join('\n');
}

/** Shared technical data used by all prompt builders */
interface PromptData {
  symbol: string;
  currentPrice: number;
  candles1h: Candle[];
  candles4h: Candle[];
  rsi1h: number;
  rsi4h: number;
  macd1h: { macd: number; signal: number; histogram: number };
  macd4h: { macd: number; signal: number; histogram: number };
  atr1h: number;
  atr4h: number;
  bb1h: { middle: number; upper: number; lower: number; percentB: number };
  bb4h: { middle: number; upper: number; lower: number; percentB: number };
  ema1h: { ema9: number; ema21: number; ema30: number; ema50: number; ema100: number };
  ema4h: { ema9: number; ema21: number; ema30: number; ema50: number; ema100: number };
  structure1h: string;
  structure4h: string;
  smc_structure1h: string;
  smc_structure4h: string;
  crossAsset?: CrossAssetContext | null;
}

/** Shared helper: 24h stats from 1H candles */
function get24hStats(candles1h: Candle[], currentPrice: number) {
  const last1h = candles1h.slice(-24);
  const priceChange24h = last1h.length > 0
    ? ((currentPrice - last1h[0].open) / last1h[0].open * 100).toFixed(2)
    : '0';
  const high24h = last1h.length > 0 ? Math.max(...last1h.map(c => c.high)) : currentPrice;
  const low24h = last1h.length > 0 ? Math.min(...last1h.map(c => c.low)) : currentPrice;
  const avgVolume1h = last1h.length > 0
    ? Math.round(last1h.reduce((s, c) => s + c.volume, 0) / last1h.length)
    : 0;
  const lastVolume = last1h.length > 0 ? Math.round(last1h[last1h.length - 1].volume) : 0;
  const volRatio = avgVolume1h > 0 ? (lastVolume / avgVolume1h).toFixed(2) : '1.00';
  return { priceChange24h, high24h, low24h, avgVolume1h, lastVolume, volRatio };
}

/** Shared: technical indicators block (incl. EMAs 30/50/100 y estructura SMC) */
function formatTechnicalBlock(d: PromptData): string {
  return `## Indicadores Técnicos
- RSI(14) 1H: ${d.rsi1h.toFixed(2)} | 4H: ${d.rsi4h.toFixed(2)}
- MACD 1H: Line=${d.macd1h.macd}, Signal=${d.macd1h.signal}, Histogram=${d.macd1h.histogram}
- MACD 4H: Line=${d.macd4h.macd}, Signal=${d.macd4h.signal}, Histogram=${d.macd4h.histogram}
- ATR(14) 1H: ${d.atr1h} | 4H: ${d.atr4h}
- Bollinger(20,2) 1H: Mid=${d.bb1h.middle}, Upper=${d.bb1h.upper}, Lower=${d.bb1h.lower}, %B=${d.bb1h.percentB}
- Bollinger(20,2) 4H: Mid=${d.bb4h.middle}, Upper=${d.bb4h.upper}, Lower=${d.bb4h.lower}, %B=${d.bb4h.percentB}
- EMA 1H: 9=${d.ema1h.ema9}, 21=${d.ema1h.ema21}, 30=${d.ema1h.ema30}, 50=${d.ema1h.ema50}, 100=${d.ema1h.ema100}
- EMA 4H: 9=${d.ema4h.ema9}, 21=${d.ema4h.ema21}, 30=${d.ema4h.ema30}, 50=${d.ema4h.ema50}, 100=${d.ema4h.ema100}
- Estructura 1H: ${d.structure1h}
- Estructura 4H: ${d.structure4h}
- Estructura SMC 1H (EMAs 30/50/100): ${d.smc_structure1h}
- Estructura SMC 4H (EMAs 30/50/100): ${d.smc_structure4h}`;
}

/** JSON response format instruction (shared) */
const JSON_RESPONSE_FORMAT = `Responde ÚNICAMENTE con JSON válido:
{
  "side": "LONG" o "SHORT",
  "entry_price": número,
  "stop_loss": número,
  "take_profit": número,
  "confidence": número 0-100,
  "timeframe": "1h" o "4h",
  "reasoning": "explicación técnica breve incluyendo confluencia, indicadores clave y ATR para SL/TP"
}
Si no hay confluencia clara entre timeframes o indicadores, usa confidence < 30.`;

// ===================== CRYPTO Prompt Builder =====================

function buildCryptoPrompt(data: PromptData): string {
  const stats = get24hStats(data.candles1h, data.currentPrice);

  return `## Análisis técnico: ${data.symbol} (Criptomoneda)

## Estado actual
- Precio: ${data.currentPrice}
- Cambio 24h: ${stats.priceChange24h}%
- Rango 24h: ${stats.low24h} — ${stats.high24h}
- Volumen última 1H: ${stats.lastVolume} (${stats.volRatio}x promedio)

${formatTechnicalBlock(data)}

## Velas 1H (últimas 25):
${formatCandlesForPrompt(data.candles1h, 25)}

## Velas 4H (últimas 20):
${formatCandlesForPrompt(data.candles4h, 20)}

## Instrucciones de análisis (CRYPTO)
1. Confluencia obligatoria: RSI, MACD histograma, estructura de precio y estructura SMC (EMAs 30/50/100) en 1H y 4H.
2. Smart Money: usar EMAs 30/50/100 como filtro de tendencia (precio > EMA30 > EMA50 > EMA100 = alcista; lo contrario = bajista). Rechazos en EMA30 o EMA50 con vela de confirmación son zonas de entrada; priorizar BOS (continuación) en dirección de tendencia; CHoCH (reversión) solo con confirmación clara.
3. RSI >70 en ambos TF = sobrecompra (SHORT); RSI <30 = sobreventa (LONG).
4. MACD: histograma positivo creciente = momentum alcista; negativo decreciente = bajista.
5. Bollinger %B >1 = sobrecompra; %B <0 = sobreventa. Precio cerca de banda = posible reversión.
6. SL y TP basados en ATR: SL = 1-1.5×ATR del TF operado, TP = 2-3×ATR.
7. Si la estructura 4H o SMC 4H marca dirección, prioriza trades en esa dirección.

${JSON_RESPONSE_FORMAT}`;
}

// ===================== COMMODITY Prompt Builder =====================

function buildCommodityPrompt(data: PromptData): string {
  const stats = get24hStats(data.candles1h, data.currentPrice);
  const cross = data.crossAsset;

  // Determine specific commodity context
  const sym = data.symbol.toUpperCase();
  let commodityContext = '';
  if (sym.includes('XAU')) {
    commodityContext = `## Contexto específico: ORO (XAUUSDT)
- El oro es refugio de valor. Sube con incertidumbre, inflación alta y USD débil.
- Correlación inversa con USD: si USD se fortalece, oro tiende a bajar y viceversa.
- Sensible a: tipos de interés de la FED (tasas altas = oro baja), yields del Treasury, tensiones geopolíticas.
- En entornos risk-off (miedo) el oro sube; en risk-on (euforia) el oro baja o consolida.`;
  } else if (sym.includes('XAG')) {
    commodityContext = `## Contexto específico: PLATA (XAGUSDT)
- La plata combina demanda industrial con refugio de valor (más volátil que el oro).
- Correlación inversa con USD similar al oro pero con mayor beta (movimientos más amplios).
- Sensible a: demanda industrial, tipos de interés, y ratio oro/plata.`;
  } else if (sym.includes('WTI') || sym.includes('OIL') || sym.includes('BRENT')) {
    commodityContext = `## Contexto específico: PETRÓLEO
- Precio impulsado por oferta/demanda global, decisiones OPEC, geopolítica.
- USD fuerte tiende a presionar precios a la baja (denominado en USD).
- Sensible a: inventarios, producción OPEC, tensiones en Medio Oriente, crecimiento global.`;
  } else {
    commodityContext = `## Contexto: Commodity genérico
- Correlación inversa con USD frecuente. Sensible a oferta/demanda y geopolítica.`;
  }

  let crossAssetBlock = '';
  if (cross) {
    crossAssetBlock = `## Contexto inter-mercado (DATOS REALES)
- BTC precio: ${cross.btcPrice} | Cambio 24h: ${cross.btcChange24h}%
- BTC RSI(14) 4H: ${cross.btcRsi} | Tendencia: ${cross.btcTrend}
- BTC MACD Histogram 4H: ${cross.btcMacdHistogram}
- Sentimiento de riesgo: **${cross.riskSentiment}**
- Proxy fortaleza USD: **${cross.usdStrengthProxy}**

### Interpretación para commodity:
- Risk-off (BTC bajista, miedo) → oro/plata tienden a subir como refugio
- Risk-on (BTC alcista, euforia) → oro puede bajar o consolidar
- USD fuerte → presión bajista en commodities denominados en USD
- USD débil → presión alcista en commodities`;
  }

  return `## Análisis: ${data.symbol} (Commodity)

## Estado actual
- Precio: ${data.currentPrice}
- Cambio 24h: ${stats.priceChange24h}%
- Rango 24h: ${stats.low24h} — ${stats.high24h}
- Volumen última 1H: ${stats.lastVolume} (${stats.volRatio}x promedio)

${commodityContext}

${crossAssetBlock}

${formatTechnicalBlock(data)}

## Velas 1H (últimas 25):
${formatCandlesForPrompt(data.candles1h, 25)}

## Velas 4H (últimas 20):
${formatCandlesForPrompt(data.candles4h, 20)}

## Instrucciones de análisis (COMMODITY)
1. PRIMERO evalúa el contexto inter-mercado: ¿USD fuerte o débil? ¿Risk-on o risk-off? Esto define el sesgo direccional.
2. LUEGO verifica confluencia técnica: RSI, MACD y estructura deben alinearse en 1H y 4H EN LA MISMA DIRECCIÓN que el sesgo macro.
3. Si el técnico contradice el contexto macro (ej. técnico alcista pero USD fuerte), reduce confidence significativamente.
4. ATR para SL/TP: en commodities usar 1.5-2×ATR para SL, 2-3×ATR para TP (más holgado que crypto por volatilidad macro).
5. Bollinger %B: en commodities, %B extremos tienen mayor significancia cuando coinciden con cambio en sentimiento USD.
6. Si la estructura 4H muestra tendencia clara alineada con el contexto macro, alta confianza.
7. Si no hay datos inter-mercado o son neutrales, opera solo con confluencia técnica pero con confidence reducida (max 60).

${JSON_RESPONSE_FORMAT}`;
}

// ===================== FOREX Prompt Builder =====================

function buildForexPrompt(data: PromptData): string {
  const stats = get24hStats(data.candles1h, data.currentPrice);
  const cross = data.crossAsset;

  // Determine forex pair context
  const sym = data.symbol.toUpperCase();
  let pairContext = '';
  if (sym.includes('EUR')) {
    pairContext = 'Factores clave: diferencial tipos FED vs BCE, datos empleo/inflación EU vs US, PMI.';
  } else if (sym.includes('GBP')) {
    pairContext = 'Factores clave: diferencial tipos FED vs BoE, datos UK (CPI, empleo), Brexit effects.';
  } else if (sym.includes('JPY')) {
    pairContext = 'Factores clave: diferencial tipos (carry trade), intervención BoJ, risk sentiment (JPY = refugio).';
  } else if (sym.includes('AUD') || sym.includes('NZD')) {
    pairContext = 'Factores clave: precios commodities, datos China, diferencial tipos RBA/RBNZ vs FED.';
  } else {
    pairContext = 'Factores clave: fortaleza relativa de divisas, diferenciales de tipos de interés, datos macro.';
  }

  let crossAssetBlock = '';
  if (cross) {
    crossAssetBlock = `## Contexto inter-mercado (DATOS REALES)
- BTC precio: ${cross.btcPrice} | Cambio 24h: ${cross.btcChange24h}%
- BTC RSI(14) 4H: ${cross.btcRsi} | Tendencia: ${cross.btcTrend}
- Sentimiento de riesgo: **${cross.riskSentiment}**
- Proxy fortaleza USD: **${cross.usdStrengthProxy}**

### Interpretación para forex:
- Risk-on (BTC alcista) → monedas de riesgo (AUD, NZD) suben; refugios (JPY, CHF) bajan
- Risk-off (BTC bajista) → JPY y CHF suben; AUD y NZD bajan
- USD fuerte → pares XXXUSD bajan; pares USDXXX suben
- USD débil → pares XXXUSD suben; pares USDXXX bajan`;
  }

  return `## Análisis: ${data.symbol} (Forex)

## Estado actual
- Precio: ${data.currentPrice}
- Cambio 24h: ${stats.priceChange24h}%
- Rango 24h: ${stats.low24h} — ${stats.high24h}
- Volumen última 1H: ${stats.lastVolume} (${stats.volRatio}x promedio)

## Contexto del par
${pairContext}

${crossAssetBlock}

${formatTechnicalBlock(data)}

## Velas 1H (últimas 25):
${formatCandlesForPrompt(data.candles1h, 25)}

## Velas 4H (últimas 20):
${formatCandlesForPrompt(data.candles4h, 20)}

## Instrucciones de análisis (FOREX)
1. PRIMERO evalúa sentimiento de riesgo y dirección USD desde los datos inter-mercado.
2. En forex los movimientos impulados por noticias/datos macro INVALIDAN patrones técnicos rápidamente. Ten esto en cuenta.
3. Confluencia obligatoria: RSI, MACD y estructura en 1H y 4H deben coincidir.
4. ATR para SL/TP: forex tiende a ser menos volátil que crypto → SL = 1-1.5×ATR, TP = 2-2.5×ATR.
5. Si el contexto inter-mercado contradice el técnico, reduce confidence a <40.
6. Bollinger %B: en forex los retornos a la media son frecuentes; %B extremos son señales fuertes.
7. Si no hay datos inter-mercado, opera solo con confluencia técnica pero max confidence 55.

${JSON_RESPONSE_FORMAT}`;
}

// ===================== Unified prompt builder (routes by category) =====================

function buildAutoPrompt(data: PromptData, category: AssetCategory): string {
  switch (category) {
    case 'crypto':
      return buildCryptoPrompt(data);
    case 'commodities':
      return buildCommodityPrompt(data);
    case 'forex':
      return buildForexPrompt(data);
    default:
      return buildCryptoPrompt(data);
  }
}

// ===================== Groq API =====================

interface GroqResponse {
  side: 'LONG' | 'SHORT';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  confidence: number;
  timeframe: '1h' | '4h';
  reasoning: string;
}

async function callGroq(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<{ response: GroqResponse; tokensUsed: number; rawResponse: string }> {
  try {
    const result = await axios.post(
      GROQ_API_URL,
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const rawContent = result.data.choices?.[0]?.message?.content || '{}';
    const tokensUsed = result.data.usage?.total_tokens || 0;

    // Parse JSON response
    let parsed: GroqResponse;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      console.error('[AI Service] Failed to parse Groq JSON response:', rawContent);
      throw new Error('La IA devolvió una respuesta no válida en JSON');
    }

    // Validate required fields
    if (!parsed.side || !parsed.entry_price || !parsed.stop_loss || !parsed.take_profit) {
      throw new Error('La respuesta de la IA no contiene todos los campos requeridos');
    }

    // Normalize
    parsed.side = parsed.side.toUpperCase() as 'LONG' | 'SHORT';
    parsed.confidence = Math.max(0, Math.min(100, Math.round(parsed.confidence || 50)));
    parsed.timeframe = parsed.timeframe === '1h' ? '1h' : '4h';

    return { response: parsed, tokensUsed, rawResponse: rawContent };
  } catch (error: any) {
    if (error.response?.data) {
      console.error('[AI Service] Groq API error:', error.response.data);
      throw new Error(`Error de Groq: ${error.response.data.error?.message || JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

// ===================== Asset category fallback (used when DB category is missing) =====================

function guessAssetCategory(symbol: string): AssetCategory {
  const s = symbol.toUpperCase();
  // Commodities: oro, plata, petróleo
  if (/^XAU|^XAG|^WTI|^BRENT|^OIL|^COPPER|^NATURALGAS/i.test(s)) return 'commodities';
  // Forex: pares típicos (6 caracteres, dos códigos de moneda)
  const forexPairs = /^(EUR|GBP|USD|JPY|CHF|AUD|NZD|CAD)(USD|EUR|GBP|JPY|CHF|AUD|NZD|CAD)$/;
  if (s.length >= 6 && s.length <= 8 && forexPairs.test(s)) return 'forex';
  // Por defecto: crypto (BTCUSDT, ETHUSDT, etc.)
  return 'crypto';
}

function getCategoryInstructions(category: AssetCategory): string {
  switch (category) {
    case 'crypto':
      return 'Activo de criptomoneda. El precio suele seguir tendencias técnicas, sentimiento de mercado y flujos. Prioriza el análisis técnico (velas, RSI, MACD) y la estructura de precio.';
    case 'forex':
      return 'Par forex: el precio se mueve por fortaleza del dólar (USD), datos macroeconómicos (empleo, inflación, PIB), decisiones de bancos centrales (FED, BCE, BoJ) y noticias geopolíticas. Combina el análisis técnico con el contexto macro; si no hay datos macro recientes en el prompt, prioriza la estructura técnica pero ten en cuenta que los movimientos pueden ser más impulsados por noticias y datos que en crypto.';
    case 'commodities':
      return 'Commodity (ej. oro, plata, petróleo): el precio reacciona al dólar (USD), inflación, tipos de interés, oferta/demanda y noticias geopolíticas. Combina el análisis técnico con el contexto macro (fortaleza del USD, datos de la FED, tensión geopolítica). En commodities la correlación inversa con el dólar es frecuente.';
    default:
      return getCategoryInstructions('crypto');
  }
}

/**
 * System prompt específico por tipo de activo.
 * Cada categoría recibe instrucciones de rol y metodología acordes al mercado.
 */
function getSystemPromptForCategory(category: AssetCategory): string {
  const baseRules = `Requisitos generales:
1. Solo dar señal cuando haya confluencia entre timeframes (RSI, MACD, estructura y estructura SMC en 1H y 4H).
2. Smart Money: EMAs 30/50/100 como filtro de tendencia; rechazos en EMA30 o EMA50 como zonas de entrada con confirmación en velas.
3. Usar ATR para SL/TP (ej. SL 1-1.5*ATR, TP 2-3*ATR).
4. Considerar %B de Bollinger y posición del precio respecto a bandas.
5. Si la estructura 4H (clásica o SMC) es alcista/bajista, priorizar operaciones en la misma dirección.
6. Si no hay confluencia clara, devolver confidence < 30.
7. Responder ÚNICAMENTE en JSON válido.`;

  switch (category) {
    case 'crypto':
      return `Eres un analista técnico especializado en criptomonedas y futuros crypto. Tu análisis es estrictamente técnico y multi-timeframe (1H + 4H). Utilizas RSI, MACD, Bollinger Bands, EMAs (9/21/30/50/100), ATR, estructura de precio y conceptos Smart Money (SMC). En crypto prioriza: estructura SMC y EMAs 30/50/100 para tendencia y rechazos (rechazo en EMA30 o EMA50 = zona de entrada con confirmación); BOS = continuación en dirección de tendencia; CHoCH = reversión solo con confirmación. Luego indicadores (RSI, MACD) y volumen.

${baseRules}`;

    case 'forex':
      return `Eres un analista de trading especializado en mercados forex. Tu análisis combina técnico multi-timeframe (1H + 4H) con contexto macroeconómico. Utilizas RSI, MACD, Bollinger Bands, EMAs (9/21/50), ATR y estructura de precio. En forex los movimientos están impulsados por: fortaleza relativa de divisas (DXY/USD), decisiones de bancos centrales (FED, BCE, BoE, BoJ), datos macroeconómicos (NFP, CPI, PIB, empleo) y diferencial de tipos de interés. Prioriza: estructura técnica + dirección macro del par. Si los datos técnicos del prompt no muestran confluencia clara, reduce la confianza porque en forex los movimientos impulsados por noticias pueden invalidar patrones técnicos rápidamente.

${baseRules}`;

    case 'commodities':
      return `Eres un analista de trading especializado en commodities (oro, plata, petróleo, etc.). Tu análisis combina técnico multi-timeframe (1H + 4H) con factores fundamentales propios de materias primas. Utilizas RSI, MACD, Bollinger Bands, EMAs (9/21/50), ATR y estructura de precio. En commodities los drivers clave son: fortaleza del dólar (USD) — correlación inversa frecuente especialmente en oro —, política monetaria de la FED (tipos de interés, QE/QT), inflación y expectativas de inflación, tensiones geopolíticas (guerras, sanciones), y oferta/demanda global. Para oro específicamente: es refugio de valor, sube con incertidumbre y baja con dólar fuerte y yields altos. Prioriza: estructura técnica + contexto USD/macro. Si la estructura 4H muestra tendencia clara, operaciones en esa dirección tienen mayor probabilidad.

${baseRules}`;

    default:
      return getSystemPromptForCategory('crypto');
  }
}

// ===================== Main Analysis Function =====================

export async function analyzeAsset(
  config: AiConfigRow,
  asset: AiAssetRow
): Promise<{ predictionId: number; prediction: GroqResponse } | null> {
  const symbol = asset.symbol;
  console.log(`[AI Service] 🧠 Analizando ${symbol}...`);

  if (!config.groq_api_key) {
    throw new Error('Groq API key no configurada');
  }

  // 0. Check if there's already an active prediction for this symbol
  const hasActive = await AiPredictionModel.hasActiveBySymbol(symbol);
  if (hasActive) {
    console.log(`[AI Service] ⏭️ ${symbol} ya tiene una predicción activa. Omitiendo.`);
    return null;
  }

  // 1. Detect asset category from DB (fallback to guess from symbol name)
  const assetCategory: AssetCategory = asset.category || guessAssetCategory(symbol);
  console.log(`[AI Service] 📊 [${assetCategory.toUpperCase()}] Obteniendo datos para ${symbol}...`);

  // 2. Fetch market data from Bitget (public endpoints, no auth)
  // For commodities/forex: also fetch cross-asset context (BTC for risk/USD proxy)
  const needsCrossAsset = assetCategory !== 'crypto';
  const [candles1h, candles4h, currentPrice, crossAsset] = await Promise.all([
    fetchCandles(symbol, '1H', 168, asset.product_type),
    fetchCandles(symbol, '4H', 42, asset.product_type),
    fetchCurrentPrice(symbol, asset.product_type),
    needsCrossAsset ? fetchCrossAssetContext() : Promise.resolve(null),
  ]);

  console.log(`[AI Service] 📊 Velas obtenidas: 1H=${candles1h.length}, 4H=${candles4h.length}, Precio=${currentPrice}${crossAsset ? ', Cross-asset: ✅' : ''}`);

  // 3. Calculate technical indicators
  const closes1h = candles1h.map(c => c.close);
  const closes4h = candles4h.map(c => c.close);

  const rsi1h = calculateRSI(closes1h);
  const rsi4h = calculateRSI(closes4h);
  const macd1h = calculateMACD(closes1h);
  const macd4h = calculateMACD(closes4h);
  const atr1h = calculateATR(candles1h, 14);
  const atr4h = calculateATR(candles4h, 14);
  const bb1h = calculateBollingerBands(closes1h, 20, 2);
  const bb4h = calculateBollingerBands(closes4h, 20, 2);
  const ema1h = getEMASummary(closes1h);
  const ema4h = getEMASummary(closes4h);
  const structure1h = describePriceStructure(currentPrice, ema1h.ema9, ema1h.ema21, ema1h.ema50);
  const structure4h = describePriceStructure(currentPrice, ema4h.ema9, ema4h.ema21, ema4h.ema50);
  const smc_structure1h = describeSMCStructure(currentPrice, ema1h.ema30, ema1h.ema50, ema1h.ema100);
  const smc_structure4h = describeSMCStructure(currentPrice, ema4h.ema30, ema4h.ema50, ema4h.ema100);

  console.log(`[AI Service] 📈 Indicadores: RSI_1H=${rsi1h.toFixed(2)}, RSI_4H=${rsi4h.toFixed(2)}, MACD_1H=${macd1h.macd}, MACD_4H=${macd4h.macd}, ATR_1H=${atr1h}, ATR_4H=${atr4h}`);

  // 4. Build prompt — category-specific builder with cross-asset data
  const promptData: PromptData = {
    symbol, currentPrice, candles1h, candles4h, rsi1h, rsi4h, macd1h, macd4h,
    atr1h, atr4h, bb1h, bb4h, ema1h, ema4h, structure1h, structure4h, smc_structure1h, smc_structure4h, crossAsset,
  };

  // Template por categoría (crypto, forex, commodities) o global
  const analysisTemplateByCategory =
    assetCategory === 'crypto' ? config.analysis_prompt_template_crypto
    : assetCategory === 'forex' ? config.analysis_prompt_template_forex
    : config.analysis_prompt_template_commodities;
  const analysisTemplate = (analysisTemplateByCategory && String(analysisTemplateByCategory).trim().length > 0)
    ? String(analysisTemplateByCategory).trim()
    : (config.analysis_prompt_template && config.analysis_prompt_template.trim().length > 0)
      ? config.analysis_prompt_template
      : null;

  let userPrompt: string;
  if (analysisTemplate) {
    // Admin provided a custom template (por categoría o global) con placeholders
    const categoryInstructions = getCategoryInstructions(assetCategory);
    userPrompt = analysisTemplate
      .replace(/\{\{symbol\}\}/g, symbol)
      .replace(/\{\{candles_1h\}\}/g, formatCandlesForPrompt(candles1h, 25))
      .replace(/\{\{candles_4h\}\}/g, formatCandlesForPrompt(candles4h, 20))
      .replace(/\{\{rsi_1h\}\}/g, rsi1h.toFixed(2))
      .replace(/\{\{rsi_4h\}\}/g, rsi4h.toFixed(2))
      .replace(/\{\{macd_1h\}\}/g, `MACD: ${macd1h.macd}, Signal: ${macd1h.signal}, Histogram: ${macd1h.histogram}`)
      .replace(/\{\{macd_4h\}\}/g, `MACD: ${macd4h.macd}, Signal: ${macd4h.signal}, Histogram: ${macd4h.histogram}`)
      .replace(/\{\{atr_1h\}\}/g, atr1h.toString())
      .replace(/\{\{atr_4h\}\}/g, atr4h.toString())
      .replace(/\{\{bb_1h\}\}/g, `Middle: ${bb1h.middle}, Upper: ${bb1h.upper}, Lower: ${bb1h.lower}, %B: ${bb1h.percentB}`)
      .replace(/\{\{bb_4h\}\}/g, `Middle: ${bb4h.middle}, Upper: ${bb4h.upper}, Lower: ${bb4h.lower}, %B: ${bb4h.percentB}`)
      .replace(/\{\{ema_1h\}\}/g, `EMA9: ${ema1h.ema9}, EMA21: ${ema1h.ema21}, EMA30: ${ema1h.ema30}, EMA50: ${ema1h.ema50}, EMA100: ${ema1h.ema100}`)
      .replace(/\{\{ema_4h\}\}/g, `EMA9: ${ema4h.ema9}, EMA21: ${ema4h.ema21}, EMA30: ${ema4h.ema30}, EMA50: ${ema4h.ema50}, EMA100: ${ema4h.ema100}`)
      .replace(/\{\{structure_1h\}\}/g, structure1h)
      .replace(/\{\{structure_4h\}\}/g, structure4h)
      .replace(/\{\{smc_structure_1h\}\}/g, smc_structure1h)
      .replace(/\{\{smc_structure_4h\}\}/g, smc_structure4h)
      .replace(/\{\{current_price\}\}/g, currentPrice.toString())
      .replace(/\{\{asset_category\}\}/g, assetCategory)
      .replace(/\{\{category_instructions\}\}/g, categoryInstructions);
    if (!analysisTemplate.includes('{{category_instructions}}')) {
      userPrompt = `## Contexto del activo (${assetCategory}):\n${categoryInstructions}\n\n` + userPrompt;
    }
  } else {
    // Fully automatic: category-specific prompt builder with cross-asset data
    userPrompt = buildAutoPrompt(promptData, assetCategory);
  }

  // 5. Call Groq — system prompt por categoría, luego global, luego automático
  const systemPromptByCategory =
    assetCategory === 'crypto' ? config.system_prompt_crypto
    : assetCategory === 'forex' ? config.system_prompt_forex
    : config.system_prompt_commodities;
  const systemPromptCustom = (systemPromptByCategory != null && String(systemPromptByCategory).trim().length > 0)
    ? String(systemPromptByCategory).trim()
    : (config.system_prompt && config.system_prompt.trim().length > 0)
      ? config.system_prompt
      : null;
  const systemPrompt = systemPromptCustom || getSystemPromptForCategory(assetCategory);

  console.log(`[AI Service] 🤖 Consultando Groq (${config.groq_model}) — categoría: ${assetCategory}...`);
  const { response, tokensUsed, rawResponse } = await callGroq(
    config.groq_api_key,
    config.groq_model,
    systemPrompt,
    userPrompt
  );

  console.log(`[AI Service] ✅ Predicción: ${response.side} ${symbol} @ ${response.entry_price} | SL: ${response.stop_loss} | TP: ${response.take_profit} | Confidence: ${response.confidence}%`);

  // 5. Save prediction to DB
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + config.default_expiry_hours);

  const predictionId = await AiPredictionModel.create({
    asset_id: asset.id,
    symbol,
    side: response.side,
    timeframe: response.timeframe,
    entry_price: response.entry_price,
    stop_loss: response.stop_loss,
    take_profit: response.take_profit,
    confidence: response.confidence,
    reasoning: response.reasoning || null,
    price_at_prediction: currentPrice,
    expires_at: expiresAt,
    groq_model: config.groq_model,
    groq_tokens_used: tokensUsed,
    raw_ai_response: rawResponse,
    system_prompt_used: systemPrompt,
    user_prompt_used: userPrompt,
  });

  console.log(`[AI Service] 💾 Predicción guardada con ID ${predictionId}`);

  return { predictionId, prediction: response };
}

// ===================== Run Full Analysis =====================

export async function runFullAnalysis(): Promise<{
  analyzed: number;
  predictions: Array<{ symbol: string; side: string; confidence: number; id: number }>;
  errors: Array<{ symbol: string; error: string }>;
}> {
  const config = await AiConfigModel.get();

  if (!config.is_enabled) {
    throw new Error('El sistema de IA está deshabilitado');
  }
  if (!config.groq_api_key) {
    throw new Error('Groq API key no configurada');
  }

  const assets = await AiAssetModel.findAll(true); // only enabled
  if (assets.length === 0) {
    throw new Error('No hay activos habilitados para análisis');
  }

  // Limit to max_predictions_per_run
  const assetsToAnalyze = assets.slice(0, config.max_predictions_per_run);

  console.log(`[AI Service] 🚀 Iniciando análisis de ${assetsToAnalyze.length} activos...`);

  const predictions: Array<{ symbol: string; side: string; confidence: number; id: number }> = [];
  const errors: Array<{ symbol: string; error: string }> = [];

  // Expire old predictions first
  const expired = await AiPredictionModel.expireOld();
  if (expired > 0) {
    console.log(`[AI Service] ⏰ ${expired} predicciones expiradas automáticamente`);
  }

  // Analyze each asset sequentially (to avoid Groq rate limits)
  for (const asset of assetsToAnalyze) {
    try {
      const result = await analyzeAsset(config, asset);
      if (result) {
        predictions.push({
          symbol: asset.symbol,
          side: result.prediction.side,
          confidence: result.prediction.confidence,
          id: result.predictionId,
        });
      }
    } catch (error: any) {
      console.error(`[AI Service] ❌ Error analizando ${asset.symbol}: ${error.message}`);
      errors.push({ symbol: asset.symbol, error: error.message });
    }

    // Small delay between assets to respect rate limits
    if (assetsToAnalyze.indexOf(asset) < assetsToAnalyze.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Update last auto run timestamp
  await AiConfigModel.updateLastAutoRun();

  console.log(`[AI Service] ✅ Análisis completo: ${predictions.length} predicciones, ${errors.length} errores`);

  return { analyzed: assetsToAnalyze.length, predictions, errors };
}

// ===================== Check Prediction Results =====================

/**
 * Fetch 5-minute candles from a start timestamp to now.
 * Bitget limits to 200 candles per request (~16.6 hours at 5min).
 * Paginates automatically if the prediction is older.
 */
async function fetchCandlesSince(
  symbol: string,
  startTimeMs: number,
  productType: string = 'USDT-FUTURES'
): Promise<Candle[]> {
  const allCandles: Candle[] = [];
  const granularity = '5m'; // Bitget exige "5m", no "5min"
  const maxPerRequest = 200;
  const candleIntervalMs = 5 * 60 * 1000; // 5 minutes
  // Bitget: "time unit must be rounded down" — redondear al inicio de vela 5m
  let currentStart = Math.floor(startTimeMs / candleIntervalMs) * candleIntervalMs;
  const now = Date.now();

  while (currentStart < now) {
    try {
      const response = await axios.get(`${BITGET_API_URL}/api/v2/mix/market/candles`, {
        params: {
          symbol: symbol.toUpperCase(),
          productType: productType.toUpperCase(),
          granularity,
          startTime: String(currentStart),
          endTime: String(now),
          limit: String(maxPerRequest),
        },
      });

      if (response.data.code === '00000' && Array.isArray(response.data.data) && response.data.data.length > 0) {
        const candles: Candle[] = response.data.data.map((c: any[]) => ({
          timestamp: parseInt(String(c[0])),
          open: parseFloat(String(c[1])),
          high: parseFloat(String(c[2])),
          low: parseFloat(String(c[3])),
          close: parseFloat(String(c[4])),
          volume: parseFloat(String(c[5])),
        }));

        // Bitget returns newest first, reverse to oldest first
        candles.reverse();
        allCandles.push(...candles);

        if (candles.length < maxPerRequest) {
          break; // No more data
        }

        const lastTs = candles[candles.length - 1].timestamp;
        currentStart = lastTs + candleIntervalMs;
      } else {
        const msg = response.data?.msg || 'sin datos';
        if (allCandles.length === 0 && response.data?.code !== '00000') {
          console.warn(`[AI Service] Bitget candles ${symbol}: code=${response.data?.code} msg=${msg}`);
        }
        break;
      }
    } catch (error: any) {
      console.error(`[AI Service] Error fetching 5m candles for ${symbol} from ${currentStart}: ${error.message}`);
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return allCandles;
}

/**
 * Walk through candles chronologically and determine if SL or TP was hit.
 * Returns the first hit found. If both are hit in the same candle, SL wins (conservative).
 */
function resolveWithCandles(
  candles: Candle[],
  prediction: AiPredictionRow
): { status: 'won' | 'lost'; resultPrice: number; pnlPercent: number; hitTimestamp: number } | null {
  const { side, entry_price, stop_loss, take_profit } = prediction;

  for (const candle of candles) {
    let hitSL = false;
    let hitTP = false;

    if (side === 'LONG') {
      // LONG: SL hit if low <= stop_loss, TP hit if high >= take_profit
      hitSL = candle.low <= stop_loss;
      hitTP = candle.high >= take_profit;
    } else {
      // SHORT: SL hit if high >= stop_loss, TP hit if low <= take_profit
      hitSL = candle.high >= stop_loss;
      hitTP = candle.low <= take_profit;
    }

    // If both hit in same candle, SL takes priority (worst case / conservative)
    if (hitSL && hitTP) {
      const pnl = side === 'LONG'
        ? ((stop_loss - entry_price) / entry_price) * 100
        : ((entry_price - stop_loss) / entry_price) * 100;
      return { status: 'lost', resultPrice: stop_loss, pnlPercent: Math.round(pnl * 100) / 100, hitTimestamp: candle.timestamp };
    }

    if (hitSL) {
      const pnl = side === 'LONG'
        ? ((stop_loss - entry_price) / entry_price) * 100
        : ((entry_price - stop_loss) / entry_price) * 100;
      return { status: 'lost', resultPrice: stop_loss, pnlPercent: Math.round(pnl * 100) / 100, hitTimestamp: candle.timestamp };
    }

    if (hitTP) {
      const pnl = side === 'LONG'
        ? ((take_profit - entry_price) / entry_price) * 100
        : ((entry_price - take_profit) / entry_price) * 100;
      return { status: 'won', resultPrice: take_profit, pnlPercent: Math.round(pnl * 100) / 100, hitTimestamp: candle.timestamp };
    }
  }

  return null; // Neither SL nor TP hit yet
}

export async function checkPredictionResults(): Promise<{
  checked: number;
  resolved: number;
  results: Array<{ id: number; symbol: string; status: string; pnl: number }>;
}> {
  // Expire old ones first
  await AiPredictionModel.expireOld();

  const activePredictions = await AiPredictionModel.findActive();

  if (activePredictions.length === 0) {
    return { checked: 0, resolved: 0, results: [] };
  }

  console.log(`[AI Service] 🔍 Verificando ${activePredictions.length} predicciones activas con velas históricas...`);

  const results: Array<{ id: number; symbol: string; status: string; pnl: number }> = [];
  let resolved = 0;

  for (const prediction of activePredictions) {
    try {
      // Check if expired first
      if (new Date(prediction.expires_at) < new Date()) {
        let currentPrice: number | undefined;
        try { currentPrice = await fetchCurrentPrice(prediction.symbol); } catch {}
        await AiPredictionModel.updateStatus(prediction.id, 'expired', 'auto', currentPrice);
        resolved++;
        results.push({ id: prediction.id, symbol: prediction.symbol, status: 'expired', pnl: 0 });
        console.log(`[AI Service] ⏰ Predicción #${prediction.id} ${prediction.symbol}: expirada`);
        continue;
      }

      // Fetch 5min candles from prediction creation time to now
      const startMs = new Date(prediction.created_at).getTime();
      console.log(`[AI Service] 📊 #${prediction.id} ${prediction.symbol} ${prediction.side}: obteniendo velas 5min desde ${new Date(startMs).toISOString()}...`);

      const candles = await fetchCandlesSince(prediction.symbol, startMs);

      if (candles.length === 0) {
        console.warn(`[AI Service] ⚠️ #${prediction.id} ${prediction.symbol}: sin velas disponibles, omitiendo`);
        continue;
      }

      console.log(`[AI Service] 📊 #${prediction.id}: ${candles.length} velas de 5min obtenidas (${new Date(candles[0].timestamp).toISOString()} → ${new Date(candles[candles.length - 1].timestamp).toISOString()})`);

      // Walk candles to find first SL or TP hit
      const result = resolveWithCandles(candles, prediction);

      if (result) {
        await AiPredictionModel.updateStatus(prediction.id, result.status, 'auto', result.resultPrice, result.pnlPercent);
        resolved++;
        results.push({ id: prediction.id, symbol: prediction.symbol, status: result.status, pnl: result.pnlPercent });
        const hitTime = new Date(result.hitTimestamp).toISOString();
        console.log(`[AI Service] ${result.status === 'won' ? '✅' : '❌'} Predicción #${prediction.id} ${prediction.symbol}: ${result.status} a ${result.resultPrice} (${result.pnlPercent}%) — tocó ${result.status === 'won' ? 'TP' : 'SL'} en vela ${hitTime}`);
      } else {
        console.log(`[AI Service] ⏳ Predicción #${prediction.id} ${prediction.symbol}: SL/TP no tocados aún (SL=${prediction.stop_loss}, TP=${prediction.take_profit})`);
      }
    } catch (error: any) {
      console.error(`[AI Service] ❌ Error verificando predicción #${prediction.id} ${prediction.symbol}: ${error.message}`);
    }

    // Small delay between predictions to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log(`[AI Service] 🔍 Verificación completa: ${resolved} resueltas de ${activePredictions.length} activas`);

  return { checked: activePredictions.length, resolved, results };
}
