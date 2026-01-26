-- Migración: Agregar campo position_size a la tabla user_strategy_subscriptions
-- Fecha: 2026-01-26
-- Descripción: Permite a los usuarios configurar un tamaño de posición personalizado para cada estrategia

ALTER TABLE user_strategy_subscriptions 
ADD COLUMN position_size DECIMAL(20, 8) NULL 
AFTER leverage;

-- Comentario: Si position_size es NULL, se usa el tamaño calculado automáticamente basado en minTradeUSDT
-- Si el usuario define un position_size, se usa ese valor personalizado (en USDT)
-- El valor debe ser mayor o igual al mínimo requerido por el exchange (minTradeUSDT)
