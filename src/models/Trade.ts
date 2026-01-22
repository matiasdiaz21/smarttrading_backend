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
    status: 'pending' | 'filled' | 'cancelled' | 'failed'
  ): Promise<number> {
    const [result] = await pool.execute(
      'INSERT INTO trades (user_id, strategy_id, bitget_order_id, symbol, side, order_type, size, price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, strategyId, bitgetOrderId, symbol, side, orderType, size, price, status]
    );
    return (result as any).insertId;
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
}

