# Comparativa de exchanges para trading (Bitget vs Bybit)

Objetivo: reducir número de endpoints y complejidad al abrir posiciones con Stop Loss y Take Profit.

## Bitget (actual)

- **Apertura con TP parcial (50% + 50%)**: Mínimo 4 llamadas por operación:
  1. `POST /api/v2/mix/order/place-order` – abrir posición (sin preset cuando hay TP parcial)
  2. `POST /api/v2/mix/order/place-tpsl-order` – SL (pos_loss)
  3. `POST /api/v2/mix/order/place-plan-order` – TP parcial (normal_plan)
  4. `POST /api/v2/mix/order/place-plan-order` – TP final (normal_plan)

- **Apertura sin TP parcial**: 1 llamada con `presetStopLossPrice` y `presetStopSurplusPrice` en `place-order`.

- **Cierre**: `GET` posiciones + `place-order` (close) + cancelación de plan orders.

## Bybit (V5)

- **Apertura con TP/SL único**: 1 llamada; se envían `takeProfit` y `stopLoss` en la misma petición [Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order).

- **TP/SL sobre posición ya abierta**: 1 endpoint [Set Trading Stop](https://bybit-exchange.github.io/docs/v5/position/trading-stop).

- **TP parcial (50% + 50%)**: Sigue requiriendo órdenes adicionales o lógica por encima; ningún exchange ofrece “un solo click” estándar para parciales.

## Binance Futures

- TP/SL suelen requerir órdenes separadas (STOP_MARKET / TAKE_PROFIT_MARKET). No mejora en número de llamadas respecto a Bitget para este flujo.

## Conclusión

**Bybit** es la opción que mejor reduce endpoints para el caso “abrir + SL + TP único” (1 llamada). Para TP parcial, tanto Bitget como Bybit requieren varias llamadas; la mejora principal sería usar Bybit para el caso simple.
