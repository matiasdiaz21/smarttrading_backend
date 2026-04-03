import { Request, Response } from 'express';
import { WebhookLogModel } from '../models/WebhookLog';
import { AppSettingsModel } from '../models/AppSettings';

interface ParsedPayload {
  symbol?: string;
  alertData?: { id?: string | number };
  trade_id?: string | number;
  alertType?: string;
  alert_type?: string;
  side?: string;
}

interface TradeInfo {
  tradeId: string;
  symbol: string;
  side: string;
  alertTypes: string[];
  status: 'won' | 'lost' | 'pending';
}

/** Rentabilidad agregada en múltiplos R (riesgo por trade) para el landing */
interface ProfitabilityPublic {
  /** Media de R en trades cerrados con precios ENTRY válidos */
  avgRPerTrade: number | null;
  /** Suma de R (trades con estimación) */
  totalR: number;
  /** Suma R ganadores / |suma R perdedores| */
  profitFactor: number | null;
  tradesWithR: number;
  /** ENTRY sin precios suficientes para estimar R */
  tradesSkippedNoPrices: number;
  /**
   * Retorno acumulado ilustrativo (%): si arriesgas 1% del capital por operación,
   * suma simple de (R × 1%) ≈ este % sobre la cuenta inicial (no compuesto).
   */
  illustrativeReturnPct: number | null;
  /**
   * Cierres del más reciente al más antiguo. `won` coincide con el winrate del resumen.
   * `r` null = cierre sin estimación R (no entra en ΣR ni profit factor).
   * `closedAt` = ISO 8601 del último log del cierre (referencia temporal en el landing).
   */
  recentClosedTradesDesc: Array<{ r: number | null; won: boolean; closedAt: string }>;
  recentRsTruncated: boolean;
}

interface SymbolStats {
  won: number;
  lost: number;
  pending: number;
  winrate: number;
  total: number;
}

export class StatsController {
  // Obtener estadísticas públicas para el landing page
  static async getPublicStats(req: Request, res: Response) {
    try {
      // Obtener estrategias configuradas para estadísticas públicas
      const settings = await AppSettingsModel.get();
      const statsStrategyIds = settings.stats_strategy_ids;

      // Si hay estrategias configuradas, filtrar logs por ellas; si no, obtener todos
      const logs = statsStrategyIds && statsStrategyIds.length > 0
        ? await WebhookLogModel.findByStrategyIds(statsStrategyIds)
        : await WebhookLogModel.findAll();

      // Agrupar logs por símbolo y trade ID
      const { groupedBySymbol } = StatsController.groupLogsBySymbolAndTradeId(logs);

      // Calcular estadísticas por símbolo
      const symbolStats = StatsController.getSymbolStats(groupedBySymbol);

      // Obtener top símbolos por winrate (mínimo 3 trades cerrados)
      const topSymbols = Object.keys(symbolStats)
        .filter(symbol => {
          const stats = symbolStats[symbol];
          const closedTrades = stats.won + stats.lost;
          return closedTrades >= 3; // Mínimo 3 trades cerrados para aparecer
        })
        .sort((a, b) => {
          // Ordenar por winrate (mayor primero)
          if (symbolStats[b].winrate !== symbolStats[a].winrate) {
            return symbolStats[b].winrate - symbolStats[a].winrate;
          }
          // Si tienen el mismo winrate, ordenar por total de trades
          return symbolStats[b].total - symbolStats[a].total;
        })
        .slice(0, 10) // Top 10 símbolos
        .map(symbol => ({
          symbol,
          ...symbolStats[symbol],
        }));

      // Obtener mejores trades (trades ganados recientes)
      const bestTrades = StatsController.getBestTrades(groupedBySymbol, symbolStats).slice(0, 5);

      // Estadísticas generales
      const totalWon = Object.values(symbolStats).reduce((sum, stats) => sum + stats.won, 0);
      const totalLost = Object.values(symbolStats).reduce((sum, stats) => sum + stats.lost, 0);
      const totalPending = Object.values(symbolStats).reduce((sum, stats) => sum + stats.pending, 0);
      const totalTrades = totalWon + totalLost; // Solo trades cerrados (para winrate)
      const totalOperations = totalWon + totalLost + totalPending; // Incluye pendientes
      const overallWinrate = totalWon + totalLost > 0
        ? (totalWon / (totalWon + totalLost)) * 100
        : 0;

      // Obtener lista de todas las monedas únicas
      const allSymbols = Object.keys(groupedBySymbol)
        .filter(symbol => symbol !== 'N/A')
        .sort();

      const profitability = StatsController.computeProfitabilityStats(groupedBySymbol);

      res.json({
        success: true,
        data: {
          topSymbols,
          bestTrades,
          allSymbols,
          overallStats: {
            totalTrades,
            totalWon,
            totalLost,
            totalPending,
            totalOperations,
            totalAlerts: logs.length,
            totalSymbols: allSymbols.length,
            overallWinrate: parseFloat(overallWinrate.toFixed(2)),
          },
          profitability,
        },
      });
    } catch (error: any) {
      console.error('[StatsController] Error obteniendo estadísticas públicas:', error);
      res.status(500).json({
        success: false,
        error: 'Error al obtener estadísticas',
      });
    }
  }

