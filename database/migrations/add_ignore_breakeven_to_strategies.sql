-- Ignorar alertas BREAKEVEN y nivel BE en triggers (solo TP/SL) por estrategia; ver plan admin.
ALTER TABLE strategies
ADD COLUMN ignore_breakeven BOOLEAN NOT NULL DEFAULT FALSE
COMMENT 'Si true: no ejecutar processBreakevenAlert y no usar breakevenPrice en ENTRY (prioridad sobre use_partial_tp del usuario)'
AFTER free_until;
