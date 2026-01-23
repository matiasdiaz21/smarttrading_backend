-- Migración: Agregar campos adicionales de NOWPayments a tabla subscriptions
USE smarttrading;

-- Agregar columnas para almacenar información completa del payment
ALTER TABLE subscriptions 
ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) NULL AFTER order_id,
ADD COLUMN IF NOT EXISTS pay_address VARCHAR(255) NULL AFTER payment_status,
ADD COLUMN IF NOT EXISTS pay_amount DECIMAL(20, 8) NULL AFTER pay_address,
ADD COLUMN IF NOT EXISTS pay_currency VARCHAR(10) NULL AFTER pay_amount,
ADD COLUMN IF NOT EXISTS purchase_id VARCHAR(255) NULL AFTER pay_currency,
ADD COLUMN IF NOT EXISTS amount_received DECIMAL(20, 8) NULL AFTER purchase_id,
ADD COLUMN IF NOT EXISTS network VARCHAR(50) NULL AFTER amount_received,
ADD COLUMN IF NOT EXISTS expiration_estimate_date DATETIME NULL AFTER network,
ADD COLUMN IF NOT EXISTS nowpayments_created_at DATETIME NULL AFTER expiration_estimate_date,
ADD COLUMN IF NOT EXISTS nowpayments_updated_at DATETIME NULL AFTER nowpayments_created_at;

-- Agregar índices para búsquedas frecuentes
ALTER TABLE subscriptions
ADD INDEX IF NOT EXISTS idx_payment_status (payment_status),
ADD INDEX IF NOT EXISTS idx_order_id (order_id);

