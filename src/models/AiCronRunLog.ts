import pool from '../config/database';

export interface AiCronRunLogRow {
  id: number;
  ran_at: Date;
  status: 'ran' | 'skipped';
  success: number | null;
  analyzed: number | null;
  predictions_count: number | null;
  errors_count: number | null;
  error_message: string | null;
  skip_reason: string | null;
  created_at: Date;
}

export class AiCronRunLogModel {
  static async create(data: {
    status: 'ran' | 'skipped';
    success?: boolean;
    analyzed?: number;
    predictions_count?: number;
    errors_count?: number;
    error_message?: string | null;
    skip_reason?: string | null;
  }): Promise<number> {
    const [result] = await pool.execute(
      `INSERT INTO ai_cron_run_log (status, success, analyzed, predictions_count, errors_count, error_message, skip_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.status,
        data.success != null ? (data.success ? 1 : 0) : null,
        data.analyzed ?? null,
        data.predictions_count ?? null,
        data.errors_count ?? null,
        data.error_message ?? null,
        data.skip_reason ?? null,
      ]
    );
    return (result as any).insertId;
  }

  static async getRecent(limit: number = 50): Promise<AiCronRunLogRow[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM ai_cron_run_log ORDER BY ran_at DESC LIMIT ?',
      [Math.min(limit, 100)]
    );
    return (rows as any[]).map((r: any) => ({
      ...r,
      success: r.success != null ? !!r.success : null,
    }));
  }
}
