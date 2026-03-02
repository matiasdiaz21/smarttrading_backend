# Flujo de alertas TradingView y operaciones Bitget

## Resumen de tipos de alerta

| alertType   | Origen (TradingView) | Acción en backend |
|------------|----------------------|-------------------|
| **ENTRY**  | Señal de entrada     | Abrir posición + SL + TPs (50% BE + 50% final si hay breakeven). |
| **BREAKEVEN** | Precio llegó a breakeven | Mover SL al precio de entrada (no cerrar 50%, no tocar TPs). |
| **STOP_LOSS** / **TAKE_PROFIT** / **CLOSE** | Cierre (real o informativo) | Cerrar posición en exchange y cancelar todos los triggers (SL + TPs). |
| **STOP_LOSS** / **TAKE_PROFIT** (solo informativo) | Si caen en el “default” del webhook | Solo se registra como informativo (processInfoAlert), no se ejecutan órdenes. |

---

## 1. ENTRY

- **Webhook:** `alertType === 'ENTRY'` → `tradingService.processStrategyAlert(strategyId, alert)`.
- **Validación:** Requiere `side`, `entryPrice`, `stopLoss`, `takeProfit`.
- **Flujo en TradingService:**
  - Obtiene suscripciones activas a la estrategia.
  - Por cada usuario: `executeTradeForUser()`:
    - Verifica suscripción, leverage, credencial, símbolo permitido.
    - Calcula tamaño (position_size personalizado, minTradeUSDT, o alert.size).
    - Si hay posición abierta en el mismo símbolo/lado → no abre otra; puede configurar TP/SL sobre la existente.
    - Si no hay posición:
      - **Cancelar todos los triggers** del símbolo en Bitget (obligatorio).
      - Si la estrategia tiene `stopLoss` y `takeProfit`:
        - **Bitget:** `bitgetService.openPositionWithFullTPSL()`:
          - Si hay **breakeven** (TP parcial): orden **limit** a `entryPrice`, luego:
            - Esperar hasta 60 s a que se llene; si no, **fallback:** cancelar limit + abrir con **market**.
            - Colocar **SL:** `place-tpsl-order` con `planType: pos_loss`.
            - Colocar **TP 50% (breakeven):** `place-plan-order` con `planType: normal_plan` (trigger al precio de breakeven).
            - Colocar **TP 50% (final):** `place-plan-order` con `planType: normal_plan` (trigger al takeProfit).
          - Si no hay TP parcial: una sola `place-order` con `presetStopLossPrice` y `presetStopSurplusPrice`.
        - **Bybit:** análogo con `bybitService.openPositionWithFullTPSL()`.
      - Registrar trade en DB (trades table).
- **Apertura en Bitget (resumen):**
  - **Orden de apertura:** `POST /api/v2/mix/order/place-order` (limit o market, `tradeSide: open`).
  - **Stop Loss:** `POST /api/v2/mix/order/place-tpsl-order` con `planType: pos_loss`, `triggerType: fill_price`.
  - **Take Profits (parcial + final):** `POST /api/v2/mix/order/place-plan-order` con `planType: normal_plan`, `triggerType: fill_price`, tamaños 50% cada uno (respetando `minTradeNum` del contrato).

---

## 2. BREAKEVEN

- **Webhook:** Actualmente **no había rama explícita**; se trataba como “default” y podía ejecutarse como ENTRY. **Corrección:** se añade rama `alertType === 'BREAKEVEN'` → `tradingService.processBreakevenAlert(strategyId, alert)`.
- **Flujo en TradingService.processBreakevenAlert:**
  - Por cada suscriptor: verificar ENTRY previo (por `trade_id` o por último ENTRY del símbolo).
  - Obtener posición actual en Bitget/Bybit para el símbolo y lado.
  - Si no hay posición abierta: se considera OK (posición ya cerrada por TP/SL) y se actualiza SL en DB si aplica.
  - Si hay posición: **solo mover el SL al precio de entrada:**
    - **Bitget:** `bitgetService.moveStopLossToBreakeven()`:
      - Cancelar órdenes **pos_loss** (SL actual) vía `cancel-plan-order`.
      - Colocar nuevo SL con `place-tpsl-order` (planType: pos_loss) al precio de entrada.
    - No se cancelan ni se modifican los TPs (normal_plan); los triggers 50% BE + 50% final ya están puestos en el ENTRY.

---

## 3. STOP_LOSS / TAKE_PROFIT / CLOSE (solo informativos; sin llamadas a Bitget)

- **Webhook:** `alertType` en `['CLOSE','STOP_LOSS','TAKE_PROFIT']` → `tradingService.processInfoAlert(strategyId, alert)`.
- **Requisito:** `symbol` obligatorio.
- **No se hacen llamadas a Bitget.** El SL y el TP ya se configuraron en el **ENTRY** (y se ajustó el SL en **BREAKEVEN** si aplica). Cuando el precio llega a TP o SL, **Bitget ejecuta el trigger** que colocamos; la posición ya está cerrada en el exchange cuando TradingView envía esta alerta. Por tanto estas alertas son solo **informativas** (trazabilidad, estadísticas, historial).
- **Flujo:** Por cada suscriptor se comprueba si existe ENTRY previo (por `trade_id` o símbolo); si existe, se registra la alerta y se crea `webhook_log` para trazabilidad. No se llama a `closePositionAndCancelTriggers` ni a ningún otro endpoint de Bitget.

