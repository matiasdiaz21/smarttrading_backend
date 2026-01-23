# Guía Rápida de Despliegue en Vercel - Backend

## Pasos para Desplegar

### 1. Preparar el Repositorio

Asegúrate de que tu código esté en GitHub y actualizado:

```bash
cd D:\xamp\htdocs\smarttrading_backend
git add .
git commit -m "Preparar para despliegue en Vercel"
git push origin main
```

### 2. Conectar a Vercel

1. Ve a [Vercel Dashboard](https://vercel.com/dashboard)
2. Haz clic en **"Add New Project"**
3. Selecciona tu repositorio de GitHub (`smarttrading_backend`)
4. Si no está conectado, autoriza a Vercel a acceder a tu repositorio

### 3. Configurar el Proyecto

**Framework Preset:**
- Selecciona **"Other"** (no es Next.js ni otro framework)

**Root Directory:**
- Deja vacío (el proyecto está en la raíz del repositorio)

**Build Command:**
```
npm run build
```

**Output Directory:**
```
.
```

**Install Command:**
```
npm install
```

### 4. Configurar Variables de Entorno

Antes de desplegar, configura estas variables en **Settings > Environment Variables**:

#### Variables Requeridas:

```
DB_HOST=tu-host-mysql
DB_PORT=3306
DB_USER=tu-usuario
DB_PASSWORD=tu-password
DB_NAME=smarttrading
JWT_SECRET=tu-secret-jwt-muy-seguro-minimo-32-caracteres
ENCRYPTION_KEY=tu-clave-encriptacion-exactamente-32-caracteres
BITGET_API_BASE_URL=https://api.bitget.com
NODE_ENV=production
```

#### Variables Opcionales (actualizar después del despliegue):

```
APP_URL=https://tu-backend.vercel.app
FRONTEND_URL=https://tu-frontend.vercel.app
```

**Importante:**
- `JWT_SECRET`: Debe ser una cadena segura de al menos 32 caracteres
- `ENCRYPTION_KEY`: Debe ser exactamente 32 caracteres (para AES-256)
- Puedes generar claves seguras con: `openssl rand -base64 32`

### 5. Desplegar

1. Haz clic en **"Deploy"**
2. Espera a que Vercel construya y despliegue tu aplicación
3. Una vez completado, obtendrás una URL como: `https://smarttrading-backend-xxxxx.vercel.app`

### 6. Verificar el Despliegue

1. Visita la URL de tu backend
2. Prueba el endpoint de health check: `https://tu-backend.vercel.app/api/health`
3. Deberías ver: `{"status":"ok","timestamp":"..."}`

### 7. Actualizar Variables de Entorno con URLs Reales

Después del primer despliegue:

1. Ve a **Settings** > **Environment Variables**
2. Actualiza `APP_URL` con la URL real de tu backend (ej: `https://smarttrading-backend-xxxxx.vercel.app`)
3. Actualiza `FRONTEND_URL` con la URL real de tu frontend
4. Ve a **Deployments** y haz clic en **"Redeploy"** en el último deployment

### 8. Configurar Base de Datos

1. Crea una base de datos MySQL (puedes usar PlanetScale, Railway, o cualquier proveedor)
2. Ejecuta el script `database/schema.sql` para crear las tablas
3. Actualiza las variables de entorno `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` con tus credenciales
4. Haz **Redeploy** para aplicar los cambios

### 9. Crear Usuario Admin

Después de configurar la base de datos, crea un usuario admin:

```sql
-- Genera el hash de la contraseña con bcrypt (ejemplo: "admin123")
-- Puedes usar Node.js:
-- const bcrypt = require('bcryptjs');
-- const hash = await bcrypt.hash('admin123', 10);

INSERT INTO users (email, password_hash, role) 
VALUES ('admin@smarttrading.com', '$2a$10$...', 'admin');
```

O usa el script: `database/create_admin_user.sql`

### 10. Configuración Post-Despliegue

Una vez desplegado:

1. **Inicia sesión como administrador** en el frontend
2. **Configura credenciales de NOWPayments:**
   - Ve a `/admin/nowpayments-credentials`
   - Registra Email, Password, API Key y Public Key
   - Haz clic en "Validar conexión"
3. **Crea estrategias:**
   - Ve a `/admin/strategies`
   - Crea las estrategias para TradingView
4. **Configura webhooks:**
   - TradingView: `https://tu-backend.vercel.app/api/webhooks/tradingview`
   - NOWPayments: `https://tu-backend.vercel.app/api/payments/webhook`

## Solución de Problemas

### Error: "Module not found"

- Verifica que todas las dependencias estén en `package.json`
- Asegúrate de que `npm install` se ejecute correctamente

### Error: "Database connection failed"

- Verifica las variables de entorno de la base de datos
- Asegúrate de que la base de datos permita conexiones desde la IP de Vercel
- Verifica que el puerto 3306 esté abierto

### Error: "JWT_SECRET is not defined"

- Asegúrate de haber configurado todas las variables de entorno
- Verifica que las variables estén configuradas para **Production**, **Preview** y **Development**

### El endpoint no responde

- Verifica que el archivo `api/index.ts` esté correctamente configurado
- Revisa los logs en Vercel Dashboard > Deployments > [tu deployment] > Functions

## Verificación Final

Después del despliegue, verifica estos endpoints:

- ✅ `GET /api/health` - Debe responder `{"status":"ok"}`
- ✅ `POST /api/auth/login` - Debe funcionar con credenciales válidas
- ✅ `GET /api/public/stats` - Debe devolver estadísticas públicas

## Notas Importantes

- Las credenciales de NOWPayments se configuran desde el panel de administración, no desde variables de entorno
- El sistema usa funciones serverless de Vercel, por lo que cada request es independiente
- Los logs están disponibles en Vercel Dashboard > Deployments > [tu deployment] > Functions

