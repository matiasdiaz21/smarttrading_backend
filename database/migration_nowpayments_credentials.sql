-- Migración: Agregar tabla para gestionar credenciales de NOWPayments
USE smarttrading;

-- Crear tabla de credenciales de NOWPayments (solo una configuración global)
CREATE TABLE IF NOT EXISTS nowpayments_credentials (
    id INT AUTO_INCREMENT PRIMARY KEY,
    api_key TEXT NOT NULL,
    public_key TEXT NOT NULL,
    api_url VARCHAR(255) NOT NULL DEFAULT 'https://api.nowpayments.io/v1',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Si la tabla ya existe con webhook_secret, actualizarla
-- Ejecutar manualmente si es necesario:
-- ALTER TABLE nowpayments_credentials DROP COLUMN webhook_secret;
-- ALTER TABLE nowpayments_credentials ADD COLUMN public_key TEXT NOT NULL AFTER api_key;

-- Limpiar registros vacíos o inválidos
DELETE FROM nowpayments_credentials 
WHERE (api_key = '' OR api_key IS NULL) 
   OR (public_key = '' OR public_key IS NULL);

