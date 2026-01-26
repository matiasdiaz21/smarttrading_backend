# 🔧 Guía Rápida: Configurar Variables de Entorno en Vercel

## ⚠️ IMPORTANTE

**Las variables de entorno DEBEN estar configuradas directamente en Vercel Dashboard**, NO solo en GitHub Secrets.

- **GitHub Secrets**: Solo se usan para CI/CD (GitHub Actions workflows)
- **Vercel Environment Variables**: Se inyectan en el runtime de tu aplicación

## 📋 Pasos para Configurar

### 1. Acceder a Vercel Dashboard

1. Ve a [Vercel Dashboard](https://vercel.com/dashboard)
2. Inicia sesión con tu cuenta
3. Selecciona tu proyecto: **synctrade-backend**

### 2. Ir a Environment Variables

1. En el menú lateral, haz clic en **Settings**
2. En el submenú, haz clic en **Environment Variables**

### 3. Agregar Variables

Para cada variable, haz clic en **Add New** y completa:

#### Variable 1: DB_HOST
- **Name:** `DB_HOST`
- **Value:** `tu-host-mysql` (ejemplo: `mysql.host.com` o `123.456.789.0`)
- **Environment:** Selecciona las tres opciones:
  - ✅ Production
  - ✅ Preview
  - ✅ Development
- Haz clic en **Save**

#### Variable 2: DB_PORT
- **Name:** `DB_PORT`
- **Value:** `3306`
- **Environment:** Selecciona las tres opciones
- Haz clic en **Save**

#### Variable 3: DB_USER
- **Name:** `DB_USER`
- **Value:** `tu-usuario-mysql` (ejemplo: `root` o `smarttrading_user`)
- **Environment:** Selecciona las tres opciones
- Haz clic en **Save**

#### Variable 4: DB_PASSWORD
- **Name:** `DB_PASSWORD`
- **Value:** `tu-password-mysql` (tu contraseña real)
- **Environment:** Selecciona las tres opciones
- Haz clic en **Save**

#### Variable 5: DB_NAME
- **Name:** `DB_NAME`
- **Value:** `smarttrading` (o el nombre de tu base de datos)
- **Environment:** Selecciona las tres opciones
- Haz clic en **Save**

#### Variable 6: JWT_SECRET
- **Name:** `JWT_SECRET`
- **Value:** `B0p1QMX8aBzrX6WPSWXT9ZkPFGE7iIUKGf2Lk7DNpsNt74OiuuXAULfb1+cE/uNdjVZizG/7nlXPxCfQfkqKFQ==` (o genera uno nuevo)
- **Environment:** Selecciona las tres opciones
- Haz clic en **Save**

#### Variable 7: ENCRYPTION_KEY
- **Name:** `ENCRYPTION_KEY`
- **Value:** `ed2a65c02b15c8c90745ea92c50a9803841dcf6a36c9142d58a455913e1b7f81` (o genera uno nuevo de 32 caracteres)
- **Environment:** Selecciona las tres opciones
- Haz clic en **Save**

#### Variable 8: BITGET_API_BASE_URL
- **Name:** `BITGET_API_BASE_URL`
- **Value:** `https://api.bitget.com`
- **Environment:** Selecciona las tres opciones
- Haz clic en **Save**

#### Variable 9: NODE_ENV
- **Name:** `NODE_ENV`
- **Value:** `production`
- **Environment:** Solo selecciona **Production**
- Haz clic en **Save**

### 4. Verificar Variables Configuradas

Después de agregar todas las variables, deberías ver una lista como esta:

```
✅ DB_HOST (Production, Preview, Development)
✅ DB_PORT (Production, Preview, Development)
✅ DB_USER (Production, Preview, Development)
✅ DB_PASSWORD (Production, Preview, Development)
✅ DB_NAME (Production, Preview, Development)
✅ JWT_SECRET (Production, Preview, Development)
✅ ENCRYPTION_KEY (Production, Preview, Development)
✅ BITGET_API_BASE_URL (Production, Preview, Development)
✅ NODE_ENV (Production)
```

### 5. Hacer Redeploy

**⚠️ CRÍTICO:** Después de agregar las variables, DEBES hacer un redeploy:

1. Ve a **Deployments** en el menú lateral
2. Encuentra el último deployment
3. Haz clic en los **tres puntos (⋯)** a la derecha
4. Selecciona **Redeploy**
5. Confirma el redeploy
6. Espera a que termine el deployment

### 6. Verificar que Funcionó

1. Ve a **Deployments** > [último deployment] > **Functions**
2. Haz clic en `api/index.ts`
3. Haz un request a: `https://synctrade-backend.vercel.app/api/env-check`
4. Deberías ver en los logs:

```
✅ DB_HOST: ✅ configurado
✅ DB_USER: ✅ configurado
✅ DB_PASSWORD: ✅ configurado
✅ DB_NAME: ✅ configurado
```

## 🔍 Verificar Variables con el Endpoint de Diagnóstico

Puedes verificar que las variables estén configuradas accediendo a:

```
https://synctrade-backend.vercel.app/api/env-check
```

Este endpoint mostrará:
- Qué variables están configuradas
- Qué variables faltan
- Instrucciones si algo falta

## ❓ Preguntas Frecuentes

### ¿Por qué no funcionan las variables de GitHub Secrets?

GitHub Secrets solo están disponibles durante la ejecución de GitHub Actions workflows. Vercel necesita sus propias variables de entorno que se inyectan en el runtime de la aplicación serverless.

### ¿Puedo usar las mismas variables en ambos lugares?

Sí, pero debes configurarlas en ambos lugares:
- **GitHub Secrets**: Para CI/CD (builds, tests, etc.)
- **Vercel Environment Variables**: Para el runtime de la aplicación

### ¿Las variables son seguras en Vercel?

Sí, Vercel encripta las variables de entorno y solo están disponibles en el runtime de tu aplicación. No son visibles en el código fuente ni en los logs públicos.

### ¿Necesito hacer redeploy después de agregar variables?

Sí, es necesario hacer redeploy para que las nuevas variables se apliquen al deployment.

## 🆘 Solución de Problemas

### Error: "Variables de entorno faltantes"

1. Verifica que hayas agregado todas las variables en Vercel Dashboard
2. Verifica que hayas seleccionado los ambientes correctos (Production, Preview, Development)
3. Haz clic en **Redeploy** después de agregar las variables
4. Espera a que termine el deployment
5. Verifica los logs en Functions > `api/index.ts`

### Las variables están configuradas pero sigue dando error

1. Verifica que hayas hecho **Redeploy** después de agregar las variables
2. Verifica que las variables estén configuradas para **Production** (no solo Preview o Development)
3. Revisa los logs en Vercel para ver qué variables detecta
4. Usa el endpoint `/api/env-check` para diagnosticar

### No veo las variables en los logs

1. Asegúrate de haber hecho redeploy después de agregar las variables
2. Verifica que estés viendo los logs del deployment más reciente
3. Haz un request a cualquier endpoint para activar la función y ver los logs