  static parsePayload(payload: string): ParsedPayload {
    try {
      return JSON.parse(payload);
    } catch {
      return {};
    }
  }

  /**
   * Un mismo `trade_id` puede repetirse en Pine (varias operaciones). Cada ciclo cerrado =
   * último ENTRY antes de un STOP_LOSS/TAKE_PROFIT, hasta ese cierre (inclusive).
   * Alineado con la sim admin (`getClosedTradesChronological` en frontend).
   */
  static segmentIntoClosedLifecycles(logs: any[]): { closed: any[][]; pendingTail: any[] | null } {
    const sorted = [...logs].sort(
      (a, b) => new Date(a.processed_at).getTime() - new Date(b.processed_at).getTime()
    );
    const closed: any[][] = [];
    let cur: any[] | null = null;
    for (const log of sorted) {
      const p = StatsController.parsePayload(log.payload);
      const t = String(p?.alertType || p?.alert_type || '').toUpperCase();
      if (t === 'ENTRY') {
        cur = [log];
        continue;
      }
      if (!cur) continue;
      cur.push(log);
      if (t === 'STOP_LOSS' || t === 'TAKE_PROFIT') {
        closed.push(cur);
        cur = null;
      }
    }
    return { closed, pendingTail: cur };
  }

  static groupLogsBySymbolAndTradeId(logs: any[]) {
    const groupedBySymbol: { [symbol: string]: { [tradeId: string]: any[] } } = {};

    logs.forEach((log) => {
      const payload = StatsController.parsePayload(log.payload);
      const symbol = payload?.symbol || 'N/A';
      const tradeId = payload?.alertData?.id || payload?.trade_id;

      // Solo procesar si hay símbolo y trade_id válidos
      if (!symbol || symbol === 'N/A' || !tradeId || tradeId === 'N/A') {
        return;
      }

      if (!groupedBySymbol[symbol]) {
        groupedBySymbol[symbol] = {};
      }

      const tradeIdStr = String(tradeId);
      if (!groupedBySymbol[symbol][tradeIdStr]) {
        groupedBySymbol[symbol][tradeIdStr] = [];
      }
      groupedBySymbol[symbol][tradeIdStr].push(log);
    });

    // Ordenar logs dentro de cada trade_id por fecha más reciente
    Object.keys(groupedBySymbol).forEach(symbol => {
      Object.keys(groupedBySymbol[symbol]).forEach(tradeId => {
        groupedBySymbol[symbol][tradeId].sort((a, b) => {
          const dateA = new Date(a.processed_at).getTime();
          const dateB = new Date(b.processed_at).getTime();
          return dateB - dateA; // Más reciente primero
        });
      });
    });

    return { groupedBySymbol };
  }

