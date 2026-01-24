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

**⚠️ IMPORTANTE:** Las variables de entorno DEBEN estar configuradas en **Vercel Environment Variables**, NO solo en GitHub Secrets.

- **GitHub Secrets**: Solo se usan para CI/CD (GitHub Actions)
- **Vercel Environment Variables**: Se inyectan en el runtime de la aplicación

Antes de desplegar, configura estas variables en **Vercel Dashboard > Settings > Environment Variables**:

#### Variables Requeridas:

```
DB_HOST=tu-host-mysql
DB_PORT=3306
DB_USER=tu-usuario
DB_PASSWORD=tu-password
DB_NAME=smarttrading
JWT_SECRET=B0p1QMX8aBzrX6WPSWXT9ZkPFGE7iIUKGf2Lk7DNpsNt74OiuuXAULfb1+cE/uNdjVZizG/7nlXPxCfQfkqKFQ==
ENCRYPTION_KEY=ed2a65c02b15c8c90745ea92c50a9803841dcf6a36c9142d58a455913e1b7f81
BITGET_API_BASE_URL=https://api.bitget.com
NODE_ENV=production
```

#### Variables Opcionales (actualizar después del despliegue):

```
APP_URL=https://tu-backend.vercel.app
FRONTEND_URL=https://tu-frontend.vercel.app
```

#### Cómo Configurar en Vercel:

1. Ve a **Vercel Dashboard** > Tu proyecto del backend
2. Ve a **Settings** > **Environment Variables**
3. Haz clic en **Add New** para cada variable
4. Para cada variable:
   - **Name**: El nombre de la variable (ej: `DB_HOST`)
   - **Value**: El valor de la variable (ej: `tu-host-mysql`)
   - **Environment**: Selecciona **Production**, **Preview** y **Development** (o al menos Production)
5. Haz clic en **Save** después de cada variable
6. **IMPORTANTE:** Después de agregar todas las variables, ve a **Deployments** y haz clic en **Redeploy** en el último deployment

**Importante:**
- `JWT_SECRET`: Debe ser una cadena segura de al menos 32 caracteres
- `ENCRYPTION_KEY`: Debe ser exactamente 32 caracteres (para AES-256)
- Puedes generar claves seguras con: `openssl rand -base64 32`
- Si las variables no están configuradas, verás errores en los logs de Vercel indicando qué variables faltan

### 5. Desplegar

1. Haz clic en **"Deploy"**
2. Espera a que Vercel construya y despliegue tu aplicación
3. Una vez completado, obtendrás una URL como: `https://smarttrading-backend-xxxxx.vercel.app`

### 6. Verificar el Despliegue

1. Visita la URL de tu backend: `https://tu-backend.vercel.app/`
   - Debería mostrar información del API
2. Prueba el endpoint de health check: `https://tu-backend.vercel.app/api/health`
   - Deberías ver: `{"status":"ok","timestamp":"..."}`

### 7. Ver Logs en Vercel

**IMPORTANTE:** Los logs solo aparecen cuando la función serverless se ejecuta.

Para ver los logs:
1. Ve a **Vercel Dashboard** > Tu proyecto
2. Haz clic en **Deployments**
3. Selecciona el deployment más reciente
4. Haz clic en **Functions** (en la parte superior)
5. Haz clic en `api/index.ts`
6. **Haz un request** a cualquier endpoint (ej: `/api/health` o `/`) para activar la función
7. Los logs aparecerán en tiempo real

**Nota:** Si no ves logs, es porque la función no se ha ejecutado aún. Haz un request primero.

### 8. Actualizar Variables de Entorno con URLs Reales

Después del primer despliegue:

1. Ve a **Settings** > **Environment Variables**
2. Actualiza `APP_URL` con la URL real de tu backend (ej: `https://smarttrading-backend-xxxxx.vercel.app`)
3. Actualiza `FRONTEND_URL` con la URL real de tu frontend
4. Ve a **Deployments** y haz clic en **"Redeploy"** en el último deployment

### 9. Configurar Base de Datos

1. Crea una base de datos MySQL (puedes usar PlanetScale, Railway, o cualquier proveedor)
2. Ejecuta el script `database/schema.sql` para crear las tablas
3. Actualiza las variables de entorno `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` con tus credenciales
4. Haz **Redeploy** para aplicar los cambios

