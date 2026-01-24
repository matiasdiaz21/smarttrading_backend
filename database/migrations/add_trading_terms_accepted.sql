-- Migración: Agregar campo trading_terms_accepted_at a la tabla users
-- Fecha: 2026-01-24

ALTER TABLE users 
ADD COLUMN trading_terms_accepted_at DATETIME NULL 
AFTER subscription_expires_at;

-- Índice para búsquedas rápidas
CREATE INDEX idx_trading_terms_accepted ON users(trading_terms_accepted_at);

