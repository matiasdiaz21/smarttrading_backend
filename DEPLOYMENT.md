# Guía de Despliegue

## Configuración de Vercel

### Backend

#### Paso 1: Conectar Repositorio a Vercel

1. Ve a [Vercel Dashboard](https://vercel.com/dashboard)
2. Haz clic en **"Add New Project"**
3. Selecciona tu repositorio de GitHub (`synctrade_backend`)
4. Vercel detectará automáticamente la configuración

#### Paso 2: Configuración del Proyecto

**Framework Preset:**
- Selecciona **"Other"** o deja en blanco (no es Next.js)

**Root Directory:**
- Deja vacío (el proyecto está en la raíz)

**Build Command:**
- `npm run build`

**Output Directory:**
- `.` (punto - la raíz)

**Install Command:**
- `npm install`

#### Paso 3: Variables de Entorno

Configura las siguientes variables de entorno en Vercel (Settings > Environment Variables):

```
DB_HOST=tu-host-mysql
DB_PORT=3306
DB_USER=tu-usuario
DB_PASSWORD=tu-password
DB_NAME=smarttrading
JWT_SECRET=tu-secret-jwt-muy-seguro
ENCRYPTION_KEY=tu-clave-encriptacion-32-caracteres
BITGET_API_BASE_URL=https://api.bitget.com
APP_URL=https://tu-backend.vercel.app
FRONTEND_URL=https://tu-frontend.vercel.app
NODE_ENV=production
```

**Nota importante:** 
- Las credenciales de NOWPayments (API Key, Public Key, Email, Password) se configuran desde el panel de administración en `/admin/nowpayments-credentials` y se almacenan encriptadas en la base de datos. No se requieren variables de entorno para NOWPayments.
- Reemplaza `https://tu-backend.vercel.app` con la URL real que Vercel te proporcione después del despliegue
- Reemplaza `https://tu-frontend.vercel.app` con la URL real de tu frontend

#### Paso 4: Desplegar

1. Haz clic en **"Deploy"**
2. Vercel construirá y desplegará tu aplicación automáticamente
3. El proceso tomará unos minutos
4. Una vez completado, obtendrás una URL como: `https://synctrade-backend.vercel.app`

#### Paso 5: Actualizar Variables de Entorno

Después del primer despliegue, actualiza las variables de entorno con las URLs reales:

1. Ve a **Settings** > **Environment Variables**
2. Actualiza `APP_URL` con la URL real de tu backend
3. Actualiza `FRONTEND_URL` con la URL real de tu frontend
4. Haz clic en **"Redeploy"** para aplicar los cambios

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

## Configuración Inicial Post-Despliegue

Una vez desplegado el backend y frontend, sigue estos pasos:

1. **Inicia sesión como administrador** en el frontend
2. **Configura credenciales de NOWPayments:**
   - Ve a `/admin/nowpayments-credentials`
   - Registra Email, Password, API Key y Public Key
   - Haz clic en "Validar conexión" para verificar
3. **Crea estrategias:**
   - Ve a `/admin/strategies`
   - Crea las estrategias que usarás para recibir alertas de TradingView
4. **Configura webhooks de TradingView** (ver sección siguiente)
5. **Los usuarios deben:**
   - Suscribirse a un plan de pago desde `/subscription`
   - Registrar sus credenciales de Bitget desde `/credentials`
   - Suscribirse a estrategias desde `/strategies` y activar la copia de trades

## Webhook de TradingView

Para configurar el webhook en TradingView:

1. Crea una estrategia desde el panel de administración en `/admin/strategies`
2. En TradingView, configura la URL del webhook (única para todas las estrategias):
   ```
   https://tu-backend.vercel.app/api/webhooks/tradingview
   ```
3. **Importante:** El sistema identifica la estrategia automáticamente por el nombre en el campo `strategy` del payload de la alerta. Asegúrate de que el nombre de la estrategia en TradingView coincida exactamente con el nombre registrado en el sistema.
4. No se requiere configuración de HMAC - el sistema valida las alertas por nombre de estrategia

## NOWPayments

### Configuración de Credenciales

1. Accede al panel de administración en `/admin/nowpayments-credentials`
2. Registra las siguientes credenciales (se almacenarán encriptadas en la base de datos):
   - **Email:** Tu email de cuenta de NOWPayments
   - **Password:** Tu contraseña de cuenta de NOWPayments
   - **API Key:** Tu API Key de NOWPayments
   - **Public Key:** Tu Public Key de NOWPayments
3. Haz clic en "Validar conexión" para verificar que las credenciales son correctas
4. El sistema gestionará automáticamente la autenticación y renovación de tokens

### Configuración del Webhook

1. Configura el webhook en NOWPayments apuntando a:
   ```
   https://tu-backend.vercel.app/api/payments/webhook
   ```
2. El sistema validará automáticamente los webhooks usando las credenciales almacenadas en la base de datos

### Configuración en NOWPayments Dashboard

1. Ve a tu cuenta de NOWPayments
2. Configura un **payout wallet** en la sección de configuración
3. Asegúrate de que tu API Key tenga los permisos necesarios para crear pagos
