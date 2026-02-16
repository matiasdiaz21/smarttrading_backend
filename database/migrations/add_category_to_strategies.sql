-- Añadir categoría a estrategias (crypto, forex, indices, commodities, otros)
ALTER TABLE strategies
  ADD COLUMN category VARCHAR(64) NULL DEFAULT 'crypto';
