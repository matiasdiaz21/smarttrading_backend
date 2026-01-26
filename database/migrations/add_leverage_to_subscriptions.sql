-- Migración: Agregar campo leverage a la tabla user_strategy_subscriptions
-- Fecha: 2026-01-24

ALTER TABLE user_strategy_subscriptions 
ADD COLUMN leverage INT NULL 
AFTER is_enabled;

-- Comentario: Si leverage es NULL, se usa el leverage por defecto de la estrategia
-- Si el usuario define un leverage, se usa ese valor personalizado


