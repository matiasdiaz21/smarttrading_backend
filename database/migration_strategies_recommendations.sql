-- Agregar campo de advertencias a la tabla strategies
-- Este campo almacenará advertencias en formato de texto multilínea

USE smarttrading;

ALTER TABLE strategies 
ADD COLUMN warnings TEXT NULL COMMENT 'Advertencias importantes sobre la estrategia' 
AFTER description;
