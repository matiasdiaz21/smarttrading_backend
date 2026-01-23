-- Migración: Agregar campos adicionales a tabla trades para soportar alertas de TradingView
USE smarttrading;

-- Agregar columnas para información de la operación
ALTER TABLE trades 
ADD COLUMN IF NOT EXISTS trade_id VARCHAR(50) NULL AFTER bitget_order_id,
ADD COLUMN IF NOT EXISTS entry_price DECIMAL(18, 8) NULL AFTER price,
ADD COLUMN IF NOT EXISTS stop_loss DECIMAL(18, 8) NULL AFTER entry_price,
ADD COLUMN IF NOT EXISTS take_profit DECIMAL(18, 8) NULL AFTER stop_loss,
ADD COLUMN IF NOT EXISTS breakeven DECIMAL(18, 8) NULL AFTER take_profit,
ADD COLUMN IF NOT EXISTS alert_type VARCHAR(20) NULL AFTER breakeven,
ADD INDEX IF NOT EXISTS idx_trade_id (trade_id),
ADD INDEX IF NOT EXISTS idx_alert_type (alert_type);

