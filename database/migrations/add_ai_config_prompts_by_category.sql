-- Prompts personalizados por categoría (crypto, forex, commodities)
-- Si están definidos, se usan para esa categoría; si no, se usa el prompt global o el automático por categoría.
ALTER TABLE ai_config
  ADD COLUMN system_prompt_crypto TEXT DEFAULT NULL COMMENT 'System prompt para activos crypto',
  ADD COLUMN system_prompt_forex TEXT DEFAULT NULL COMMENT 'System prompt para activos forex',
  ADD COLUMN system_prompt_commodities TEXT DEFAULT NULL COMMENT 'System prompt para commodities',
  ADD COLUMN analysis_prompt_template_crypto TEXT DEFAULT NULL COMMENT 'Template análisis crypto',
  ADD COLUMN analysis_prompt_template_forex TEXT DEFAULT NULL COMMENT 'Template análisis forex',
  ADD COLUMN analysis_prompt_template_commodities TEXT DEFAULT NULL COMMENT 'Template análisis commodities';
