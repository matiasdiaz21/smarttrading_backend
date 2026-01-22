# Guía de Despliegue

## Configuración de Vercel

### Backend

1. Conecta tu repositorio de GitHub a Vercel
2. Configura las siguientes variables de entorno en Vercel:

```
DB_HOST=tu-host-mysql
DB_PORT=3306
DB_USER=tu-usuario
DB_PASSWORD=tu-password
DB_NAME=smarttrading
JWT_SECRET=tu-secret-jwt-muy-seguro
ENCRYPTION_KEY=tu-clave-encriptacion-32-caracteres
BITGET_API_BASE_URL=https://api.bitget.com
NOWPAYMENTS_API_KEY=tu-api-key
NOWPAYMENTS_API_URL=https://api.nowpayments.io/v1
NOWPAYMENTS_WEBHOOK_SECRET=tu-webhook-secret
APP_URL=https://tu-backend.vercel.app
FRONTEND_URL=https://tu-frontend.vercel.app
```

3. El despliegue se realizará automáticamente con GitHub Actions

### Frontend

1. Conecta tu repositorio de GitHub a Vercel
2. Configura la variable de entorno:

```
NEXT_PUBLIC_API_URL=https://tu-backend.vercel.app
```

3. El despliegue se realizará automáticamente con GitHub Actions

## Configuración de GitHub Actions

Para que GitHub Actions funcione, necesitas agregar los siguientes secrets en tu repositorio:

- `VERCEL_TOKEN`: Token de Vercel (obtener en Vercel Dashboard > Settings > Tokens)
- `VERCEL_ORG_ID`: ID de tu organización en Vercel
- `VERCEL_PROJECT_ID`: ID del proyecto en Vercel (se encuentra en la URL del proyecto)

## Base de Datos MySQL

1. Crea una base de datos MySQL (puedes usar PlanetScale, Railway, o cualquier proveedor)
2. Ejecuta el script `database/schema.sql` para crear las tablas
3. Configura las variables de entorno de conexión en Vercel

## Crear Usuario Admin

Después de crear la base de datos, necesitas crear un usuario admin manualmente. Puedes usar este script:

```sql
-- Genera el hash de la contraseña con bcrypt (ejemplo: "admin123")
-- Puedes usar una herramienta online o Node.js:
-- const bcrypt = require('bcryptjs');
-- const hash = await bcrypt.hash('admin123', 10);

INSERT INTO users (email, password_hash, role) 
VALUES ('admin@smarttrading.com', '$2a$10$...', 'admin');
```

## Webhook de TradingView

Para configurar el webhook en TradingView:

1. Obtén el `tradingview_webhook_secret` de la estrategia desde la base de datos
2. En TradingView, configura la URL del webhook:
   ```
   https://tu-backend.vercel.app/api/webhooks/tradingview/{strategy_id}
   ```
3. Configura el header de firma HMAC:
   ```
   X-Signature: {hmac_sha256(payload, secret)}
   ```

## NOWPayments

1. Configura el webhook en NOWPayments apuntando a:
   ```
   https://tu-backend.vercel.app/api/payments/webhook
   ```
2. Usa el mismo `NOWPAYMENTS_WEBHOOK_SECRET` en NOWPayments y en Vercel
