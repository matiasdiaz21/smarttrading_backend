import pool from '../config/database';
import { WebhookLog } from '../types';

export class WebhookLogModel {
  static async create(
    strategyId: number,
    payload: string,
    signature: string | null,
    status: 'success' | 'failed' | 'invalid'
  ): Promise<number> {
    const [result] = await pool.execute(
      'INSERT INTO webhook_logs (strategy_id, payload, signature, status) VALUES (?, ?, ?, ?)',
      [strategyId, payload, signature, status]
    );
    return (result as any).insertId;
  }

  static async findAll(limit = 100): Promise<WebhookLog[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM webhook_logs ORDER BY processed_at DESC LIMIT ?',
      [limit]
    );
    return rows as WebhookLog[];
  }

  static async findByStrategyId(strategyId: number, limit = 50): Promise<WebhookLog[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM webhook_logs WHERE strategy_id = ? ORDER BY processed_at DESC LIMIT ?',
      [strategyId, limit]
    );
    return rows as WebhookLog[];
  }
}

