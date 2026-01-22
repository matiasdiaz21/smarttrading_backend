import pool from '../config/database';
import { User } from '../types';

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
    const [rows] = await pool.execute('SELECT id, email, role, subscription_status, subscription_expires_at, created_at FROM users');
    return rows as User[];
  }
}

