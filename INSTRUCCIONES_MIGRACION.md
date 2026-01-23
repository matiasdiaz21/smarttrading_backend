# Instrucciones para ejecutar la migración

## Paso 1: Ejecutar la migración SQL

Ejecuta el siguiente SQL en tu base de datos MySQL (puedes usar phpMyAdmin o la línea de comandos):

```sql
USE smarttrading;

-- Agregar columnas si no existen
ALTER TABLE nowpayments_credentials 
ADD COLUMN IF NOT EXISTS email VARCHAR(255) NULL AFTER id,
ADD COLUMN IF NOT EXISTS password TEXT NULL AFTER email,
ADD COLUMN IF NOT EXISTS token TEXT NULL AFTER password,
ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP NULL AFTER token;
```

**Nota**: Si MySQL no soporta `IF NOT EXISTS` en ALTER TABLE, usa el archivo `database/migration_nowpayments_auth.sql` que tiene una versión compatible.

## Paso 2: Configurar credenciales en el panel de administración

1. Inicia el backend y frontend
2. Accede al panel de administración: `/admin/nowpayments-credentials`
3. Crea nuevas credenciales con:
   - **Email**: `heatauxz@live.com`
   - **Password**: `SD!vNfN$E65XP7r`
   - **API Key**: (opcional, dejar vacío)
   - **Public Key**: (opcional, dejar vacío)
   - **API URL**: `https://api.nowpayments.io/v1`

## Paso 3: Ejecutar el test

```bash
npm run test:nowpayments
```

El test debería:
1. Cargar las credenciales de la base de datos
2. Autenticarse con email/password en `/auth`
3. Obtener un token
4. Probar la conexión con `/status`
5. Intentar crear un invoice de prueba

