import pool from '../config/database';
import { PaymentPlan } from '../types';

export class PaymentPlanModel {
  static async findAll(includeInactive = false): Promise<PaymentPlan[]> {
    let query = 'SELECT * FROM payment_plans';
    if (!includeInactive) {
      query += ' WHERE is_active = true';
    }
    query += ' ORDER BY amount ASC, created_at DESC';
    
    const [rows] = await pool.execute(query);
    return rows as PaymentPlan[];
  }

  static async findById(id: number): Promise<PaymentPlan | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM payment_plans WHERE id = ?',
      [id]
    );
    const plans = rows as PaymentPlan[];
    return plans[0] || null;
  }

  static async findActive(): Promise<PaymentPlan[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM payment_plans WHERE is_active = true ORDER BY amount ASC'
    );
    return rows as PaymentPlan[];
  }

  static async create(
    title: string,
    description: string | null,
    amount: number,
    currency: string,
    durationDays: number,
    features: string | null,
    payCurrency: string | null = null
  ): Promise<number> {
    const [result] = await pool.execute(
      'INSERT INTO payment_plans (title, description, amount, currency, pay_currency, duration_days, features, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, true)',
      [title, description, amount, currency, payCurrency, durationDays, features]
    );
    return (result as any).insertId;
  }

  static async update(
    id: number,
    title?: string,
    description?: string | null,
    amount?: number,
    currency?: string,
    payCurrency?: string | null,
    durationDays?: number,
    features?: string | null,
    isActive?: boolean
  ): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];

    if (title !== undefined) {
      updates.push('title = ?');
      values.push(title);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (amount !== undefined) {
      updates.push('amount = ?');
      values.push(amount);
    }
    if (currency !== undefined) {
      updates.push('currency = ?');
      values.push(currency);
    }
    if (payCurrency !== undefined) {
      updates.push('pay_currency = ?');
      values.push(payCurrency);
    }
    if (durationDays !== undefined) {
      updates.push('duration_days = ?');
      values.push(durationDays);
    }
    if (features !== undefined) {
      updates.push('features = ?');
      values.push(features);
    }
    if (isActive !== undefined) {
      updates.push('is_active = ?');
      values.push(Boolean(isActive));
    }

    if (updates.length === 0) return;

    values.push(id);
    await pool.execute(
      `UPDATE payment_plans SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );
  }

  static async delete(id: number): Promise<void> {
    await pool.execute('DELETE FROM payment_plans WHERE id = ?', [id]);
  }
}

