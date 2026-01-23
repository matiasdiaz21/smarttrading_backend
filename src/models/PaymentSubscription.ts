import pool from '../config/database';
import { Subscription } from '../types';

export class PaymentSubscriptionModel {
  static async create(
    userId: number,
    paymentPlanId: number | null,
    paymentId: string,
    orderId: string | null,
    amount: number,
    currency: string,
    expiresAt: Date | null,
    paymentData?: {
      payment_status?: string;
      pay_address?: string;
      pay_amount?: number;
      pay_currency?: string;
      purchase_id?: string;
      amount_received?: number;
      network?: string;
      expiration_estimate_date?: Date | string;
      created_at?: Date | string;
      updated_at?: Date | string;
    }
  ): Promise<number> {
    const [result] = await pool.execute(
      `INSERT INTO subscriptions (
        user_id, payment_plan_id, payment_id, order_id, 
        payment_status, pay_address, pay_amount, pay_currency,
        purchase_id, amount_received, network, expiration_estimate_date,
        nowpayments_created_at, nowpayments_updated_at,
        status, amount, currency, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        paymentPlanId,
        paymentId,
        orderId,
        paymentData?.payment_status || null,
        paymentData?.pay_address || null,
        paymentData?.pay_amount || null,
        paymentData?.pay_currency || null,
        paymentData?.purchase_id || null,
        paymentData?.amount_received || null,
        paymentData?.network || null,
        paymentData?.expiration_estimate_date ? new Date(paymentData.expiration_estimate_date) : null,
        paymentData?.created_at ? new Date(paymentData.created_at) : null,
        paymentData?.updated_at ? new Date(paymentData.updated_at) : null,
        'pending',
        amount,
        currency,
        expiresAt
      ]
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

  static async findByOrderId(orderId: string): Promise<Subscription | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM subscriptions WHERE order_id = ?',
      [orderId]
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

  static async updateExpiresAt(
    paymentId: string,
    expiresAt: Date
  ): Promise<void> {
    await pool.execute(
      'UPDATE subscriptions SET expires_at = ? WHERE payment_id = ?',
      [expiresAt, paymentId]
    );
  }

  static async updatePaymentDetails(
    paymentId: string,
    paymentData: {
      payment_status?: string;
      pay_address?: string;
      pay_amount?: number;
      pay_currency?: string;
      purchase_id?: string;
      amount_received?: number;
      network?: string;
      expiration_estimate_date?: Date | string;
      updated_at?: Date | string;
    }
  ): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];

    if (paymentData.payment_status !== undefined) {
      updates.push('payment_status = ?');
      values.push(paymentData.payment_status);
    }
    if (paymentData.pay_address !== undefined) {
      updates.push('pay_address = ?');
      values.push(paymentData.pay_address);
    }
    if (paymentData.pay_amount !== undefined) {
      updates.push('pay_amount = ?');
      values.push(paymentData.pay_amount);
    }
    if (paymentData.pay_currency !== undefined) {
      updates.push('pay_currency = ?');
      values.push(paymentData.pay_currency);
    }
    if (paymentData.purchase_id !== undefined) {
      updates.push('purchase_id = ?');
      values.push(paymentData.purchase_id);
    }
    if (paymentData.amount_received !== undefined) {
      updates.push('amount_received = ?');
      values.push(paymentData.amount_received);
    }
    if (paymentData.network !== undefined) {
      updates.push('network = ?');
      values.push(paymentData.network);
    }
    if (paymentData.expiration_estimate_date !== undefined) {
      updates.push('expiration_estimate_date = ?');
      values.push(paymentData.expiration_estimate_date ? new Date(paymentData.expiration_estimate_date) : null);
    }
    if (paymentData.updated_at !== undefined) {
      updates.push('nowpayments_updated_at = ?');
      values.push(paymentData.updated_at ? new Date(paymentData.updated_at) : null);
    }

    if (updates.length === 0) return;

    values.push(paymentId);
    await pool.execute(
      `UPDATE subscriptions SET ${updates.join(', ')} WHERE payment_id = ?`,
      values
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

