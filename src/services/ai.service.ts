import axios from 'axios';
import { AiConfigModel, AiConfigRow } from '../models/AiConfig';
import { AiAssetModel, AiAssetRow } from '../models/AiAsset';
import { AiPredictionModel } from '../models/AiPrediction';

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
        productType: productType.toLowerCase(),
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
        productType: productType.toLowerCase(),
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
  // Sample candles to reduce tokens while keeping representative data
  const step = Math.max(1, Math.floor(candles.length / maxRows));
  const sampled = candles.filter((_, i) => i % step === 0 || i === candles.length - 1);

  const lines = sampled.map(c => {
    const date = new Date(c.timestamp).toISOString().slice(0, 16);
    return `${date} | O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${Math.round(c.volume)}`;
  });

  return lines.join('\n');
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
  if (!config.system_prompt || !config.analysis_prompt_template) {
    throw new Error('Prompts de IA no configurados');
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

  console.log(`[AI Service] 📈 Indicadores: RSI_1H=${rsi1h.toFixed(2)}, RSI_4H=${rsi4h.toFixed(2)}, MACD_1H=${macd1h.macd}, MACD_4H=${macd4h.macd}`);

  // 3. Build prompt from template
  const userPrompt = config.analysis_prompt_template
    .replace('{{symbol}}', symbol)
    .replace('{{candles_1h}}', formatCandlesForPrompt(candles1h, 25))
    .replace('{{candles_4h}}', formatCandlesForPrompt(candles4h, 20))
    .replace('{{rsi_1h}}', rsi1h.toFixed(2))
    .replace('{{rsi_4h}}', rsi4h.toFixed(2))
    .replace('{{macd_1h}}', `MACD: ${macd1h.macd}, Signal: ${macd1h.signal}, Histogram: ${macd1h.histogram}`)
    .replace('{{macd_4h}}', `MACD: ${macd4h.macd}, Signal: ${macd4h.signal}, Histogram: ${macd4h.histogram}`)
    .replace('{{current_price}}', currentPrice.toString());

  // 4. Call Groq
  console.log(`[AI Service] 🤖 Consultando Groq (${config.groq_model})...`);
  const { response, tokensUsed, rawResponse } = await callGroq(
    config.groq_api_key,
    config.groq_model,
    config.system_prompt,
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

export async function checkPredictionResults(): Promise<{
  checked: number;
  resolved: number;
  results: Array<{ id: number; symbol: string; status: string; pnl: number }>;
}> {
  const activePredictions = await AiPredictionModel.findActive();

  if (activePredictions.length === 0) {
    return { checked: 0, resolved: 0, results: [] };
  }

  console.log(`[AI Service] 🔍 Verificando ${activePredictions.length} predicciones activas...`);

  // Expire old ones first
  await AiPredictionModel.expireOld();

  // Get unique symbols
  const symbols = [...new Set(activePredictions.map(p => p.symbol))];

  // Fetch current prices for all symbols in parallel
  const priceMap: Record<string, number> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        priceMap[symbol] = await fetchCurrentPrice(symbol);
      } catch (error: any) {
        console.error(`[AI Service] Error getting price for ${symbol}: ${error.message}`);
      }
    })
  );

  const results: Array<{ id: number; symbol: string; status: string; pnl: number }> = [];
  let resolved = 0;

  for (const prediction of activePredictions) {
    const currentPrice = priceMap[prediction.symbol];
    if (!currentPrice) continue;

    // Check if expired
    if (new Date(prediction.expires_at) < new Date()) {
      await AiPredictionModel.updateStatus(prediction.id, 'expired', 'auto', currentPrice);
      resolved++;
      results.push({ id: prediction.id, symbol: prediction.symbol, status: 'expired', pnl: 0 });
      continue;
    }

    let status: 'won' | 'lost' | null = null;
    let pnlPercent = 0;

    if (prediction.side === 'LONG') {
      // LONG: won if price >= TP, lost if price <= SL
      if (currentPrice >= prediction.take_profit) {
        status = 'won';
        pnlPercent = ((prediction.take_profit - prediction.entry_price) / prediction.entry_price) * 100;
      } else if (currentPrice <= prediction.stop_loss) {
        status = 'lost';
        pnlPercent = ((prediction.stop_loss - prediction.entry_price) / prediction.entry_price) * 100;
      }
    } else {
      // SHORT: won if price <= TP, lost if price >= SL
      if (currentPrice <= prediction.take_profit) {
        status = 'won';
        pnlPercent = ((prediction.entry_price - prediction.take_profit) / prediction.entry_price) * 100;
      } else if (currentPrice >= prediction.stop_loss) {
        status = 'lost';
        pnlPercent = ((prediction.entry_price - prediction.stop_loss) / prediction.entry_price) * 100;
      }
    }

    if (status) {
      await AiPredictionModel.updateStatus(prediction.id, status, 'auto', currentPrice, Math.round(pnlPercent * 100) / 100);
      resolved++;
      results.push({ id: prediction.id, symbol: prediction.symbol, status, pnl: Math.round(pnlPercent * 100) / 100 });
      console.log(`[AI Service] ${status === 'won' ? '✅' : '❌'} Predicción #${prediction.id} ${prediction.symbol}: ${status} (${pnlPercent.toFixed(2)}%)`);
    }
  }

  console.log(`[AI Service] 🔍 Verificación completa: ${results.length} resueltas de ${activePredictions.length} activas`);

  return { checked: activePredictions.length, resolved, results };
}
