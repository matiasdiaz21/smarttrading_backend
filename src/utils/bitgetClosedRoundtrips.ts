/**
 * Agrupa órdenes Bitget (orders-history) en posiciones cerradas con PnL neto.
 * Misma lógica base que UserController.getPositions (cerradas), sin mapeo a estrategias/trades internos.
 */

/**
 * SmartTrading ENTRY envía clientOid: ST_{userId}_{strategyId}_{webhookTradeId}_{ts}_...
 * Coincide con `trade_id` / alertData.id en webhook_logs y columna trades.trade_id.
 */
export function parseSmartTradingEntryClientOid(clientOid: string | null | undefined): string | null {
  if (clientOid == null || typeof clientOid !== 'string') return null;
  const s = clientOid.trim();
  if (!s.startsWith('ST_')) return null;
  const parts = s.slice(3).split('_');
  if (parts.length < 4) return null;
  const tradeId = parts[2];
  if (!tradeId || tradeId === 'ENTRY') return null;
  return tradeId;
}

export interface BitgetClosedRoundtrip {
  position_id: string;
  symbol: string;
  pos_side: string;
  net_pnl: number;
  total_fees: number;
  gross_pnl: number;
  open_time: string;
  close_time: string;
  open_price: string;
  close_price: string;
  size: string;
  /** Mismo identificador que webhook `alertData.id` / `trade_id` cuando la apertura fue vía SmartTrading */
  linked_webhook_trade_id: string | null;
}

/**
 * @param orders Lista plana de órdenes `entrustedList` de Bitget mix (filled).
 * @param credentialId Solo para IDs únicos en position_id.
 */
export function aggregateClosedRoundtripsFromOrders(
  orders: any[],
  credentialId: number
): BitgetClosedRoundtrip[] {
  const groupedOrders = new Map<string, any[]>();

  orders.forEach((o) => {
    const symbol = o.symbol?.toUpperCase();
    const posSide = o.posSide?.toLowerCase();
    const status = o.status?.toLowerCase();
    if (!symbol || status !== 'filled') return;
    const key = `${symbol}_${posSide || 'net'}`;
    if (!groupedOrders.has(key)) groupedOrders.set(key, []);
    groupedOrders.get(key)!.push(o);
  });

  const closedPositions: BitgetClosedRoundtrip[] = [];

  groupedOrders.forEach((orderList, key) => {
    const parts = key.split('_');
    const posSide = parts[parts.length - 1];
    const symbol = parts.length > 2 ? parts.slice(0, -1).join('_') : parts[0];

    const openOrders = orderList.filter((o: any) => o.tradeSide?.toLowerCase() === 'open');
    const closeOrders = orderList.filter((o: any) => o.tradeSide?.toLowerCase() === 'close');
    if (closeOrders.length === 0) return;

    const positionGroups: any[] = [];
    const usedCloseOrders = new Set<string>();

    openOrders.forEach((openOrder: any) => {
      const openTime = parseInt(openOrder.cTime || openOrder.uTime || '0', 10);

      const relatedCloseOrders = closeOrders.filter((closeOrder: any) => {
        if (usedCloseOrders.has(closeOrder.orderId)) return false;
        const closeTime = parseInt(closeOrder.uTime || closeOrder.cTime || '0', 10);
        return closeTime >= openTime && closeTime <= openTime + 24 * 60 * 60 * 1000;
      });

      if (relatedCloseOrders.length > 0) {
        relatedCloseOrders.forEach((co: any) => usedCloseOrders.add(co.orderId));
        positionGroups.push({
          openOrders: [openOrder],
          closeOrders: relatedCloseOrders,
        });
      }
    });

    positionGroups.forEach((group) => {
      const { openOrders: groupOpenOrders, closeOrders: groupCloseOrders } = group;

      const totalOpenSize = groupOpenOrders.reduce(
        (sum: number, o: any) => sum + parseFloat(o.baseVolume || o.size || '0'),
        0
      );
      const totalCloseSize = groupCloseOrders.reduce(
        (sum: number, o: any) => sum + parseFloat(o.baseVolume || o.size || '0'),
        0
      );

      const openFees = groupOpenOrders.reduce(
        (sum: number, o: any) => sum + Math.abs(parseFloat(o.fee || '0')),
        0
      );
      const closeFees = groupCloseOrders.reduce(
        (sum: number, o: any) => sum + Math.abs(parseFloat(o.fee || '0')),
        0
      );
      const totalFees = openFees + closeFees;

      const openPriceWeighted = groupOpenOrders.reduce((sum: number, o: any) => {
        const price = parseFloat(o.priceAvg || o.price || '0');
        const size = parseFloat(o.baseVolume || o.size || '0');
        return sum + price * size;
      }, 0);
      const openPrice = totalOpenSize > 0 ? openPriceWeighted / totalOpenSize : 0;

      const closePriceWeighted = groupCloseOrders.reduce((sum: number, o: any) => {
        const price = parseFloat(o.priceAvg || o.price || '0');
        const size = parseFloat(o.baseVolume || o.size || '0');
        return sum + price * size;
      }, 0);
      const closePrice = totalCloseSize > 0 ? closePriceWeighted / totalCloseSize : 0;

      const totalProfitsSum = groupCloseOrders.reduce(
        (sum: number, o: any) => sum + parseFloat(o.totalProfits || '0'),
        0
      );

      const sizeForPnl = Math.min(totalOpenSize, totalCloseSize);
      let calculatedPnl = 0;
      if (openPrice > 0 && closePrice > 0 && sizeForPnl > 0) {
        calculatedPnl =
          posSide === 'long'
            ? (closePrice - openPrice) * sizeForPnl
            : (openPrice - closePrice) * sizeForPnl;
      }

      let grossPnl: number;
      if (
        totalProfitsSum !== 0 &&
        calculatedPnl !== 0 &&
        Math.sign(totalProfitsSum) !== Math.sign(calculatedPnl)
      ) {
        grossPnl = calculatedPnl;
      } else if (totalProfitsSum !== 0) {
        grossPnl = totalProfitsSum;
      } else {
        grossPnl = calculatedPnl;
      }

      const netPnl = grossPnl - totalFees;
      const holdSide = groupOpenOrders[0]?.posSide?.toLowerCase() || posSide;

      const entryClientOid = groupOpenOrders[0]?.clientOid ?? groupOpenOrders[0]?.client_oid;
      const linkedWebhookTradeId = parseSmartTradingEntryClientOid(entryClientOid);

      const openTimeMs = parseInt(groupOpenOrders[0]?.cTime || groupOpenOrders[0]?.uTime || '0', 10);
      const closeTimeMs = parseInt(
        groupCloseOrders[groupCloseOrders.length - 1]?.uTime ||
          groupCloseOrders[groupCloseOrders.length - 1]?.cTime ||
          '0',
        10
      );

      closedPositions.push({
        position_id: `${credentialId}_${symbol}_${holdSide}_${openTimeMs}`,
        symbol,
        pos_side: holdSide,
        net_pnl: netPnl,
        total_fees: totalFees,
        gross_pnl: grossPnl,
        open_time: new Date(openTimeMs).toISOString(),
        close_time: new Date(closeTimeMs).toISOString(),
        open_price: openPrice.toString(),
        close_price: closePrice.toString(),
        size: totalOpenSize.toString(),
        linked_webhook_trade_id: linkedWebhookTradeId,
      });
    });
  });

  closedPositions.sort((a, b) => new Date(a.close_time).getTime() - new Date(b.close_time).getTime());
  return closedPositions;
}
