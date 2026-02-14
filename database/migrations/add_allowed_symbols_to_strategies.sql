-- Migración: Agregar símbolos permitidos por estrategia
-- Si allowed_symbols es NULL o JSON array vacío [], la estrategia acepta cualquier símbolo.
-- Si tiene valores ["BTCUSDT","ETHUSDT"], solo se aceptan esas señales para esa estrategia.

ALTER TABLE strategies
ADD COLUMN allowed_symbols JSON NULL
COMMENT 'Símbolos permitidos para esta estrategia. NULL o [] = todos.'
AFTER leverage;
