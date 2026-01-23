-- Migración: Permitir strategy_id NULL en webhook_logs
-- Esto permite registrar webhooks incluso cuando no hay estrategias configuradas
USE smarttrading;

-- Modificar la columna para permitir NULL
ALTER TABLE webhook_logs 
MODIFY COLUMN strategy_id INT NULL;

-- Nota: La foreign key constraint seguirá funcionando, pero ahora permite NULL
-- cuando no hay estrategias disponibles

