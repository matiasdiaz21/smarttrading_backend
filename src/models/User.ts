import pool from '../config/database';
import { User } from '../types';
import { randomUUID } from 'crypto';

export class UserModel {
  static async findByEmail(email: string): Promise<User | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );
    const users = rows as User[];
    return users[0] || null;
  }

  static async findById(id: number): Promise<User | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );
    const users = rows as User[];
    return users[0] || null;
  }

  static async getOrCreateUuid(userId: number): Promise<string> {
    const user = await this.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Si el usuario ya tiene UUID, retornarlo
    if (user.uuid) {
      return user.uuid;
    }

    // Generar nuevo UUID y guardarlo
    const uuid = randomUUID();
    await pool.execute(
      'UPDATE users SET uuid = ? WHERE id = ?',
      [uuid, userId]
    );

    return uuid;
  }

  static async create(
    email: string,
    passwordHash: string,
    role: 'admin' | 'user' = 'user'
  ): Promise<number> {
    const [result] = await pool.execute(
      'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
      [email, passwordHash, role]
    );
    return (result as any).insertId;
  }

  static async updateSubscription(
    userId: number,
    status: 'active' | 'inactive' | 'expired',
    expiresAt: Date | null
  ): Promise<void> {
    await pool.execute(
      'UPDATE users SET subscription_status = ?, subscription_expires_at = ? WHERE id = ?',
      [status, expiresAt, userId]
    );
  }

  static async getAll(): Promise<User[]> {
    const [rows] = await pool.execute('SELECT id, uuid, email, role, subscription_status, subscription_expires_at, trading_terms_accepted_at, created_at FROM users');
    return rows as User[];
  }

  static async acceptTradingTerms(userId: number): Promise<void> {
    await pool.execute(
      'UPDATE users SET trading_terms_accepted_at = NOW() WHERE id = ?',
      [userId]
    );
  }

  static async hasAcceptedTradingTerms(userId: number): Promise<boolean> {
    const [rows] = await pool.execute(
      'SELECT trading_terms_accepted_at FROM users WHERE id = ?',
      [userId]
    );
    const users = rows as any[];
    return users[0]?.trading_terms_accepted_at !== null;
  }
}

