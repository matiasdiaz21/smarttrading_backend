import pool from '../config/database';
import { Subscription } from '../types';

export class PaymentSubscriptionModel {
  static async create(
    userId: number,
    paymentId: string,
    amount: number,
    currency: string,
    expiresAt: Date | null
  ): Promise<number> {
    const [result] = await pool.execute(
      'INSERT INTO subscriptions (user_id, payment_id, status, amount, currency, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, paymentId, 'pending', amount, currency, expiresAt]
    );
    return (result as any).insertId;
  }

  static async findByPaymentId(paymentId: string): Promise<Subscription | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM subscriptions WHERE payment_id = ?',
      [paymentId]
    );
    const subscriptions = rows as Subscription[];
    return subscriptions[0] || null;
  }

  static async updateStatus(
    paymentId: string,
    status: 'pending' | 'confirmed' | 'expired' | 'cancelled'
  ): Promise<void> {
    await pool.execute(
      'UPDATE subscriptions SET status = ? WHERE payment_id = ?',
      [status, paymentId]
    );
  }

  static async findByUserId(userId: number): Promise<Subscription[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    return rows as Subscription[];
  }

  static async findActiveByUserId(userId: number): Promise<Subscription | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM subscriptions WHERE user_id = ? AND status = ? AND (expires_at IS NULL OR expires_at > NOW())',
      [userId, 'confirmed']
    );
    const subscriptions = rows as Subscription[];
    return subscriptions[0] || null;
  }
}

