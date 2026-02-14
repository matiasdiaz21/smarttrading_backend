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

  static async create(
    userId: number,
    strategyId: number,
    leverage: number | null = null,
    credentialId: number | null = null
  ): Promise<number> {
    const [result] = await pool.execute(
      'INSERT INTO user_strategy_subscriptions (user_id, strategy_id, is_enabled, leverage, credential_id) VALUES (?, ?, false, ?, ?)',
      [userId, strategyId, leverage, credentialId]
    );
    return (result as any).insertId;
  }

  /** Verifica si esta credencial está asignada a alguna suscripción del usuario (opcionalmente excluyendo una estrategia). */
  static async isCredentialInUse(
    userId: number,
    credentialId: number,
    excludeStrategyId: number | null = null
  ): Promise<boolean> {
    let query = 'SELECT 1 FROM user_strategy_subscriptions WHERE user_id = ? AND credential_id = ?';
    const params: any[] = [userId, credentialId];
    if (excludeStrategyId != null) {
      query += ' AND strategy_id != ?';
      params.push(excludeStrategyId);
    }
    query += ' LIMIT 1';
    const [rows] = await pool.execute(query, params);
    return Array.isArray(rows) && rows.length > 0;
  }

  static async updateCredential(userId: number, strategyId: number, credentialId: number | null): Promise<void> {
    await pool.execute(
      'UPDATE user_strategy_subscriptions SET credential_id = ?, updated_at = NOW() WHERE user_id = ? AND strategy_id = ?',
      [credentialId, userId, strategyId]
    );
  }

  static async toggle(userId: number, strategyId: number, enabled: boolean): Promise<void> {
    await pool.execute(
      'UPDATE user_strategy_subscriptions SET is_enabled = ?, updated_at = NOW() WHERE user_id = ? AND strategy_id = ?',
      [enabled, userId, strategyId]
    );
  }

  static async updateLeverage(userId: number, strategyId: number, leverage: number | null): Promise<void> {
    await pool.execute(
      'UPDATE user_strategy_subscriptions SET leverage = ?, updated_at = NOW() WHERE user_id = ? AND strategy_id = ?',
      [leverage, userId, strategyId]
    );
  }

  static async updatePositionSize(userId: number, strategyId: number, positionSize: number | null): Promise<void> {
    await pool.execute(
      'UPDATE user_strategy_subscriptions SET position_size = ?, updated_at = NOW() WHERE user_id = ? AND strategy_id = ?',
      [positionSize, userId, strategyId]
    );
  }

  static async updateExcludedSymbols(userId: number, strategyId: number, excludedSymbols: string[] | null): Promise<void> {
    const json = excludedSymbols?.length ? JSON.stringify(excludedSymbols) : null;
    await pool.execute(
      'UPDATE user_strategy_subscriptions SET excluded_symbols = ?, updated_at = NOW() WHERE user_id = ? AND strategy_id = ?',
      [json, userId, strategyId]
    );
  }

  static async delete(userId: number, strategyId: number): Promise<void> {
    await pool.execute(
      'DELETE FROM user_strategy_subscriptions WHERE user_id = ? AND strategy_id = ?',
      [userId, strategyId]
    );
  }
}

