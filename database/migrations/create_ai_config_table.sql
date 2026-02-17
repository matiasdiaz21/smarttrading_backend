-- Tabla de configuración del sistema de IA
CREATE TABLE IF NOT EXISTS ai_config (
  id INT PRIMARY KEY DEFAULT 1,
  groq_api_key VARCHAR(500) DEFAULT NULL COMMENT 'Encrypted Groq API key',
  groq_model VARCHAR(100) DEFAULT 'llama-3.3-70b-versatile',
  system_prompt TEXT DEFAULT NULL COMMENT 'System prompt para la IA',
  analysis_prompt_template TEXT DEFAULT NULL COMMENT 'Template del prompt de análisis con variables',
  is_enabled TINYINT(1) DEFAULT 0 COMMENT 'Si el sistema de IA está habilitado',
  auto_run_enabled TINYINT(1) DEFAULT 0 COMMENT 'Si el auto-run está habilitado',
  auto_run_interval_hours INT DEFAULT 4 COMMENT 'Intervalo en horas para auto-run',
  last_auto_run_at DATETIME DEFAULT NULL,
  max_predictions_per_run INT DEFAULT 5 COMMENT 'Máximo de predicciones por ejecución',
  default_expiry_hours INT DEFAULT 24 COMMENT 'Horas por defecto para expiración de predicciones',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insertar configuración por defecto (system/analysis con soporte crypto vs forex vs commodities)
INSERT IGNORE INTO ai_config (id, system_prompt, analysis_prompt_template) VALUES (
  1,
  'Eres un analista de trading profesional con experiencia en criptomonedas, forex y commodities. Analizas datos técnicos (velas, RSI, MACD) y proporcionas predicciones con niveles de entrada, stop loss y take profit. Tu enfoque se adapta al tipo de activo: en crypto priorizas estructura técnica y sentimiento; en forex y commodities consideras el dólar (USD), datos macro y noticias que mueven el precio. Siempre respondes en formato JSON estructurado.',
  '## Contexto del activo ({{asset_category}}):\n{{category_instructions}}\n\nAnaliza los siguientes datos de mercado para {{symbol}} y proporciona una predicción de trading.\n\n## Datos de Velas 1H (última semana):\n{{candles_1h}}\n\n## Datos de Velas 4H (última semana):\n{{candles_4h}}\n\n## Indicadores Técnicos:\n- RSI(14) 1H: {{rsi_1h}}\n- RSI(14) 4H: {{rsi_4h}}\n- MACD(12,26,9) 1H: {{macd_1h}}\n- MACD(12,26,9) 4H: {{macd_4h}}\n\n## Precio actual: {{current_price}}\n\nResponde ÚNICAMENTE con un JSON válido con esta estructura:\n{\n  "side": "LONG" o "SHORT",\n  "entry_price": número,\n  "stop_loss": número,\n  "take_profit": número,\n  "confidence": número entre 0 y 100,\n  "timeframe": "1h" o "4h",\n  "reasoning": "explicación breve del análisis"\n}\n\nSi no hay una señal clara, usa confidence menor a 30.'
);
