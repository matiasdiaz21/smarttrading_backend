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
BYBIT_API_BASE_URL=https://api.bybit.com
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

## Exchanges (Bitget vs Bybit)

El backend soporta **Bitget** y **Bybit**. El usuario elige el exchange por estrategia. Bybit permite abrir con TP/SL en 1 llamada y mover SL a breakeven con 1 llamada (Set Trading Stop). Ver `docs/exchanges-comparison.md` para comparativa de llamadas API. Opcional: `BYBIT_API_BASE_URL` (por defecto `https://api.bybit.com`; testnet: `https://api-testnet.bybit.com`).

