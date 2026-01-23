-- Migración: Agregar campo pay_currency a tabla payment_plans
USE smarttrading;

-- Agregar columna pay_currency si no existe
ALTER TABLE payment_plans 
ADD COLUMN IF NOT EXISTS pay_currency VARCHAR(50) NULL AFTER currency,
ADD INDEX IF NOT EXISTS idx_pay_currency (pay_currency);

