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

## Exchanges (Bitget vs Bybit)

El backend opera actualmente con **Bitget**. Para aperturas con TP parcial (50% + 50%), Bitget requiere varias llamadas: `place-order` (abrir), `place-tpsl-order` (SL), `place-plan-order` x2 (TP parcial y final). Para el caso sin parcial, Bitget permite preset SL/TP en una sola `place-order`.

**Bybit** permite enviar `takeProfit` y `stopLoss` en la misma petición de creación de orden ([Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order)), reduciendo a 1 llamada para abrir con TP/SL único. Para TP parcial seguiría siendo 1 open + órdenes adicionales. Ver `docs/exchanges-comparison.md` para más detalle.

