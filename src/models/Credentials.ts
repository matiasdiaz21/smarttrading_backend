import pool from '../config/database';
import { UserBitgetCredentials } from '../types';

export class CredentialsModel {
  static async findByUserId(userId: number): Promise<UserBitgetCredentials[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM user_bitget_credentials WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    return rows as UserBitgetCredentials[];
  }

  static async findById(id: number, userId: number): Promise<UserBitgetCredentials | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM user_bitget_credentials WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    const credentials = rows as UserBitgetCredentials[];
    return credentials[0] || null;
  }

  static async create(
    userId: number,
    apiKey: string,
    apiSecret: string,
    passphrase: string,
    name: string | null = null
  ): Promise<number> {
    const [result] = await pool.execute(
      'INSERT INTO user_bitget_credentials (user_id, api_key, api_secret, passphrase, name, is_active) VALUES (?, ?, ?, ?, ?, true)',
      [userId, apiKey, apiSecret, passphrase, name || null]
    );
    return (result as any).insertId;
  }

  static async update(
    id: number,
    userId: number,
    apiKey?: string,
    apiSecret?: string,
    passphrase?: string,
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
    if (passphrase !== undefined) {
      updates.push('passphrase = ?');
      values.push(passphrase);
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
      `UPDATE user_bitget_credentials SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    );
  }

  static async delete(id: number, userId: number): Promise<void> {
    await pool.execute(
      'DELETE FROM user_bitget_credentials WHERE id = ? AND user_id = ?',
      [id, userId]
    );
  }

  static async findActiveByUserId(userId: number): Promise<UserBitgetCredentials | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM user_bitget_credentials WHERE user_id = ? AND is_active = true LIMIT 1',
      [userId]
    );
    const credentials = rows as UserBitgetCredentials[];
    return credentials[0] || null;
  }

  /** Todas las credenciales activas del usuario (para agrupar posiciones de todas las cuentas). */
  static async findAllActiveByUserId(userId: number): Promise<UserBitgetCredentials[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM user_bitget_credentials WHERE user_id = ? AND is_active = true ORDER BY id ASC',
      [userId]
    );
    return (rows as UserBitgetCredentials[]) || [];
  }
}

