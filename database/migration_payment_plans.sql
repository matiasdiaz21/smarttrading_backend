-- Migración: Agregar gestión de planes de pago (NOWPayments)
-- Fecha: 2026-01-22
-- Descripción: Crea la tabla payment_plans y actualiza subscriptions para incluir payment_plan_id

USE smarttrading;

-- 1. Crear tabla de planes de pago
CREATE TABLE IF NOT EXISTS payment_plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    duration_days INT NOT NULL DEFAULT 30,
    features TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Agregar columna payment_plan_id a la tabla subscriptions (si no existe)
-- Verificar si la columna ya existe antes de agregarla
SET @col_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = 'smarttrading' 
    AND TABLE_NAME = 'subscriptions' 
    AND COLUMN_NAME = 'payment_plan_id'
);

SET @sql = IF(@col_exists = 0,
    'ALTER TABLE subscriptions ADD COLUMN payment_plan_id INT NULL AFTER user_id',
    'SELECT "Column payment_plan_id already exists" AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Agregar foreign key para payment_plan_id (si no existe)
SET @fk_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
    WHERE TABLE_SCHEMA = 'smarttrading' 
    AND TABLE_NAME = 'subscriptions' 
    AND CONSTRAINT_NAME = 'subscriptions_ibfk_2'
);

SET @sql_fk = IF(@fk_exists = 0,
    'ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_ibfk_2 FOREIGN KEY (payment_plan_id) REFERENCES payment_plans(id) ON DELETE SET NULL',
    'SELECT "Foreign key already exists" AS message'
);

PREPARE stmt_fk FROM @sql_fk;
EXECUTE stmt_fk;
DEALLOCATE PREPARE stmt_fk;

-- 4. Agregar índice para payment_plan_id (si no existe)
SET @idx_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.STATISTICS 
    WHERE TABLE_SCHEMA = 'smarttrading' 
    AND TABLE_NAME = 'subscriptions' 
    AND INDEX_NAME = 'idx_payment_plan_id'
);

SET @sql_idx = IF(@idx_exists = 0,
    'ALTER TABLE subscriptions ADD INDEX idx_payment_plan_id (payment_plan_id)',
    'SELECT "Index idx_payment_plan_id already exists" AS message'
);

PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- Verificación final
SELECT 'Migration completed successfully' AS status;