### 10. Crear Usuario Admin

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

### 11. Configuración Post-Despliegue

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

### Error: "Module not found" o "Cannot find module '../src/...'"

**Solución:**
- Vercel con `@vercel/node` debería incluir automáticamente los archivos necesarios basándose en las importaciones
- Verifica que todas las dependencias estén en `package.json`
- Asegúrate de que `npm install` se ejecute correctamente
- Si el error persiste, verifica que el archivo `api/index.ts` esté en la raíz del proyecto
- Asegúrate de que `vercel.json` solo use `builds` o `functions`, no ambos (actualmente usamos solo `builds`)

### Error: "The `functions` property cannot be used in conjunction with the `builds` property"

**Solución:**
- Elimina la propiedad `functions` de `vercel.json` si estás usando `builds`
- O elimina `builds` si prefieres usar solo `functions` (configuración moderna)
- Actualmente el proyecto usa solo `builds` con `@vercel/node`

### Error: "Database connection failed"

- Verifica las variables de entorno de la base de datos
- Asegúrate de que la base de datos permita conexiones desde cualquier IP (0.0.0.0/0) o desde las IPs de Vercel
- Verifica que el puerto 3306 esté abierto
- Si usas PlanetScale, asegúrate de usar la URL de conexión correcta

### Error: "JWT_SECRET is not defined" o "ENCRYPTION_KEY is not defined"

- Asegúrate de haber configurado todas las variables de entorno
- Verifica que las variables estén configuradas para **Production**, **Preview** y **Development**
- Haz clic en **Redeploy** después de agregar nuevas variables

### El endpoint no responde o devuelve 404

- Verifica que el archivo `api/index.ts` esté correctamente configurado
- Revisa los logs en Vercel Dashboard > Deployments > [tu deployment] > Functions
- Asegúrate de que la ruta en `vercel.json` esté correcta: `/(.*)` → `/api`
- Prueba primero el endpoint `/api/health` que no requiere autenticación
- **Importante:** Si accedes a la raíz `/`, debería mostrar información del API. Si ves 404, verifica que la ruta catch-all esté en `vercel.json`

### No aparecen logs en Vercel

**Solución:**
- **Los logs solo aparecen cuando la función serverless se ejecuta**
- Haz un request a cualquier endpoint (ej: `/api/health` o `/`) para activar la función
- Ve a **Deployments** > [tu deployment] > **Functions** > `api/index.ts` para ver los logs
- Si aún no aparecen logs después de hacer un request:
  - Verifica que el handler esté exportando correctamente la función
  - Asegúrate de que el logging esté en el handler de Vercel
  - Verifica que el deployment se haya completado correctamente
  - Intenta hacer un nuevo deployment

### Error de compilación TypeScript en Vercel

- Vercel compila TypeScript automáticamente, pero si hay errores:
  - Verifica que `tsconfig.json` esté correctamente configurado
  - Asegúrate de que todas las importaciones sean correctas
  - Revisa los logs de build en Vercel Dashboard

### Error: "Function exceeded maximum duration"

- Las funciones serverless de Vercel tienen un límite de tiempo (10 segundos en el plan gratuito)
- Si tus operaciones son muy lentas, considera optimizar las consultas a la base de datos
- Verifica que las conexiones a la base de datos se cierren correctamente

## Verificación Final

Después del despliegue, verifica estos endpoints:

- ✅ `GET /` - Debe mostrar información del API
- ✅ `GET /api/health` - Debe responder `{"status":"ok"}`
- ✅ `GET /api/public/stats` - Debe devolver estadísticas públicas
- ✅ `POST /api/auth/login` - Debe funcionar con credenciales válidas

## Notas Importantes

- Las credenciales de NOWPayments se configuran desde el panel de administración, no desde variables de entorno
- El sistema usa funciones serverless de Vercel, por lo que cada request es independiente
- Los logs están disponibles en Vercel Dashboard > Deployments > [tu deployment] > Functions
- **Para ver logs:** Haz un request a cualquier endpoint y luego revisa Functions > `api/index.ts`
- Si la raíz muestra 404, verifica que `vercel.json` tenga la ruta catch-all: `"src": "/(.*)", "dest": "/api"`
