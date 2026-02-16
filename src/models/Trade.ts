import pool from '../config/database';
import { Trade } from '../types';

export class TradeModel {
  static async create(
    userId: number,
    strategyId: number,
    bitgetOrderId: string,
    symbol: string,
    side: 'buy' | 'sell',
    orderType: 'limit' | 'market',
    size: string,
    price: string | null,
    status: 'pending' | 'filled' | 'cancelled' | 'failed',
    tradeId?: number | string | null,
    entryPrice?: number | null,
    stopLoss?: number | null,
    takeProfit?: number | null,
    breakeven?: number | null,
    alertType?: string | null
  ): Promise<number> {
    const [result] = await pool.execute(
      'INSERT INTO trades (user_id, strategy_id, bitget_order_id, symbol, side, order_type, size, price, status, trade_id, entry_price, stop_loss, take_profit, breakeven, alert_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, strategyId, bitgetOrderId, symbol, side, orderType, size, price, status, tradeId || null, entryPrice || null, stopLoss || null, takeProfit || null, breakeven || null, alertType || null]
    );
    return (result as any).insertId;
  }

  static async findByTradeIdAndUser(
    userId: number,
    strategyId: number,
    tradeId: number | string,
    symbol?: string
  ): Promise<Trade | null> {
    let query = 'SELECT * FROM trades WHERE user_id = ? AND strategy_id = ? AND trade_id = ? AND status IN (?, ?)';
    const params: any[] = [userId, strategyId, tradeId, 'pending', 'filled'];
    if (symbol) {
      query += ' AND symbol = ?';
      params.push(symbol);
    }
    query += ' ORDER BY executed_at DESC LIMIT 1';
    const [rows] = await pool.execute(query, params);
    const trades = rows as Trade[];
    return trades[0] || null;
  }

  static async updateStopLoss(
    id: number,
    stopLoss: number
  ): Promise<void> {
    await pool.execute(
      'UPDATE trades SET stop_loss = ? WHERE id = ?',
      [stopLoss, id]
    );
  }

  static async findByUserId(userId: number, limit = 50): Promise<Trade[]> {
    // Validar parámetros
    const userIdInt = parseInt(String(userId), 10);
    const limitInt = Math.max(1, Math.min(1000, parseInt(String(limit), 10) || 50));
    
    if (isNaN(userIdInt) || !Number.isInteger(userIdInt)) {
      throw new Error('Invalid user_id');
    }
    
    if (!Number.isInteger(limitInt) || limitInt < 1 || limitInt > 1000) {
      throw new Error('Invalid limit value');
    }
    
    // MySQL2 puede tener problemas con LIMIT como parámetro preparado
    // Usamos execute con user_id como parámetro y limit validado en la query
    // La validación previa asegura que no hay riesgo de SQL injection
    const [rows] = await pool.execute(
      `SELECT * FROM trades WHERE user_id = ? ORDER BY executed_at DESC LIMIT ${limitInt}`,
      [userIdInt]
    );
    return rows as Trade[];
  }

  static async updateStatus(
    id: number,
    status: 'pending' | 'filled' | 'cancelled' | 'failed'
  ): Promise<void> {
    await pool.execute(
      'UPDATE trades SET status = ? WHERE id = ?',
      [status, id]
    );
  }