  static getTradeIdInfo(logs: any[]): TradeInfo {
    if (logs.length === 0) {
      return { tradeId: 'N/A', symbol: 'N/A', side: 'N/A', alertTypes: [], status: 'pending' };
    }

    const firstLog = logs[0];
    const payload = StatsController.parsePayload(firstLog.payload);
    const tradeId = payload?.alertData?.id || payload?.trade_id || 'N/A';
    const symbol = payload?.symbol || 'N/A';
    const side = payload?.side || 'N/A';
    const alertTypes = logs.map(log => {
      const p = StatsController.parsePayload(log.payload);
      const raw = p?.alertType || p?.alert_type || 'UNKNOWN';
      return typeof raw === 'string' ? raw.toUpperCase() : 'UNKNOWN';
    });

    // Determinar estado del trade según la lógica de negocio:
    // 1. Si llega a BREAKEVEN y luego a STOP_LOSS → 'won' (se tomó ganancia del 50% en breakeven)
    // 2. Si va directamente de ENTRY a STOP_LOSS (sin BREAKEVEN) → 'lost'
    // 3. Si tiene TAKE_PROFIT → 'won'
    // 4. Si tiene BREAKEVEN (aunque no tenga STOP_LOSS aún) → 'won'
    let status: 'won' | 'lost' | 'pending' = 'pending';
    const uniqueAlertTypes = [...new Set(alertTypes)];
    
    // Verificar si tiene TAKE_PROFIT → siempre ganado
    if (uniqueAlertTypes.includes('TAKE_PROFIT')) {
      status = 'won';
    }
    // Verificar si tiene BREAKEVEN → ganado (incluso si luego tiene STOP_LOSS)
    else if (uniqueAlertTypes.includes('BREAKEVEN')) {
      status = 'won';
    }
    // Verificar si tiene STOP_LOSS pero NO tiene BREAKEVEN → perdido
    else if (uniqueAlertTypes.includes('STOP_LOSS')) {
      status = 'lost';
    }

    return {
      tradeId: String(tradeId),
      symbol: String(symbol),
      side: String(side),
      alertTypes: uniqueAlertTypes,
      status,
    };
  }

