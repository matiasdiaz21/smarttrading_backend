-- Agregar columna is_reviewed a bitget_operation_logs
ALTER TABLE bitget_operation_logs 
ADD COLUMN is_reviewed BOOLEAN DEFAULT false AFTER success,
ADD INDEX idx_is_reviewed (is_reviewed);
