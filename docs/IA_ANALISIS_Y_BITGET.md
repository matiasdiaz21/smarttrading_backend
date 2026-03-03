# Análisis IA y datos de mercado (Bitget)

## Fuente de datos actual: Bitget

El análisis de IA (predicciones en `/admin/ai-config`) obtiene **velas y precio** únicamente de la API pública de **Bitget**:

- **Velas:** `GET /api/v2/mix/market/candles` (productType: USDT-FUTURES, USDC-FUTURES o COIN-FUTURES).
- **Precio:** `GET /api/v2/mix/market/ticker`.

Referencia: [Bitget API](https://www.bitget.com/zh-CN/api-doc), categorías soportadas en documentación: `SPOT`, `USDT-FUTURES`, `USDC-FUTURES`, `COIN-FUTURES`, `MARGIN`.

---

## Limitación: Bitget no tiene forex ni tradFi

**Bitget es un exchange de cripto.** No lista pares de forex (AUD/USD, GBP/JPY, EUR/USD, etc.) ni otros activos tradicionales (acciones, índices). Solo ofrece:

- **Spot:** pares crypto (BTCUSDT, ETHUSDT, etc.).
- **Futuros (mix):** USDT-FUTURES, USDC-FUTURES, COIN-FUTURES (todos con base en cripto).
- **Margin:** pares crypto con apalancamiento.

Por tanto:

- Activos con **categoría forex** (p. ej. AUD/USD, GBP/JPY) **no pueden analizarse** con la fuente actual: al pedir velas o ticker a Bitget con ese símbolo, la API responde **400** (símbolo no existente).
- En el backend, los activos **forex** se detectan (por `asset.category === 'forex'` o por el formato del símbolo) y **no se llama** a Bitget; se devuelve un error controlado para que en la UI aparezca un mensaje claro en lugar de "Request failed with status code 400".

---

## Qué hacer con activos forex en la lista

1. **Deshabilitar** los activos forex (AUD/USD, GBP/JPY) en Activos de IA si no tenéis otra fuente de datos: así no se intenta analizarlos y no aparecen errores.
2. **Mantenerlos** si en el futuro se integra un proveedor de datos forex (Twelve Data, Alpha Vantage, Finnhub, OANDA, etc.): entonces el backend podría usar ese proveedor solo cuando `category === 'forex'` para velas y precio, y seguir usando Bitget para crypto y commodities listados en Bitget.

No es necesario **cambiar el tipo de asset** en la base de datos: la categoría `forex` es correcta. Lo que no existe es la fuente de datos para ese tipo en Bitget.

---

## Resumen

| Categoría     | ¿Bitget tiene datos? | Acción actual                          |
|---------------|----------------------|----------------------------------------|
| **crypto**    | Sí (spot/mix)        | Análisis con velas y precio Bitget.   |
| **commodities** | Sí si está listado (ej. XAUUSDT, XAGUSDT) | Análisis con Bitget.              |
| **forex**     | No                   | Error controlado; no se llama a Bitget. |

Si en la vista `/admin/ai-config` ves "Request failed with status code 400" para AUD/USD o GBP/JPY, asegúrate de tener desplegada la versión del backend que incluye la comprobación de forex y la normalización del error 400 (mensaje: "Bitget no ofrece datos para pares forex...").
