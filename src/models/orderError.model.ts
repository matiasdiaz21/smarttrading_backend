import pool from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface OrderError {
  id: number;
  user_id: number;
  strategy_id: number;
  symbol: string;
  side: string;
  alert_type: string;
  trade_id: number | null;
  error_message: string;
  bitget_response: any;
  alert_data: any;
  created_at: string;
}

export interface OrderErrorWithDetails extends OrderError {
  user_email: string;
  strategy_name: string;
}

class OrderErrorModel {
  async create(
    userId: number,
    strategyId: number,
    symbol: string,
    side: string,
    alertType: string,
    errorMessage: string,
    tradeId?: number | null,
    bitgetResponse?: any,
    alertData?: any
  ): Promise<number> {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO order_errors 
       (user_id, strategy_id, symbol, side, alert_type, trade_id, error_message, bitget_response, alert_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        strategyId,
        symbol,
        side,
        alertType,
        tradeId || null,
        errorMessage,
        bitgetResponse ? JSON.stringify(bitgetResponse) : null,
        alertData ? JSON.stringify(alertData) : null,
      ]
    );
    return result.insertId;
  }

  async getAll(limit: number = 100): Promise<OrderErrorWithDetails[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT 
        oe.*,
        u.email as user_email,
        s.name as strategy_name
       FROM order_errors oe
       JOIN users u ON oe.user_id = u.id
       JOIN strategies s ON oe.strategy_id = s.id
       ORDER BY oe.created_at DESC
       LIMIT ?`,
      [limit]
    );

    return rows.map((row) => ({
      ...row,
      bitget_response: row.bitget_response ? JSON.parse(row.bitget_response) : null,
      alert_data: row.alert_data ? JSON.parse(row.alert_data) : null,
    })) as OrderErrorWithDetails[];
  }

  async getByUser(userId: number, limit: number = 50): Promise<OrderError[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM order_errors
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [userId, limit]
    );

    return rows.map((row) => ({
      ...row,
      bitget_response: row.bitget_response ? JSON.parse(row.bitget_response) : null,
      alert_data: row.alert_data ? JSON.parse(row.alert_data) : null,
    })) as OrderError[];
  }

  async getByStrategy(strategyId: number, limit: number = 50): Promise<OrderError[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM order_errors
       WHERE strategy_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [strategyId, limit]
    );

    return rows.map((row) => ({
      ...row,
      bitget_response: row.bitget_response ? JSON.parse(row.bitget_response) : null,
      alert_data: row.alert_data ? JSON.parse(row.alert_data) : null,
    })) as OrderError[];
  }

  async deleteOlderThan(days: number): Promise<number> {
    const [result] = await pool.execute<ResultSetHeader>(
      `DELETE FROM order_errors
       WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days]
    );
    return result.affectedRows;
  }
}

export default new OrderErrorModel();
