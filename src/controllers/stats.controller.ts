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
        ? await WebhookLogModel.findByStrategyIds(statsStrategyIds, 1000)
        : await WebhookLogModel.findAll(1000);

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
      // totalTrades solo cuenta operaciones cerradas (won + lost), no pendientes
      const totalWon = Object.values(symbolStats).reduce((sum, stats) => sum + stats.won, 0);
      const totalLost = Object.values(symbolStats).reduce((sum, stats) => sum + stats.lost, 0);
      const totalTrades = totalWon + totalLost; // Solo trades cerrados
      const overallWinrate = totalWon + totalLost > 0 
        ? (totalWon / (totalWon + totalLost)) * 100 
        : 0;

      // Obtener lista de todas las monedas únicas
      const allSymbols = Object.keys(groupedBySymbol)
        .filter(symbol => symbol !== 'N/A')
        .sort();

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
            overallWinrate: parseFloat(overallWinrate.toFixed(2)),
          },
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
      return p?.alertType || p?.alert_type || 'UNKNOWN';
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

  static getSymbolStats(
    groupedBySymbol: { [symbol: string]: { [tradeId: string]: any[] } }
  ): { [symbol: string]: SymbolStats } {
    const stats: { [symbol: string]: SymbolStats } = {};

    Object.keys(groupedBySymbol).forEach(symbol => {
      stats[symbol] = { won: 0, lost: 0, pending: 0, winrate: 0, total: 0 };

      Object.keys(groupedBySymbol[symbol]).forEach(tradeId => {
        const tradeLogs = groupedBySymbol[symbol][tradeId];
        const info = StatsController.getTradeIdInfo(tradeLogs);
        stats[symbol][info.status]++;
        stats[symbol].total++;
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
        const info = StatsController.getTradeIdInfo(tradeLogs);

        // Solo incluir trades ganados
        if (info.status === 'won') {
          const mostRecentLog = tradeLogs[0];
          bestTrades.push({
            symbol,
            tradeId: info.tradeId,
            side: info.side,
            winrate: stats.winrate,
            processedAt: mostRecentLog.processed_at,
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

