# Comparativa de exchanges para trading (Bitget vs Bybit)

Objetivo: reducir número de endpoints y complejidad al abrir posiciones con Stop Loss y Take Profit.

**Estado:** La plataforma soporta **Bitget** y **Bybit**. El usuario elige el exchange por estrategia y asocia credenciales de Bitget o Bybit.

## Bitget (soportado)

- **Apertura con TP parcial (50% + 50%)**: Mínimo 4 llamadas por operación:
  1. `POST /api/v2/mix/order/place-order` – abrir posición (sin preset cuando hay TP parcial)
  2. `POST /api/v2/mix/order/place-tpsl-order` – SL (pos_loss)
  3. `POST /api/v2/mix/order/place-plan-order` – TP parcial (normal_plan)
  4. `POST /api/v2/mix/order/place-plan-order` – TP final (normal_plan)

- **Apertura sin TP parcial**: 1 llamada con `presetStopLossPrice` y `presetStopSurplusPrice` en `place-order`.

- **Breakeven (mover SL a entrada)**: Varias llamadas (cancelar SL, colocar nuevo SL).

- **Cierre**: `GET` posiciones + `place-order` (close) + cancelación de plan orders.

## Bybit (soportado)

- **Apertura con TP/SL único**: 1 llamada; se envían `takeProfit` y `stopLoss` en la misma petición [Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order).

- **TP/SL sobre posición ya abierta / Breakeven**: 1 endpoint [Set Trading Stop](https://bybit-exchange.github.io/docs/v5/position/trading-stop) para mover SL al precio de entrada.

- **TP parcial (50% BE + 50% final)**: Abrir con TP/SL full en 1 llamada; al llegar BREAKEVEN, 1 llamada a Set Trading Stop. Para 2 TPs parciales idénticos a Bitget, lógica adicional (fase 2).

- **Cierre**: `GET /v5/position/list` + orden market reduce-only + `POST /v5/order/cancel-all` (StopOrder).

### Configuración Bybit

- Variable de entorno opcional: `BYBIT_API_BASE_URL` (por defecto `https://api.bybit.com`). Para testnet: `https://api-testnet.bybit.com`.

## Binance Futures

- TP/SL suelen requerir órdenes separadas (STOP_MARKET / TAKE_PROFIT_MARKET). No soportado en esta plataforma.

## Resumen por flujo

| Flujo | Bitget | Bybit |
|-------|--------|--------|
| Abrir + SL + TP (full) | 1 (place-order con preset) | 1 (place order con takeProfit + stopLoss) |
| Abrir + TP parcial (50%+50%) | 4 | 1 abrir + 1 Set Trading Stop en breakeven |
| Breakeven (mover SL a entrada) | Varias | 1 (Set Trading Stop) |
| Cierre | getPositions + place-order + cancel triggers | get position + close + cancel-all StopOrder |
