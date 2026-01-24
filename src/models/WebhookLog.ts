import pool from '../config/database';
import { WebhookLog } from '../types';

export class WebhookLogModel {
  static async create(
    strategyId: number | null,
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
    // Convertir limit a entero y validar (entre 1 y 1000)
    const limitInt = Math.max(1, Math.min(1000, parseInt(String(limit), 10) || 100));
    
    // Validar que sea un entero válido
    if (!Number.isInteger(limitInt) || limitInt < 1 || limitInt > 1000) {
      throw new Error('Invalid limit value');
    }
    
    // MySQL2 puede tener problemas con LIMIT como parámetro preparado
    // Usamos execute con el número validado directamente en la query
    // La validación previa asegura que no hay riesgo de SQL injection
    const [rows] = await pool.execute(
      `SELECT * FROM webhook_logs ORDER BY processed_at DESC, id DESC LIMIT ${limitInt}`
    );
    return rows as WebhookLog[];
  }

  static async findByStrategyId(strategyId: number, limit = 50): Promise<WebhookLog[]> {
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
    const [rows] = await pool.execute(
      `SELECT * FROM webhook_logs WHERE strategy_id = ? ORDER BY processed_at DESC, id DESC LIMIT ${limitInt}`,
      [strategyIdInt]
    );
    return rows as WebhookLog[];
  }
}

