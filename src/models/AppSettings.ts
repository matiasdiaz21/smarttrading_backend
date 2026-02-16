import pool from '../config/database';

export interface AppSettingsRow {
  id: number;
  free_trial_enabled: boolean;
  free_trial_days: number;
  stats_strategy_ids: number[] | null;
}

export class AppSettingsModel {
  static async get(): Promise<AppSettingsRow> {
    const [rows] = await pool.execute(
      'SELECT id, free_trial_enabled, free_trial_days, stats_strategy_ids FROM app_settings WHERE id = 1'
    );
    const arr = rows as any[];
    if (arr.length === 0) {
      return {
        id: 1,
        free_trial_enabled: false,
        free_trial_days: 7,
        stats_strategy_ids: null,
      };
    }
    const row = arr[0];
    let statsIds: number[] | null = null;
    if (row.stats_strategy_ids) {
      try {
        const parsed = typeof row.stats_strategy_ids === 'string'
          ? JSON.parse(row.stats_strategy_ids)
          : row.stats_strategy_ids;
        if (Array.isArray(parsed)) {
          statsIds = parsed.map((id: any) => parseInt(String(id), 10)).filter((id: number) => !isNaN(id));
        }
      } catch { /* ignore parse errors */ }
    }
    return {
      id: row.id,
      free_trial_enabled: !!row.free_trial_enabled,
      free_trial_days: row.free_trial_days,
      stats_strategy_ids: statsIds,
    };
  }

  static async update(freeTrialEnabled: boolean, freeTrialDays: number): Promise<void> {
    const days = Math.max(1, Math.min(365, Math.floor(freeTrialDays) || 7));
    await pool.execute(
      'UPDATE app_settings SET free_trial_enabled = ?, free_trial_days = ? WHERE id = 1',
      [!!freeTrialEnabled, days]
    );
  }

  static async updateStatsStrategyIds(strategyIds: number[] | null): Promise<void> {
    const value = strategyIds && strategyIds.length > 0 ? JSON.stringify(strategyIds) : null;
    await pool.execute(
      'UPDATE app_settings SET stats_strategy_ids = ? WHERE id = 1',
      [value]
    );
  }
}
