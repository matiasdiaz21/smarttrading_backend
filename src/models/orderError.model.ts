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
    // Convertir limit a entero y validar (entre 1 y 1000)
    const limitInt = Math.max(1, Math.min(1000, parseInt(String(limit), 10) || 100));
    
    // Validar que sea un entero válido
    if (!Number.isInteger(limitInt) || limitInt < 1 || limitInt > 1000) {
      throw new Error('Invalid limit value');
    }
    
    // MySQL2 puede tener problemas con LIMIT como parámetro preparado
    // Usamos execute con el número validado directamente en la query
    // La validación previa asegura que no hay riesgo de SQL injection
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT 
        oe.*,
        u.email as user_email,
        s.name as strategy_name
       FROM order_errors oe
       JOIN users u ON oe.user_id = u.id
       JOIN strategies s ON oe.strategy_id = s.id
       ORDER BY oe.created_at DESC
       LIMIT ${limitInt}`
    );

    return rows.map((row) => ({
      ...row,
      bitget_response: row.bitget_response ? JSON.parse(row.bitget_response) : null,
      alert_data: row.alert_data ? JSON.parse(row.alert_data) : null,
    })) as OrderErrorWithDetails[];
  }

  async getByUser(userId: number, limit: number = 50): Promise<OrderError[]> {
    // Validar y convertir parámetros
    const userIdInt = parseInt(String(userId), 10);
    const limitInt = Math.max(1, Math.min(1000, parseInt(String(limit), 10) || 50));
    
    if (isNaN(userIdInt) || !Number.isInteger(userIdInt)) {
      throw new Error('Invalid user_id');
    }
    
    if (!Number.isInteger(limitInt) || limitInt < 1 || limitInt > 1000) {
      throw new Error('Invalid limit value');
    }
    
    // MySQL2 puede tener problemas con LIMIT como parámetro preparado
    // Usamos execute con userId como parámetro y limit validado en la query
    // La validación previa asegura que no hay riesgo de SQL injection
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM order_errors
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ${limitInt}`,
      [userIdInt]
    );

    return rows.map((row) => ({
      ...row,
      bitget_response: row.bitget_response ? JSON.parse(row.bitget_response) : null,
      alert_data: row.alert_data ? JSON.parse(row.alert_data) : null,
    })) as OrderError[];
  }

  async getByStrategy(strategyId: number, limit: number = 50): Promise<OrderError[]> {
    // Validar y convertir parámetros
    const strategyIdInt = parseInt(String(strategyId), 10);
    const limitInt = Math.max(1, Math.min(1000, parseInt(String(limit), 10) || 50));
    
    if (isNaN(strategyIdInt) || !Number.isInteger(strategyIdInt)) {
      throw new Error('Invalid strategy_id');
    }
    
    if (!Number.isInteger(limitInt) || limitInt < 1 || limitInt > 1000) {
      throw new Error('Invalid limit value');
    }
    
    // MySQL2 puede tener problemas con LIMIT como parámetro preparado
    // Usamos execute con strategy_id como parámetro y limit validado en la query
    // La validación previa asegura que no hay riesgo de SQL injection
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM order_errors
       WHERE strategy_id = ?
       ORDER BY created_at DESC
       LIMIT ${limitInt}`,
      [strategyIdInt]
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
