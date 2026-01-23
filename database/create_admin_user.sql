-- Script para crear un usuario administrador o actualizar el rol de un usuario existente
USE smarttrading;

-- Opción 1: Crear un nuevo usuario administrador
-- Reemplaza 'admin@example.com' y 'tu_contraseña_segura' con tus valores
-- INSERT INTO users (email, password_hash, role, subscription_status, created_at)
-- VALUES (
--   'admin@example.com',
--   '$2a$10$TuHashDeContraseñaAquí', -- Debe ser un hash bcrypt de tu contraseña
--   'admin',
--   'active',
--   NOW()
-- );

-- Opción 2: Actualizar el rol de un usuario existente a admin
-- Reemplaza 'tu@email.com' con el email del usuario que quieres hacer admin
UPDATE users 
SET role = 'admin' 
WHERE email = 'tu@email.com';

-- Verificar usuarios admin
SELECT id, email, role, created_at 
FROM users 
WHERE role = 'admin';

