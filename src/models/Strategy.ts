import pool from '../config/database';
import { Strategy } from '../types';

export class StrategyModel {
  static async findAll(includeInactive = false): Promise<Strategy[]> {
    let query = 'SELECT * FROM strategies';
    if (!includeInactive) {
      query += ' WHERE is_active = true';
    }
    query += ' ORDER BY created_at DESC';
    
    const [rows] = await pool.execute(query);
    return rows as Strategy[];
  }

  static async findById(id: number): Promise<Strategy | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM strategies WHERE id = ?',
      [id]
    );
    const strategies = rows as Strategy[];
    return strategies[0] || null;
  }

  static async create(
    name: string,
    description: string | null,
    warnings: string | null,
    webhookSecret: string,
    createdBy: number,
    leverage: number = 10,
    allowedSymbols: string[] | null = null,
    category: string | null = 'crypto',
    isFree: boolean = false,
    freeUntil: Date | string | null = null
  ): Promise<number> {
    const allowedSymbolsJson = allowedSymbols?.length
      ? JSON.stringify(allowedSymbols)
      : null;
    const freeUntilVal = freeUntil == null ? null : (typeof freeUntil === 'string' ? freeUntil : freeUntil.toISOString().slice(0, 10));
    const [result] = await pool.execute(
      'INSERT INTO strategies (name, description, warnings, tradingview_webhook_secret, is_active, leverage, allowed_symbols, category, is_free, free_until, created_by) VALUES (?, ?, ?, ?, true, ?, ?, ?, ?, ?, ?)',
      [name, description, warnings, webhookSecret, leverage, allowedSymbolsJson, category || 'crypto', !!isFree, freeUntilVal, createdBy]
    );
    return (result as any).insertId;
  }

  static async update(
    id: number,
    name?: string,
    description?: string | null,
    warnings?: string | null,
    isActive?: boolean,
    leverage?: number,
    allowedSymbols?: string[] | null,
    category?: string | null,
    isFree?: boolean,
    freeUntil?: Date | string | null
  ): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (warnings !== undefined) {
      updates.push('warnings = ?');
      values.push(warnings);
    }
    if (isActive !== undefined) {
      updates.push('is_active = ?');
      values.push(isActive);
    }
    if (leverage !== undefined) {
      updates.push('leverage = ?');
      values.push(leverage);
    }
    if (allowedSymbols !== undefined) {
      updates.push('allowed_symbols = ?');
      values.push(allowedSymbols?.length ? JSON.stringify(allowedSymbols) : null);
    }
    if (category !== undefined) {
      updates.push('category = ?');
      values.push(category || null);
    }
    if (isFree !== undefined) {
      updates.push('is_free = ?');
      values.push(!!isFree);
    }
    if (freeUntil !== undefined) {
      updates.push('free_until = ?');
      values.push(freeUntil == null ? null : (typeof freeUntil === 'string' ? freeUntil : freeUntil.toISOString().slice(0, 10)));
    }

    if (updates.length === 0) return;

    values.push(id);
    await pool.execute(
      `UPDATE strategies SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );
  }

  static async delete(id: number): Promise<void> {
    await pool.execute('DELETE FROM strategies WHERE id = ?', [id]);
  }
}

