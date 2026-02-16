import pool from '../config/database';
import { MassTradeConfig, MassTradeExecution, MassTradeSymbolConfig } from '../types';

export class MassTradeConfigModel {
  static async findByUserId(userId: number): Promise<MassTradeConfig[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM mass_trade_configs WHERE user_id = ? ORDER BY updated_at DESC',
      [userId]
    );
    return (rows as any[]).map(this.parseRow);
  }

  static async findById(id: number, userId: number): Promise<MassTradeConfig | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM mass_trade_configs WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    const configs = (rows as any[]).map(this.parseRow);
    return configs[0] || null;
  }

  static async create(
    userId: number,
    data: {
      name: string;
      credential_id: number;
      side: 'buy' | 'sell';
      leverage: number;
      stop_loss_percent: number;
      take_profit_percent?: number | null;
      position_size_usdt: number;
      symbols: MassTradeSymbolConfig[];
      product_type?: string;
      margin_coin?: string;
    }
  ): Promise<number> {
    const [result] = await pool.execute(
      `INSERT INTO mass_trade_configs 
       (user_id, name, credential_id, side, leverage, stop_loss_percent, take_profit_percent, position_size_usdt, symbols, product_type, margin_coin) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        data.name,
        data.credential_id,
        data.side,
        data.leverage,
        data.stop_loss_percent,
        data.take_profit_percent ?? null,
        data.position_size_usdt,
        JSON.stringify(data.symbols),
        data.product_type || 'USDT-FUTURES',
        data.margin_coin || 'USDT',
      ]
    );
    return (result as any).insertId;
  }

  static async update(
    id: number,
    userId: number,
    data: {
      name?: string;
      credential_id?: number;
      side?: 'buy' | 'sell';
      leverage?: number;
      stop_loss_percent?: number;
      take_profit_percent?: number | null;
      position_size_usdt?: number;
      symbols?: MassTradeSymbolConfig[];
      product_type?: string;
      margin_coin?: string;
      is_active?: boolean;
    }
  ): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name); }
    if (data.credential_id !== undefined) { updates.push('credential_id = ?'); values.push(data.credential_id); }
    if (data.side !== undefined) { updates.push('side = ?'); values.push(data.side); }
    if (data.leverage !== undefined) { updates.push('leverage = ?'); values.push(data.leverage); }
    if (data.stop_loss_percent !== undefined) { updates.push('stop_loss_percent = ?'); values.push(data.stop_loss_percent); }
    if (data.take_profit_percent !== undefined) { updates.push('take_profit_percent = ?'); values.push(data.take_profit_percent); }
    if (data.position_size_usdt !== undefined) { updates.push('position_size_usdt = ?'); values.push(data.position_size_usdt); }
    if (data.symbols !== undefined) { updates.push('symbols = ?'); values.push(JSON.stringify(data.symbols)); }
    if (data.product_type !== undefined) { updates.push('product_type = ?'); values.push(data.product_type); }
    if (data.margin_coin !== undefined) { updates.push('margin_coin = ?'); values.push(data.margin_coin); }
    if (data.is_active !== undefined) { updates.push('is_active = ?'); values.push(data.is_active); }

    if (updates.length === 0) return;

    values.push(id, userId);
    await pool.execute(
      `UPDATE mass_trade_configs SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    );
  }

  static async delete(id: number, userId: number): Promise<void> {
    await pool.execute(
      'DELETE FROM mass_trade_configs WHERE id = ? AND user_id = ?',
      [id, userId]
    );
  }

  static async createExecution(
    configId: number,
    userId: number,
    data: {
      side: 'buy' | 'sell';
      leverage: number;
      symbols_count: number;
      successful: number;
      failed: number;
      results: any;
    }
  ): Promise<number> {
    const [result] = await pool.execute(
      `INSERT INTO mass_trade_executions 
       (config_id, user_id, side, leverage, symbols_count, successful, failed, results) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        configId,
        userId,
        data.side,
        data.leverage,
        data.symbols_count,
        data.successful,
        data.failed,
        JSON.stringify(data.results),
      ]
    );
    return (result as any).insertId;
  }

  static async getExecutions(userId: number, limit: number = 20): Promise<MassTradeExecution[]> {
    const limitInt = Math.max(1, Math.min(100, parseInt(String(limit), 10) || 20));
    const [rows] = await pool.execute(
      `SELECT e.*, c.name as config_name 
       FROM mass_trade_executions e 
       LEFT JOIN mass_trade_configs c ON e.config_id = c.id 
       WHERE e.user_id = ? 
       ORDER BY e.executed_at DESC 
       LIMIT ${limitInt}`,
      [userId]
    );
    return (rows as any[]).map(row => ({
      ...row,
      results: typeof row.results === 'string' ? JSON.parse(row.results) : row.results,
    }));
  }

  private static parseRow(row: any): MassTradeConfig {
    return {
      ...row,
      symbols: typeof row.symbols === 'string' ? JSON.parse(row.symbols) : row.symbols,
    };
  }
}
