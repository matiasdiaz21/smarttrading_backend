import axios from 'axios';
import { AiConfigModel, AiConfigRow } from '../models/AiConfig';
import { AiAssetModel, AiAssetRow } from '../models/AiAsset';
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

/** Últimos valores de EMA(9), EMA(21), EMA(50) para alineación de tendencia */
function getEMASummary(closes: number[]): { ema9: number; ema21: number; ema50: number } {
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  return {
    ema9: lastEmaValue(ema9, 9),
    ema21: lastEmaValue(ema21, 21),
    ema50: lastEmaValue(ema50, 50),
  };
}

/** Descripción técnica: precio vs EMAs y estructura (alcista/bajista/lateral) */
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

function buildAutoPrompt(data: {
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
  ema1h: { ema9: number; ema21: number; ema50: number };
  ema4h: { ema9: number; ema21: number; ema50: number };
  structure1h: string;
  structure4h: string;
}): string {
  const { symbol, currentPrice, candles1h, candles4h, rsi1h, rsi4h, macd1h, macd4h, atr1h, atr4h, bb1h, bb4h, ema1h, ema4h, structure1h, structure4h } = data;

  // Price change calculations
  const last1h = candles1h.slice(-24);
  const last4h = candles4h.slice(-6);
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

  return `Analyze ${symbol} for a futures trading opportunity.

CURRENT STATE:
- Symbol: ${symbol}
- Current Price: ${currentPrice}
- 24h Change: ${priceChange24h}%
- 24h High: ${high24h}
- 24h Low: ${low24h}
- Last 1H Volume: ${lastVolume} (${volRatio}x average)

TECHNICAL INDICATORS:
- RSI (14) 1H: ${rsi1h.toFixed(2)} | 4H: ${rsi4h.toFixed(2)}
- MACD 1H: Line=${macd1h.macd}, Signal=${macd1h.signal}, Histogram=${macd1h.histogram}
- MACD 4H: Line=${macd4h.macd}, Signal=${macd4h.signal}, Histogram=${macd4h.histogram}
- ATR (14) 1H: ${atr1h} | 4H: ${atr4h} (usar para SL/TP en múltiplos de ATR)
- Bollinger (20,2) 1H: Middle=${bb1h.middle}, Upper=${bb1h.upper}, Lower=${bb1h.lower}, %B=${bb1h.percentB}
- Bollinger (20,2) 4H: Middle=${bb4h.middle}, Upper=${bb4h.upper}, Lower=${bb4h.lower}, %B=${bb4h.percentB}
- EMA 1H: EMA9=${ema1h.ema9}, EMA21=${ema1h.ema21}, EMA50=${ema1h.ema50}
- EMA 4H: EMA9=${ema4h.ema9}, EMA21=${ema4h.ema21}, EMA50=${ema4h.ema50}
- Estructura 1H: ${structure1h}
- Estructura 4H: ${structure4h}

RECENT 1H CANDLES (last 25):
${formatCandlesForPrompt(candles1h, 25)}

RECENT 4H CANDLES (last 20):
${formatCandlesForPrompt(candles4h, 20)}

Based on all the data above, provide your trading recommendation. You MUST respond ONLY with a valid JSON object in this exact format:
{
  "side": "LONG" or "SHORT",
  "entry_price": <number - recommended entry price>,
  "stop_loss": <number - stop loss price>,
  "take_profit": <number - take profit price>,
  "confidence": <number 0-100 - your confidence level>,
  "timeframe": "1h" or "4h",
  "reasoning": "<string - brief explanation of your analysis>"
}`;
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

// ===================== Asset category (crypto / forex / commodities) =====================

export type AssetCategory = 'crypto' | 'forex' | 'commodities';

export function getAssetCategory(symbol: string): AssetCategory {
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
1. Solo dar señal cuando haya confluencia entre timeframes (RSI, MACD y estructura alineados en 1H y 4H).
2. Usar ATR para justificar distancia de stop loss y take profit (ej. SL a 1-2 ATR, TP a 2-3 ATR).
3. Considerar %B de Bollinger y posición del precio respecto a bandas.
4. Si la estructura 4H es alcista/bajista, priorizar operaciones en la misma dirección.
5. Si no hay confluencia clara, devolver confidence < 30.
6. Responder ÚNICAMENTE en JSON válido.`;

  switch (category) {
    case 'crypto':
      return `Eres un analista técnico especializado en criptomonedas y futuros crypto. Tu análisis es estrictamente técnico y multi-timeframe (1H + 4H). Utilizas RSI, MACD, Bollinger Bands, EMAs (9/21/50), ATR y estructura de precio. En crypto el precio sigue principalmente patrones técnicos, momentum, sentimiento de mercado y flujos de capital. No necesitas considerar factores macro salvo eventos extremos (regulación, hacks). Prioriza: estructura técnica > indicadores de momentum > volumen.

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

  // 1. Fetch market data from Bitget (public endpoints, no auth)
  console.log(`[AI Service] 📊 Obteniendo velas 1H y 4H para ${symbol}...`);
  const [candles1h, candles4h, currentPrice] = await Promise.all([
    fetchCandles(symbol, '1H', 168, asset.product_type), // 1 week of 1h candles
    fetchCandles(symbol, '4H', 42, asset.product_type),  // 1 week of 4h candles
    fetchCurrentPrice(symbol, asset.product_type),
  ]);

  console.log(`[AI Service] 📊 Velas obtenidas: 1H=${candles1h.length}, 4H=${candles4h.length}, Precio=${currentPrice}`);

  // 2. Calculate technical indicators
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

  console.log(`[AI Service] 📈 Indicadores: RSI_1H=${rsi1h.toFixed(2)}, RSI_4H=${rsi4h.toFixed(2)}, MACD_1H=${macd1h.macd}, MACD_4H=${macd4h.macd}, ATR_1H=${atr1h}, ATR_4H=${atr4h}`);

  // 3. Build prompt - automatic or from custom template
  const assetCategory = getAssetCategory(symbol);
  const categoryInstructions = getCategoryInstructions(assetCategory);

  let userPrompt: string;
  if (config.analysis_prompt_template && config.analysis_prompt_template.trim().length > 0) {
    // Admin provided a custom template with placeholders
    userPrompt = config.analysis_prompt_template
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
      .replace(/\{\{ema_1h\}\}/g, `EMA9: ${ema1h.ema9}, EMA21: ${ema1h.ema21}, EMA50: ${ema1h.ema50}`)
      .replace(/\{\{ema_4h\}\}/g, `EMA9: ${ema4h.ema9}, EMA21: ${ema4h.ema21}, EMA50: ${ema4h.ema50}`)
      .replace(/\{\{structure_1h\}\}/g, structure1h)
      .replace(/\{\{structure_4h\}\}/g, structure4h)
      .replace(/\{\{current_price\}\}/g, currentPrice.toString())
      .replace(/\{\{asset_category\}\}/g, assetCategory)
      .replace(/\{\{category_instructions\}\}/g, categoryInstructions);
    // Si el template no incluyó el bloque de contexto por categoría, lo anteponemos
    if (!config.analysis_prompt_template.includes('{{category_instructions}}')) {
      userPrompt = `## Contexto del activo (${assetCategory}):\n${categoryInstructions}\n\n` + userPrompt;
    }
  } else {
    // Fully automatic prompt - no template needed
    userPrompt = buildAutoPrompt({
      symbol, currentPrice, candles1h, candles4h, rsi1h, rsi4h, macd1h, macd4h,
      atr1h, atr4h, bb1h, bb4h, ema1h, ema4h, structure1h, structure4h,
    });
    userPrompt = `## Contexto del activo (${assetCategory}):\n${categoryInstructions}\n\n` + userPrompt;
  }

  // 4. Call Groq — system prompt adapts to asset category
  const systemPrompt = config.system_prompt && config.system_prompt.trim().length > 0
    ? config.system_prompt
    : getSystemPromptForCategory(assetCategory);

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
  const granularity = '5min';
  const maxPerRequest = 200;
  const candleIntervalMs = 5 * 60 * 1000; // 5 minutes
  let currentStart = startTimeMs;
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
          timestamp: parseInt(c[0]),
          open: parseFloat(c[1]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
          close: parseFloat(c[4]),
          volume: parseFloat(c[5]),
        }));

        // Bitget returns newest first, reverse to oldest first
        candles.reverse();
        allCandles.push(...candles);

        if (candles.length < maxPerRequest) {
          break; // No more data
        }

        // Move start to after the last candle we received
        const lastTs = candles[candles.length - 1].timestamp;
        currentStart = lastTs + candleIntervalMs;
      } else {
        break;
      }
    } catch (error: any) {
      console.error(`[AI Service] Error fetching 5min candles for ${symbol} from ${currentStart}: ${error.message}`);
      break;
    }

    // Small delay to respect rate limits
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
