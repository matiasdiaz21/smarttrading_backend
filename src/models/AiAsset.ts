import pool from '../config/database';

export type AssetCategory = 'crypto' | 'forex' | 'commodities';

export interface AiAssetRow {
  id: number;
  symbol: string;
  display_name: string | null;
  is_enabled: boolean;
  product_type: string;
  category: AssetCategory;
  added_by: number | null;
  created_at: Date;
}

export class AiAssetModel {
  static async findAll(enabledOnly = false): Promise<AiAssetRow[]> {
    let query = 'SELECT * FROM ai_assets';
    if (enabledOnly) {
      query += ' WHERE is_enabled = 1';
    }
    query += ' ORDER BY symbol ASC';
    const [rows] = await pool.execute(query);
    return (rows as any[]).map(r => ({ ...r, is_enabled: !!r.is_enabled }));
  }

  static async findById(id: number): Promise<AiAssetRow | null> {
    const [rows] = await pool.execute('SELECT * FROM ai_assets WHERE id = ?', [id]);
    const arr = rows as any[];
    if (arr.length === 0) return null;
    return { ...arr[0], is_enabled: !!arr[0].is_enabled };
  }

  static async findBySymbol(symbol: string): Promise<AiAssetRow | null> {
    const [rows] = await pool.execute('SELECT * FROM ai_assets WHERE symbol = ?', [symbol.toUpperCase()]);
    const arr = rows as any[];
    if (arr.length === 0) return null;
    return { ...arr[0], is_enabled: !!arr[0].is_enabled };
  }

  static async create(symbol: string, displayName: string | null, addedBy: number | null, productType: string = 'USDT-FUTURES', category: AssetCategory = 'crypto'): Promise<number> {
    const [result] = await pool.execute(
      'INSERT INTO ai_assets (symbol, display_name, is_enabled, product_type, category, added_by) VALUES (?, ?, 1, ?, ?, ?)',
      [symbol.toUpperCase(), displayName, productType, category, addedBy]
    );
    return (result as any).insertId;
  }

  static async toggle(id: number): Promise<void> {
    await pool.execute('UPDATE ai_assets SET is_enabled = NOT is_enabled WHERE id = ?', [id]);
  }

  static async delete(id: number): Promise<void> {
    await pool.execute('DELETE FROM ai_assets WHERE id = ?', [id]);
  }
}