  static numFromPayload(p: any, ...keys: string[]): number | null {
    for (const k of keys) {
      const v = (p as any)?.[k];
      if (v != null && v !== '') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  }

  /**
   * Precios del trade desde el alert ENTRY (misma convención que Pine: entryPrice, stopLoss, takeProfit).
   */
  static extractEntryPricesFromLogs(logs: any[]): {
    entry: number;
    stop: number;
    tp: number | null;
    risk: number;
    isLong: boolean;
  } | null {
    const sorted = [...logs].sort(
      (a, b) => new Date(a.processed_at).getTime() - new Date(b.processed_at).getTime()
    );
    for (const log of sorted) {
      const p = StatsController.parsePayload(log.payload) as ParsedPayload & Record<string, unknown>;
      const rawType = (p?.alertType || p?.alert_type || '') as string;
      if (String(rawType).toUpperCase() !== 'ENTRY') continue;
      const entry = StatsController.numFromPayload(p, 'entryPrice', 'entry_price');
      const stop = StatsController.numFromPayload(p, 'stopLoss', 'stop_loss');
      const tp = StatsController.numFromPayload(p, 'takeProfit', 'take_profit');
      const side = String(p?.side || '').toUpperCase();
      const isLong = side === 'LONG' || side === 'BUY';
      if (entry == null || stop == null) continue;
      const risk = isLong ? Math.abs(entry - stop) : Math.abs(stop - entry);
      if (risk <= 0) continue;
      return { entry, stop, tp: tp ?? null, risk, isLong };
    }
    return null;
  }

  /**
   * Estimación de R por trade cerrado: riesgo = |entrada − stop| en el ENTRY.
   * TP: R = |TP − entrada| / riesgo; SL sin BE: −1; BE+SL sin TP: 0 R (conservador).
   */
  static estimateTradeR(logs: any[], info: TradeInfo): number | null {
    if (info.status === 'pending') return null;
    const prices = StatsController.extractEntryPricesFromLogs(logs);
    if (!prices || prices.risk <= 0) return null;

    const types = info.alertTypes.map((t) => String(t).toUpperCase());
    const hasTP = types.includes('TAKE_PROFIT');
    const hasBE = types.includes('BREAKEVEN');
    const hasSL = types.includes('STOP_LOSS');

    if (info.status === 'lost') {
      return -1;
    }

    if (hasTP && prices.tp != null && Number.isFinite(prices.tp)) {
      if (prices.isLong) {
        const rr = (prices.tp - prices.entry) / prices.risk;
        return Number.isFinite(rr) ? rr : null;
      }
      const rr = (prices.entry - prices.tp) / prices.risk;
      return Number.isFinite(rr) ? rr : null;
    }
    if (hasBE && hasSL && !hasTP) {
      return 0;
    }
    if (hasBE && !hasTP) {
      return 0.5;
    }
    return 0;
  }

  private static readonly RECENT_R_CAP = 1000;

  static computeProfitabilityStats(
    groupedBySymbol: { [symbol: string]: { [tradeId: string]: any[] } }
  ): ProfitabilityPublic {
    let totalR = 0;
    let tradesWithR = 0;
    let tradesSkippedNoPrices = 0;
    let sumPositiveR = 0;
    let sumAbsNegativeR = 0;

    const withTime: { r: number | null; won: boolean; closedAtMs: number }[] = [];

    Object.keys(groupedBySymbol).forEach((symbol) => {
      Object.keys(groupedBySymbol[symbol]).forEach((tradeId) => {
        const tradeLogs = groupedBySymbol[symbol][tradeId];
        const { closed: lifecycles } = StatsController.segmentIntoClosedLifecycles(tradeLogs);

        const pushOne = (seg: any[]) => {
          const info = StatsController.getTradeIdInfo(seg);
          if (info.status === 'pending') return;
          const won = info.status === 'won';
          const r = StatsController.estimateTradeR(seg, info);
          const closedAtMs =
            seg.length > 0
              ? Math.max(...seg.map((l: { processed_at: string }) => new Date(l.processed_at).getTime()))
              : 0;
          if (r === null) {
            tradesSkippedNoPrices += 1;
            withTime.push({ r: null, won, closedAtMs });
            return;
          }
          tradesWithR += 1;
          totalR += r;
          if (r > 0) sumPositiveR += r;
          if (r < 0) sumAbsNegativeR += Math.abs(r);
          withTime.push({ r: parseFloat(r.toFixed(4)), won, closedAtMs });
        };

        for (const seg of lifecycles) {
          pushOne(seg);
        }
        if (lifecycles.length === 0 && tradeLogs.length > 0) {
          const info = StatsController.getTradeIdInfo(tradeLogs);
          if (info.status !== 'pending') {
            pushOne(tradeLogs);
          }
        }
      });
    });

    withTime.sort((a, b) => b.closedAtMs - a.closedAtMs);
    const cap = StatsController.RECENT_R_CAP;
    const recentClosedTradesDesc = withTime.slice(0, cap).map(({ r, won, closedAtMs }) => ({
      r,
      won,
      closedAt: new Date(closedAtMs).toISOString(),
    }));
    const recentRsTruncated = withTime.length > cap;

    const avgRPerTrade = tradesWithR > 0 ? totalR / tradesWithR : null;
    const profitFactor =
      sumAbsNegativeR > 0 ? sumPositiveR / sumAbsNegativeR : sumPositiveR > 0 ? null : null;
    const illustrativeReturnPct =
      tradesWithR > 0 ? parseFloat((totalR * 1).toFixed(2)) : null;

    return {
      avgRPerTrade: avgRPerTrade != null ? parseFloat(avgRPerTrade.toFixed(3)) : null,
      totalR: parseFloat(totalR.toFixed(3)),
      profitFactor: profitFactor != null ? parseFloat(profitFactor.toFixed(2)) : null,
      tradesWithR,
      tradesSkippedNoPrices,
      illustrativeReturnPct,
      recentClosedTradesDesc,
      recentRsTruncated,
    };
  }

  static getSymbolStats(
    groupedBySymbol: { [symbol: string]: { [tradeId: string]: any[] } }
  ): { [symbol: string]: SymbolStats } {
    const stats: { [symbol: string]: SymbolStats } = {};

    Object.keys(groupedBySymbol).forEach(symbol => {
      stats[symbol] = { won: 0, lost: 0, pending: 0, winrate: 0, total: 0 };

      Object.keys(groupedBySymbol[symbol]).forEach(tradeId => {
        const tradeLogs = groupedBySymbol[symbol][tradeId];
        const { closed: lifecycles, pendingTail } = StatsController.segmentIntoClosedLifecycles(tradeLogs);
        for (const seg of lifecycles) {
          const info = StatsController.getTradeIdInfo(seg);
          stats[symbol][info.status]++;
          stats[symbol].total++;
        }
        if (pendingTail && pendingTail.length > 0) {
          const info = StatsController.getTradeIdInfo(pendingTail);
          if (info.status === 'pending') {
            stats[symbol].pending++;
            stats[symbol].total++;
          }
        }
        if (lifecycles.length === 0 && (!pendingTail || pendingTail.length === 0) && tradeLogs.length > 0) {
          const info = StatsController.getTradeIdInfo(tradeLogs);
          stats[symbol][info.status]++;
          stats[symbol].total++;
        }
      });

      // Calcular winrate (solo basado en trades cerrados: won + lost)
      const closedTrades = stats[symbol].won + stats[symbol].lost;
      if (closedTrades > 0) {
        stats[symbol].winrate = (stats[symbol].won / closedTrades) * 100;
      }
    });

    return stats;
  }

  static getBestTrades(
    groupedBySymbol: { [symbol: string]: { [tradeId: string]: any[] } },
    symbolStats: { [symbol: string]: SymbolStats }
  ): Array<{ symbol: string; tradeId: string; side: string; winrate: number; processedAt: string }> {
    const bestTrades: Array<{ symbol: string; tradeId: string; side: string; winrate: number; processedAt: string }> = [];

    Object.keys(groupedBySymbol).forEach(symbol => {
      const stats = symbolStats[symbol];
      if (!stats || stats.won + stats.lost === 0) return;

      Object.keys(groupedBySymbol[symbol]).forEach(tradeId => {
        const tradeLogs = groupedBySymbol[symbol][tradeId];
        const { closed: lifecycles } = StatsController.segmentIntoClosedLifecycles(tradeLogs);
        const segments = lifecycles.length > 0 ? lifecycles : [tradeLogs];
        for (const seg of segments) {
          const info = StatsController.getTradeIdInfo(seg);
          if (info.status !== 'won') continue;
          const lastLog = seg.reduce(
            (latest, l) =>
              new Date(l.processed_at).getTime() > new Date(latest.processed_at).getTime() ? l : latest,
            seg[0]
          );
          bestTrades.push({
            symbol,
            tradeId: info.tradeId,
            side: info.side,
            winrate: stats.winrate,
            processedAt: lastLog.processed_at,
          });
        }
      });
    });

    // Ordenar por fecha más reciente primero (últimas mejores operaciones de cualquier estrategia/símbolo)
    return bestTrades.sort((a, b) => {
      const timeA = new Date(a.processedAt).getTime();
      const timeB = new Date(b.processedAt).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return b.winrate - a.winrate;
    });
  }
}

