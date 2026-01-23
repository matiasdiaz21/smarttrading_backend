-- Migración: Agregar campo uuid a tabla users
USE smarttrading;

-- Agregar columna uuid si no existe
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS uuid VARCHAR(36) NULL AFTER id,
ADD INDEX IF NOT EXISTS idx_uuid (uuid);

-- Generar UUIDs para usuarios existentes que no tengan uno
UPDATE users 
SET uuid = UUID() 
WHERE uuid IS NULL OR uuid = '';

