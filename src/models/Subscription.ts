import pool from '../config/database';
import { UserStrategySubscription } from '../types';

export class SubscriptionModel {
  static async findByUserId(userId: number): Promise<UserStrategySubscription[]> {
    const [rows] = await pool.execute(
      `SELECT uss.*, s.name as strategy_name, s.description as strategy_description 
       FROM user_strategy_subscriptions uss
       JOIN strategies s ON uss.strategy_id = s.id
       WHERE uss.user_id = ?`,
      [userId]
    );
    return rows as any[];
  }

  static async findByStrategyId(strategyId: number, enabledOnly = false): Promise<UserStrategySubscription[]> {
    let query = 'SELECT * FROM user_strategy_subscriptions WHERE strategy_id = ?';
    if (enabledOnly) {
      query += ' AND is_enabled = true';
    }
    const [rows] = await pool.execute(query, [strategyId]);
    return rows as UserStrategySubscription[];
  }

  static async findById(userId: number, strategyId: number): Promise<UserStrategySubscription | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM user_strategy_subscriptions WHERE user_id = ? AND strategy_id = ?',
      [userId, strategyId]
    );
    const subscriptions = rows as UserStrategySubscription[];
    return subscriptions[0] || null;
  }

  static async create(userId: number, strategyId: number): Promise<number> {
    const [result] = await pool.execute(
      'INSERT INTO user_strategy_subscriptions (user_id, strategy_id, is_enabled) VALUES (?, ?, false)',
      [userId, strategyId]
    );
    return (result as any).insertId;
  }

  static async toggle(userId: number, strategyId: number, enabled: boolean): Promise<void> {
    await pool.execute(
      'UPDATE user_strategy_subscriptions SET is_enabled = ?, updated_at = NOW() WHERE user_id = ? AND strategy_id = ?',
      [enabled, userId, strategyId]
    );
  }

  static async delete(userId: number, strategyId: number): Promise<void> {
    await pool.execute(
      'DELETE FROM user_strategy_subscriptions WHERE user_id = ? AND strategy_id = ?',
      [userId, strategyId]
    );
  }
}

