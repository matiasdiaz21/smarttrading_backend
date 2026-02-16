import pool from '../config/database';
import { encrypt, decrypt } from '../utils/encryption';

export interface AiConfigRow {
  id: number;
  groq_api_key: string | null;
  groq_model: string;
  system_prompt: string | null;
  analysis_prompt_template: string | null;
  is_enabled: boolean;
  auto_run_enabled: boolean;
  auto_run_interval_hours: number;
  last_auto_run_at: Date | null;
  max_predictions_per_run: number;
  default_expiry_hours: number;
  created_at: Date;
  updated_at: Date;
}

export class AiConfigModel {
  static async get(): Promise<AiConfigRow> {
    const [rows] = await pool.execute('SELECT * FROM ai_config WHERE id = 1');
    const arr = rows as any[];
    if (arr.length === 0) {
      return {
        id: 1,
        groq_api_key: null,
        groq_model: 'llama-3.3-70b-versatile',
        system_prompt: null,
        analysis_prompt_template: null,
        is_enabled: false,
        auto_run_enabled: false,
        auto_run_interval_hours: 4,
        last_auto_run_at: null,
        max_predictions_per_run: 5,
        default_expiry_hours: 24,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }
    const row = arr[0];
    return {
      ...row,
      groq_api_key: row.groq_api_key ? decrypt(row.groq_api_key) : null,
      is_enabled: !!row.is_enabled,
      auto_run_enabled: !!row.auto_run_enabled,
    };
  }

  /** Returns config for public/user use (without API key) */
  static async getPublic(): Promise<Omit<AiConfigRow, 'groq_api_key' | 'analysis_prompt_template' | 'system_prompt'>> {
    const config = await this.get();
    const { groq_api_key, analysis_prompt_template, system_prompt, ...publicConfig } = config;
    return publicConfig;
  }

  static async update(data: Partial<{
    groq_api_key: string | null;
    groq_model: string;
    system_prompt: string | null;
    analysis_prompt_template: string | null;
    is_enabled: boolean;
    auto_run_enabled: boolean;
    auto_run_interval_hours: number;
    max_predictions_per_run: number;
    default_expiry_hours: number;
  }>): Promise<AiConfigRow> {
    const updates: string[] = [];
    const values: any[] = [];

    if (data.groq_api_key !== undefined) {
      updates.push('groq_api_key = ?');
      values.push(data.groq_api_key ? encrypt(data.groq_api_key) : null);
    }
    if (data.groq_model !== undefined) {
      updates.push('groq_model = ?');
      values.push(data.groq_model);
    }
    if (data.system_prompt !== undefined) {
      updates.push('system_prompt = ?');
      values.push(data.system_prompt);
    }
    if (data.analysis_prompt_template !== undefined) {
      updates.push('analysis_prompt_template = ?');
      values.push(data.analysis_prompt_template);
    }
    if (data.is_enabled !== undefined) {
      updates.push('is_enabled = ?');
      values.push(data.is_enabled ? 1 : 0);
    }
    if (data.auto_run_enabled !== undefined) {
      updates.push('auto_run_enabled = ?');
      values.push(data.auto_run_enabled ? 1 : 0);
    }
    if (data.auto_run_interval_hours !== undefined) {
      updates.push('auto_run_interval_hours = ?');
      values.push(Math.max(1, Math.min(168, data.auto_run_interval_hours)));
    }
    if (data.max_predictions_per_run !== undefined) {
      updates.push('max_predictions_per_run = ?');
      values.push(Math.max(1, Math.min(50, data.max_predictions_per_run)));
    }
    if (data.default_expiry_hours !== undefined) {
      updates.push('default_expiry_hours = ?');
      values.push(Math.max(1, Math.min(720, data.default_expiry_hours)));
    }

    if (updates.length > 0) {
      values.push(1);
      await pool.execute(
        `UPDATE ai_config SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    return this.get();
  }

  static async updateLastAutoRun(): Promise<void> {
    await pool.execute('UPDATE ai_config SET last_auto_run_at = NOW() WHERE id = 1');
  }
}
