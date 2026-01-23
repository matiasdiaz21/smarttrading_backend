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
    tradeId: number | string
  ): Promise<Trade | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM trades WHERE user_id = ? AND strategy_id = ? AND trade_id = ? AND status IN (?, ?) ORDER BY executed_at DESC LIMIT 1',
      [userId, strategyId, tradeId, 'pending', 'filled']
    );
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
    const [rows] = await pool.execute(
      'SELECT * FROM trades WHERE user_id = ? ORDER BY executed_at DESC LIMIT ?',
      [userId, limit]
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
    tradeId: number | string
  ): Promise<boolean> {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as count 
       FROM trades 
       WHERE user_id = ? 
         AND strategy_id = ? 
         AND trade_id = ? 
         AND alert_type = 'ENTRY' 
         AND status IN ('pending', 'filled')
       LIMIT 1`,
      [userId, strategyId, tradeId]
    );
    const result = rows as any[];
    return result[0]?.count > 0;
  }
}