  /**
   * Verifica si existe un trade de tipo ENTRY previo para un símbolo y usuario específico
   */
  static async hasEntryForSymbol(
    userId: number,
    strategyId: number,
    symbol: string
  ): Promise<boolean> {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as count 
       FROM trades 
       WHERE user_id = ? 
         AND strategy_id = ? 
         AND symbol = ? 
         AND alert_type = 'ENTRY' 
         AND status IN ('pending', 'filled')
       LIMIT 1`,
      [userId, strategyId, symbol]
    );
    const result = rows as any[];
    return result[0]?.count > 0;
  }

  /**
   * Verifica si existe un trade de tipo ENTRY previo para un trade_id específico
   */
  static async hasEntryForTradeId(
    userId: number,
    strategyId: number,
    tradeId: number | string,
    symbol?: string
  ): Promise<boolean> {
    let query = `SELECT COUNT(*) as count 
       FROM trades 
       WHERE user_id = ? 
         AND strategy_id = ? 
         AND trade_id = ? 
         AND alert_type = 'ENTRY' 
         AND status IN ('pending', 'filled')`;
    const params: any[] = [userId, strategyId, tradeId];
    if (symbol) {
      query += ` AND symbol = ?`;
      params.push(symbol);
    }
    query += ` LIMIT 1`;
    const [rows] = await pool.execute(query, params);
    const result = rows as any[];
    return result[0]?.count > 0;
  }

  /**
   * Obtiene las últimas operaciones cerradas (STOP_LOSS o TAKE_PROFIT) para un usuario
   */
  static async findClosedTradesByUserId(userId: number, limit = 10): Promise<Trade[]> {
    const userIdInt = parseInt(String(userId), 10);
    const limitInt = Math.max(1, Math.min(100, parseInt(String(limit), 10) || 10));
    
    if (isNaN(userIdInt) || !Number.isInteger(userIdInt)) {
      throw new Error('Invalid user_id');
    }
    
    if (!Number.isInteger(limitInt) || limitInt < 1 || limitInt > 100) {
      throw new Error('Invalid limit value');
    }
    
    const [rows] = await pool.execute(
      `SELECT * FROM trades 
       WHERE user_id = ? 
         AND alert_type IN ('STOP_LOSS', 'TAKE_PROFIT')
         AND status = 'filled'
       ORDER BY executed_at DESC 
       LIMIT ${limitInt}`,
      [userIdInt]
    );
    return rows as Trade[];
  }

  /**
   * Busca trades por bitget_order_id para identificar si una orden es automática
   * Retorna información del trade si existe, incluyendo strategy_id
   */
  static async findByBitgetOrderId(
    userId: number,
    bitgetOrderId: string
  ): Promise<{ id: number; strategy_id: number; strategy_name?: string; is_automatic: boolean } | null> {
    const [rows] = await pool.execute(
      `SELECT t.id, t.strategy_id, t.bitget_order_id, s.name as strategy_name
       FROM trades t
       LEFT JOIN strategies s ON t.strategy_id = s.id
       WHERE t.user_id = ? AND t.bitget_order_id = ?
       LIMIT 1`,
      [userId, bitgetOrderId]
    );
    const result = rows as any[];
    if (result.length > 0) {
      return {
        id: result[0].id,
        strategy_id: result[0].strategy_id,
        strategy_name: result[0].strategy_name || null,
        is_automatic: true, // Si existe en trades, es automático
      };
    }
    return null;
  }

  /**
   * Busca múltiples trades por bitget_order_ids (batch lookup)
   * Retorna un Map con orderId -> trade info
   */
  static async findByBitgetOrderIds(
    userId: number,
    bitgetOrderIds: string[]
  ): Promise<Map<string, { id: number; strategy_id: number; strategy_name?: string; is_automatic: boolean }>> {
    if (bitgetOrderIds.length === 0) {
      return new Map();
    }

    const placeholders = bitgetOrderIds.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `SELECT t.id, t.strategy_id, t.bitget_order_id, s.name as strategy_name
       FROM trades t
       LEFT JOIN strategies s ON t.strategy_id = s.id
       WHERE t.user_id = ? AND t.bitget_order_id IN (${placeholders})`,
      [userId, ...bitgetOrderIds]
    );
    
    const result = rows as any[];
    const tradeMap = new Map<string, { id: number; strategy_id: number; strategy_name?: string; is_automatic: boolean }>();
    
    result.forEach((row) => {
      tradeMap.set(row.bitget_order_id, {
        id: row.id,
        strategy_id: row.strategy_id,
        strategy_name: row.strategy_name || null,
        is_automatic: true,
      });
    });
    
    return tradeMap;
  }
}

