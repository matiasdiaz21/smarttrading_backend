-- Migración: Eliminar columnas y tablas de whale vinculadas a estrategias
-- Ejecutar después de desplegar el código que elimina la lógica whale-strategy

-- 1. Eliminar FK y columnas whale de user_strategy_subscriptions
ALTER TABLE user_strategy_subscriptions DROP FOREIGN KEY IF EXISTS fk_whale_wallet;
ALTER TABLE user_strategy_subscriptions DROP COLUMN IF EXISTS whale_wallet_id;
ALTER TABLE user_strategy_subscriptions DROP COLUMN IF EXISTS custom_whale_address;

-- 2. Eliminar tabla whale_wallets
DROP TABLE IF EXISTS whale_wallets;

-- 3. Eliminar columna strategy_type de strategies
ALTER TABLE strategies DROP COLUMN IF EXISTS strategy_type;
