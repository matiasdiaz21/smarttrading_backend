-- Usar el placeholder {{json_response_format}} en los tres templates por categoría.
-- El backend inyecta el formato/estrategia específico (crypto/forex/commodities) desde getJsonResponseFormatForCategory().
-- Así la definición del JSON y la estrategia NUNCA son iguales entre categorías y quedan alineadas con la investigación en DB.

UPDATE ai_config SET
  analysis_prompt_template_crypto = REPLACE(
    analysis_prompt_template_crypto,
    'Responde ÚNICAMENTE con un JSON válido:
{
  "side": "LONG" o "SHORT",
  "entry_price": número,
  "stop_loss": número,
  "take_profit": número,
  "confidence": número 0-100,
  "timeframe": "1h" o "4h",
  "reasoning": "explicación técnica breve (confluencia, RSI/MACD, estructura SMC, EMAs, ATR)"
}

Si no hay señal clara por falta de confluencia, usa confidence < 30.',
    '{{json_response_format}}'
  ),
  analysis_prompt_template_forex = REPLACE(
    analysis_prompt_template_forex,
    'Responde ÚNICAMENTE con un JSON válido:
{
  "side": "LONG" o "SHORT",
  "entry_price": número,
  "stop_loss": número,
  "take_profit": número,
  "confidence": número 0-100,
  "timeframe": "1h" o "4h",
  "reasoning": "explicación técnica breve (confluencia, sesiones, RSI/MACD, estructura, ATR)"
}

Si no hay señal clara por falta de confluencia, usa confidence < 30.',
    '{{json_response_format}}'
  ),
  analysis_prompt_template_commodities = REPLACE(
    analysis_prompt_template_commodities,
    'Responde ÚNICAMENTE con un JSON válido:
{
  "side": "LONG" o "SHORT",
  "entry_price": número,
  "stop_loss": número,
  "take_profit": número,
  "confidence": número 0-100,
  "timeframe": "1h" o "4h",
  "reasoning": "explicación técnica breve (confluencia, EMAs, S/R, RSI/MACD, ATR)"
}

Si no hay señal clara por falta de confluencia, usa confidence < 30.',
    '{{json_response_format}}'
  )
WHERE id = 1;
