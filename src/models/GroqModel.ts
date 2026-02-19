import pool from '../config/database';

export interface GroqModelRow {
  id: number;
  model_id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: Date;
}

export class GroqModel {
  static async findAll(activeOnly = false): Promise<GroqModelRow[]> {
    let query = 'SELECT id, model_id, name, is_active, sort_order, created_at FROM groq_models';
    if (activeOnly) {
      query += ' WHERE is_active = 1';
    }
    query += ' ORDER BY sort_order ASC, name ASC';
    const [rows] = await pool.execute(query);
    return (rows as any[]).map(r => ({ ...r, is_active: !!r.is_active }));
  }

  static async findByModelId(modelId: string): Promise<GroqModelRow | null> {
    const [rows] = await pool.execute('SELECT * FROM groq_models WHERE model_id = ?', [modelId]);
    const arr = rows as any[];
    if (arr.length === 0) return null;
    return { ...arr[0], is_active: !!arr[0].is_active };
  }
}
