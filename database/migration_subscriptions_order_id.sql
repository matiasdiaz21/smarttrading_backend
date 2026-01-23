-- Migración: Agregar campo order_id a tabla subscriptions
USE smarttrading;

-- Agregar columna order_id si no existe
ALTER TABLE subscriptions 
ADD COLUMN IF NOT EXISTS order_id VARCHAR(255) NULL AFTER payment_id,
ADD INDEX IF NOT EXISTS idx_order_id (order_id);

