-- Agregar campo de recomendaciones a la tabla strategies
-- Este campo almacenará recomendaciones en formato JSON como array de strings

USE smarttrading;

ALTER TABLE strategies 
ADD COLUMN recommendations TEXT NULL COMMENT 'JSON array de recomendaciones para la estrategia' 
AFTER description;
