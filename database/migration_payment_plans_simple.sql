-- Migración Simple: Agregar gestión de planes de pago (NOWPayments)
-- Ejecutar solo si la base de datos ya existe y tiene la tabla subscriptions
-- Si es una instalación nueva, usar schema.sql completo

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

-- 2. Agregar columna payment_plan_id a subscriptions
ALTER TABLE subscriptions 
ADD COLUMN payment_plan_id INT NULL AFTER user_id;

-- 3. Agregar foreign key
ALTER TABLE subscriptions 
ADD CONSTRAINT subscriptions_ibfk_2 
FOREIGN KEY (payment_plan_id) 
REFERENCES payment_plans(id) 
ON DELETE SET NULL;

-- 4. Agregar índice
ALTER TABLE subscriptions 
ADD INDEX idx_payment_plan_id (payment_plan_id);

-- Verificación
SELECT 'Migration completed successfully' AS status;
SELECT COUNT(*) AS payment_plans_count FROM payment_plans;
SELECT COUNT(*) AS subscriptions_with_plan FROM subscriptions WHERE payment_plan_id IS NOT NULL;

