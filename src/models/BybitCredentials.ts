import pool from '../config/database';
import { UserBybitCredentials } from '../types';

export class BybitCredentialsModel {
  static async findByUserId(userId: number): Promise<UserBybitCredentials[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM user_bybit_credentials WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    return rows as UserBybitCredentials[];
  }

  static async findById(id: number, userId: number): Promise<UserBybitCredentials | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM user_bybit_credentials WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    const credentials = rows as UserBybitCredentials[];
    return credentials[0] || null;
  }

  static async create(
    userId: number,
    apiKey: string,
    apiSecret: string,
    name: string | null = null
  ): Promise<number> {
    const [result] = await pool.execute(
      'INSERT INTO user_bybit_credentials (user_id, api_key, api_secret, name, is_active) VALUES (?, ?, ?, ?, true)',
      [userId, apiKey, apiSecret, name || null]
    );
    return (result as any).insertId;
  }

  static async update(
    id: number,
    userId: number,
    apiKey?: string,
    apiSecret?: string,
    isActive?: boolean,
    name?: string | null
  ): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];

    if (apiKey !== undefined) {
      updates.push('api_key = ?');
      values.push(apiKey);
    }
    if (apiSecret !== undefined) {
      updates.push('api_secret = ?');
      values.push(apiSecret);
    }
    if (isActive !== undefined) {
      updates.push('is_active = ?');
      values.push(isActive);
    }
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name || null);
    }

    if (updates.length === 0) return;

    values.push(id, userId);
    await pool.execute(
      `UPDATE user_bybit_credentials SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    );
  }

  static async delete(id: number, userId: number): Promise<void> {
    await pool.execute(
      'DELETE FROM user_bybit_credentials WHERE id = ? AND user_id = ?',
      [id, userId]
    );
  }

  static async findActiveByUserId(userId: number): Promise<UserBybitCredentials | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM user_bybit_credentials WHERE user_id = ? AND is_active = true LIMIT 1',
      [userId]
    );
    const credentials = rows as UserBybitCredentials[];
    return credentials[0] || null;
  }
}
