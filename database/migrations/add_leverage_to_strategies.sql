-- Migración: Agregar campo leverage a la tabla strategies
-- Fecha: 2026-01-24

ALTER TABLE strategies 
ADD COLUMN leverage INT NOT NULL DEFAULT 10 
AFTER is_active;

-- Comentario: El apalancamiento por defecto es 10x (10 veces el capital)

