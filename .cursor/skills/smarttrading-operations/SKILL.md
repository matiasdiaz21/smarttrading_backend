---
name: smarttrading-operations
description: >-
  Describes SmartTrading operations: TradingView webhooks, Pine alert JSON contract,
  Express backend routing, webhook_logs, Bitget flow, and admin webhook-logs UI.
  Apply when editing alerts, webhooks, strategies, Pine scripts (especially
  auto_trading_v1.pine), or explaining signal-to-exchange behavior in smarttrading_* repos.
---

# SmartTrading — Modo de operación

## Repositorios

| Área | Ruta típica | Rol |
|------|-------------|-----|
| API y trading | `smarttrading_backend` | Express, MySQL, `WebhookController`, `TradingService`, modelos |
| Portal admin / UI | `smarttrading_frontend` | Next.js, `/admin/webhook-logs`, consumo de API |

Al **añadir o cambiar rutas** del backend, seguir el skill **vercel-route-parity** (`src/server.ts` y `api/index.ts` en paralelo).

## Flujo TradingView → backend

1. En TradingView, la alerta usa **Webhook URL** apuntando a:
   - `{API_BASE}/api/webhooks/tradingview`
   - El front construye la URL base con `getWebhookUrl()` → `getApiUrl()` + `/api/webhooks/tradingview`.

2. **POST** con cuerpo **JSON** (TradingView envía el mensaje configurado en el script Pine).

3. El backend (`WebhookController.tradingView`) exige el campo **`strategy`** (string). Busca la fila en `strategies` por **nombre exacto** (`StrategyModel.findByName`). Si no existe → 404, no se guarda log.

4. **Identificación**: hoy la estrategia se resuelve por **nombre en el JSON**, no por verificación HMAC activa en código (la firma puede guardarse en logs).

5. **`strategies.ignore_breakeven`** (boolean, admin `/admin/strategies`): si es **true**, (a) las alertas **`BREAKEVEN`** no ejecutan `processBreakevenAlert` (respuesta 200 con `ignored: true`, `reason: 'strategy_ignore_breakeven'`); (b) en **ENTRY**, no se usa el precio `breakeven` para triggers parciales en Bitget (`hasBreakeven` forzado a falso), **aunque** el usuario tenga `use_partial_tp` en `user_strategy_subscriptions`. Cambiar el flag con posiciones abiertas no revierte triggers ya colocados; aplica a señales posteriores.

## Contrato JSON (alineado con Pine)

Referencia principal: `auto_trading_v1.pine` — todas las `alert()` comparten la misma forma.

- **`strategy`**: debe coincidir **carácter a carácter** con el nombre en BD. En el Pine actual: `"Auto Trading Estrategy V1"` (incluye el typo *Estrategy*).
- **`symbol`**: `syminfo.ticker`.
- **`side`**: `LONG` / `SHORT` (el backend normaliza a buy/sell).
- **`alertType`**: `ENTRY` | `BREAKEVEN` | `STOP_LOSS` | `TAKE_PROFIT`.
- **`entryPrice`, `stopLoss`, `takeProfit`, `breakeven`**: numéricos según el caso.
- **`timeframe`**: `timeframe.period`.
- **`time`**: milisegundos Unix del cierre de vela (`time_close`) en que se dispara la alerta; correlaciona con webhooks y `alertData.id`.
- **`alertData`**: objeto con al menos **`id`** (trade_id estable para agrupar ENTRY → cierres). ENTRY suele usar `currentPrice` y opcionalmente `mensaje`; cierres suelen usar `precio_actual` y `mensaje`.

Sin `symbol` el webhook responde 400. ENTRY exige además `side`, `entryPrice`, `stopLoss`, `takeProfit`.

## Comportamiento por tipo de alerta (backend)

| `alertType` | Rol típico |
|-------------|------------|
| `ENTRY` | Ejecuta lógica real: `TradingService.processStrategyAlert`. Tras fill, puede mergear en el payload del log `actual_entry_price` y `actual_notional`. |
| `BREAKEVEN` | `processBreakevenAlert` — ajustes de gestión, salvo si la estrategia tiene `ignore_breakeven` (sin llamadas al exchange). |
| `STOP_LOSS`, `TAKE_PROFIT`, `CLOSE` | Tratadas como alertas informativas vía `processInfoAlert` (sin llamadas Bitget en el bloque dedicado del controlador); se crean logs con el resultado. |

Los logs viven en **`webhook_logs`** (`WebhookLogModel`). La UI admin **`/admin/webhook-logs`** agrupa por `symbol` + `alertData.id`, calcula win/loss/pending y simulación; debe mantenerse coherente con los mismos campos del JSON.

## Pine: una sola familia de mensajes

- Script referencia: **`auto_trading_v1.pine`** (`strategy("Auto Trading Estrategy V1", ...)`).
- Otros `.pine` del repo (`nasdaq.pine`, `strategy_ema.pine`, etc.) deben, si comparten el mismo backend, **replicar el mismo contrato** o documentar diferencias; si cambian el string `strategy`, crear o renombrar la estrategia en BD.

## Checklist rápido (nueva alerta o estrategia)

```text
- [ ] Nombre en Pine `strategy` = nombre en tabla `strategies`
- [ ] `alertData.id` presente y estable por trade (para logs y estadísticas)
- [ ] ENTRY con todos los campos requeridos por el backend
- [ ] Tras cambiar rutas API: vercel-route-parity
```

## Archivos clave (backend)

- `src/controllers/webhook.controller.ts` — entrada webhook, creación de logs, ramas por `alertType`.
- `src/services/trading.service.ts` — ejecución y reglas de negocio.
- `src/models/WebhookLog.ts` — persistencia y consultas por trade/símbolo.
- `src/controllers/admin.controller.ts` — listado/borrado de webhook logs (admin).

## Archivos clave (frontend)

- `app/(dashboard)/admin/webhook-logs/page.tsx` — vista de operaciones, stats, simulación.
- `components/admin/StrategyManager.tsx` — CRUD estrategias; incluye `ignore_breakeven`.
- `lib/config.ts` — `getWebhookUrl()` / `getApiUrl()`.
