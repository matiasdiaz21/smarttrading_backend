# SyncTrade Backend

Backend API para el SaaS de Copy Trading en Bitget.

## Configuración

1. Instalar dependencias:
```bash
npm install
```

2. Configurar variables de entorno en `.env`:
```
DATABASE_URL=mysql://user:password@host:port/database
JWT_SECRET=your-secret-key
ENCRYPTION_KEY=your-32-char-encryption-key
BITGET_API_BASE_URL=https://api.bitget.com
NOWPAYMENTS_API_KEY=your-nowpayments-key
NOWPAYMENTS_WEBHOOK_SECRET=your-webhook-secret
```

3. Ejecutar en desarrollo:
```bash
npm run dev
```

## Estructura

- `api/` - Vercel Serverless Functions
- `src/` - Código fuente TypeScript
- `database/` - Esquemas SQL

