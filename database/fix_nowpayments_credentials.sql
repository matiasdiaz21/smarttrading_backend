-- Script para corregir la tabla nowpayments_credentials si tiene problemas
USE smarttrading;

-- Eliminar registros vacíos o inválidos
DELETE FROM nowpayments_credentials 
WHERE (api_key = '' OR api_key IS NULL) 
   OR (public_key = '' OR public_key IS NULL);

-- Si la tabla tiene webhook_secret, actualizarla
ALTER TABLE nowpayments_credentials 
DROP COLUMN IF EXISTS webhook_secret;

-- Asegurar que public_key existe
ALTER TABLE nowpayments_credentials 
ADD COLUMN IF NOT EXISTS public_key TEXT NOT NULL AFTER api_key;

-- Verificar estructura
DESCRIBE nowpayments_credentials;