---

## 4. STOP_LOSS / TAKE_PROFIT (default: mismo tratamiento informativo)

- Si la alerta llega por la rama **default** del webhook (p. ej. tipo no reconocido en el primer if/else), y el tipo es TAKE_PROFIT o STOP_LOSS:
  - Se comprueba si existe ENTRY previo (por `trade_id` o símbolo).
  - Si existe: `processInfoAlert()` → solo se registra como informativo, **no se ejecutan órdenes**.
  - Si no existe: se ignora la alerta.
- Es el mismo criterio que el punto 3: no gestionar cierres en Bitget; solo registrar. La diferencia es que aquí la alerta “cayó” en el default (p. ej. llega antes o en otro orden); el comportamiento es el mismo.

---

## Diferencia entre TP parcial y TP final (por qué puede quedar posición abierta)

- **TP parcial (breakeven):** trigger al precio de breakeven; tamaño = **mitad** de la posición redondeada al múltiplo del contrato (`calculateOrderSize(totalSize/2)`). Ej.: 99.91 → 49.96.
- **TP final:** trigger al precio de take profit; antes se usaba **la misma mitad** (49.96). Entonces: el parcial cerraba 49.96, quedaban 49.95 en posición, y el final intentaba cerrar 49.96 → solo se cerraban 49.95 y podía quedar **resto abierto** (o el exchange cerraba 49.95 y dejaba 0.01).
- **Corrección:** el TP final ahora usa el **resto** de la posición: `remainderSizeStr = totalSize - halfSize` redondeado hacia abajo (`calculateOrderSizeFloor`). Así, parcial (49.96) + final (49.95) = 99.91 = totalSize y la posición se cierra al 100%.

---

## Errores Bitget vistos en logs y comportamiento

| Código | Mensaje | Causa | Comportamiento actual / recomendación |
|--------|---------|--------|----------------------------------------|
| **22002** | No position to close | Se envió cierre (market reduceOnly) pero no hay posición (ya cerrada por SL/TP o manual). | En `placeOrder` se trata como éxito y se devuelve `orderId: 'N/A'`. En `closePositionAndCancelTriggers` si aun así se lanzara error, se captura y se sigue con la cancelación de triggers. Considerar **siempre** continuar y cancelar triggers cuando 22002. |
| **43070** | Min. order amount | Tamaño de una orden (p. ej. TP parcial/final) por debajo del mínimo del contrato (por cantidad o notional). | En `openPositionWithFullTPSL` ya hay fallback: si no se puede hacer 50/50 (`canDoPartial`), se usa preset SL+TP único. Si place-plan-order devuelve 43070, se intenta con tamaño ajustado (`minTradeNum`). Para contratos con muchas decimales (p. ej. PEPE) revisar que `volumePlace` y el cálculo de `halfSize` no redondeen mal (p. ej. 145 en vez de 1450). |
| **43059** | Request failed, please try again | Error transitorio de Bitget (p. ej. al cancelar un trigger). | Considerar reintento ligero o ignorar si la cancelación no es crítica (p. ej. el trigger ya no existía). |
| **40812** | The condition planType is not met | Se usaba `planType=pos_loss` o `pos_profit` en **GET** orders-plan-pending; la API solo acepta `normal_plan`, `track_plan`, `profit_loss`. | Corregido: en `getPendingTriggerOrders` se usa `profit_loss` en la petición y se filtra por `planType` en memoria. |

---

## Endpoints Bitget usados

- **Apertura:** `POST /api/v2/mix/order/place-order` (open, limit o market).
- **Cierre:** `POST /api/v2/mix/order/place-order` (close, market, reduceOnly: YES).
- **Cancelar orden abierta:** `POST /api/v2/mix/order/cancel-order` (orderId, symbol, productType, marginCoin).
- **SL (pos_loss):** `POST /api/v2/mix/order/place-tpsl-order` (planType: pos_loss).
- **TPs (normal_plan):** `POST /api/v2/mix/order/place-plan-order` (planType: normal_plan). El **TP parcial** usa tamaño = 50% redondeado al múltiplo del contrato. El **TP final** usa tamaño = **resto** (totalSize − TP parcial) redondeado hacia abajo, para que parcial + final = totalSize y no quede posición abierta por redondeo.
- **Cancelar triggers:** `POST /api/v2/mix/order/cancel-plan-order` (por orderId o batch).
- **Listar triggers pendientes:** `GET /api/v2/mix/order/orders-plan-pending` con `planType` en `normal_plan` | `track_plan` | `profit_loss` (nunca pos_loss/pos_profit en la URL).

---

## Despliegue

- Asegurar que la versión con:
  - Fix **getPendingTriggerOrders** (planType),
  - **Fallback limit → market** en openPositionWithFullTPSL,
  - Rama **BREAKEVEN** en el webhook,
  esté desplegada para que producción refleje este flujo y se reduzcan 40812, timeouts y BREAKEVEN mal tratado.
