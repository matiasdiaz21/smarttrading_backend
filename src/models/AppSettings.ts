import pool from '../config/database';

export interface AppSettingsRow {
  id: number;
  free_trial_enabled: boolean;
  free_trial_days: number;
}

export class AppSettingsModel {
  static async get(): Promise<AppSettingsRow> {
    const [rows] = await pool.execute(
      'SELECT id, free_trial_enabled, free_trial_days FROM app_settings WHERE id = 1'
    );
    const arr = rows as AppSettingsRow[];
    if (arr.length === 0) {
      return {
        id: 1,
        free_trial_enabled: false,
        free_trial_days: 7,
      };
    }
    return arr[0];
  }

  static async update(freeTrialEnabled: boolean, freeTrialDays: number): Promise<void> {
    const days = Math.max(1, Math.min(365, Math.floor(freeTrialDays) || 7));
    await pool.execute(
      'UPDATE app_settings SET free_trial_enabled = ?, free_trial_days = ? WHERE id = 1',
      [!!freeTrialEnabled, days]
    );
  }
}
