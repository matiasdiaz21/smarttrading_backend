import pool from '../config/database';

export interface AiPredictionRow {
  id: number;
  asset_id: number;
  symbol: string;
  side: 'LONG' | 'SHORT';
  timeframe: '1h' | '4h';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  confidence: number;
  reasoning: string | null;
  status: 'pending' | 'active' | 'won' | 'lost' | 'expired' | 'cancelled';
  result_price: number | null;
  result_pnl_percent: number | null;
  price_at_prediction: number | null;
  expires_at: Date;
  resolved_at: Date | null;
  resolved_by: 'auto' | 'admin' | null;
  groq_model: string | null;
  groq_tokens_used: number | null;
  raw_ai_response: string | null;
  created_at: Date;
}

export interface AiPredictionStats {
  total: number;
  active: number;
  won: number;
  lost: number;
  expired: number;
  winrate: number;
  avg_confidence: number;
  avg_pnl_percent: number;
}

export class AiPredictionModel {
  static async create(data: {
    asset_id: number;
    symbol: string;
    side: 'LONG' | 'SHORT';
    timeframe: '1h' | '4h';
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    confidence: number;
    reasoning: string | null;
    price_at_prediction: number | null;
    expires_at: Date;
    groq_model: string | null;
    groq_tokens_used: number | null;
    raw_ai_response: string | null;
  }): Promise<number> {
    const [result] = await pool.execute(
      `INSERT INTO ai_predictions 
       (asset_id, symbol, side, timeframe, entry_price, stop_loss, take_profit, confidence, reasoning, status, price_at_prediction, expires_at, groq_model, groq_tokens_used, raw_ai_response) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      [
        data.asset_id, data.symbol, data.side, data.timeframe,
        data.entry_price, data.stop_loss, data.take_profit, data.confidence,
        data.reasoning, data.price_at_prediction, data.expires_at,
        data.groq_model, data.groq_tokens_used, data.raw_ai_response,
      ]
    );
    return (result as any).insertId;
  }

  static async findAll(filters?: {
    symbol?: string;
    status?: string;
    timeframe?: string;
    limit?: number;
    offset?: number;
  }): Promise<AiPredictionRow[]> {
    const conditions: string[] = [];
    const values: any[] = [];

    if (filters?.symbol) {
      conditions.push('symbol = ?');
      values.push(filters.symbol);
    }
    if (filters?.status) {
      conditions.push('status = ?');
      values.push(filters.status);
    }
    if (filters?.timeframe) {
      conditions.push('timeframe = ?');
      values.push(filters.timeframe);
    }

    let query = 'SELECT * FROM ai_predictions';
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC';

    const limit = Math.min(filters?.limit || 50, 200);
    const offset = filters?.offset || 0;
    query += ' LIMIT ? OFFSET ?';
    values.push(limit, offset);

    const [rows] = await pool.execute(query, values);
    return (rows as any[]).map(r => ({
      ...r,
      entry_price: parseFloat(r.entry_price),
      stop_loss: parseFloat(r.stop_loss),
      take_profit: parseFloat(r.take_profit),
      result_price: r.result_price ? parseFloat(r.result_price) : null,
      result_pnl_percent: r.result_pnl_percent ? parseFloat(r.result_pnl_percent) : null,
      price_at_prediction: r.price_at_prediction ? parseFloat(r.price_at_prediction) : null,
    }));
  }

  static async findById(id: number): Promise<AiPredictionRow | null> {
    const [rows] = await pool.execute('SELECT * FROM ai_predictions WHERE id = ?', [id]);
    const arr = rows as any[];
    if (arr.length === 0) return null;
    const r = arr[0];
    return {
      ...r,
      entry_price: parseFloat(r.entry_price),
      stop_loss: parseFloat(r.stop_loss),
      take_profit: parseFloat(r.take_profit),
      result_price: r.result_price ? parseFloat(r.result_price) : null,
      result_pnl_percent: r.result_pnl_percent ? parseFloat(r.result_pnl_percent) : null,
      price_at_prediction: r.price_at_prediction ? parseFloat(r.price_at_prediction) : null,
    };
  }

  static async findActive(): Promise<AiPredictionRow[]> {
    return this.findAll({ status: 'active', limit: 200 });
  }

  static async updateStatus(
    id: number,
    status: 'won' | 'lost' | 'expired' | 'cancelled',
    resolvedBy: 'auto' | 'admin',
    resultPrice?: number,
    resultPnlPercent?: number
  ): Promise<void> {
    await pool.execute(
      `UPDATE ai_predictions SET status = ?, resolved_at = NOW(), resolved_by = ?, result_price = ?, result_pnl_percent = ? WHERE id = ?`,
      [status, resolvedBy, resultPrice || null, resultPnlPercent || null, id]
    );
  }

  static async getStats(symbol?: string): Promise<AiPredictionStats> {
    let query = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won,
        SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost,
        SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired,
        AVG(confidence) as avg_confidence,
        AVG(CASE WHEN status IN ('won', 'lost') THEN result_pnl_percent ELSE NULL END) as avg_pnl_percent
      FROM ai_predictions
    `;
    const values: any[] = [];
    if (symbol) {
      query += ' WHERE symbol = ?';
      values.push(symbol);
    }

    const [rows] = await pool.execute(query, values);
    const r = (rows as any[])[0];
    const won = parseInt(r.won) || 0;
    const lost = parseInt(r.lost) || 0;
    const resolved = won + lost;

    return {
      total: parseInt(r.total) || 0,
      active: parseInt(r.active) || 0,
      won,
      lost,
      expired: parseInt(r.expired) || 0,
      winrate: resolved > 0 ? Math.round((won / resolved) * 10000) / 100 : 0,
      avg_confidence: Math.round(parseFloat(r.avg_confidence) || 0),
      avg_pnl_percent: Math.round((parseFloat(r.avg_pnl_percent) || 0) * 100) / 100,
    };
  }

  static async getStatsByAsset(): Promise<Array<{ symbol: string; total: number; won: number; lost: number; winrate: number }>> {
    const [rows] = await pool.execute(`
      SELECT 
        symbol,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won,
        SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost
      FROM ai_predictions
      GROUP BY symbol
      ORDER BY total DESC
    `);
    return (rows as any[]).map(r => {
      const won = parseInt(r.won) || 0;
      const lost = parseInt(r.lost) || 0;
      const resolved = won + lost;
      return {
        symbol: r.symbol,
        total: parseInt(r.total) || 0,
        won,
        lost,
        winrate: resolved > 0 ? Math.round((won / resolved) * 10000) / 100 : 0,
      };
    });
  }

  /** Expire predictions that have passed their expires_at */
  static async expireOld(): Promise<number> {
    const [result] = await pool.execute(
      `UPDATE ai_predictions SET status = 'expired', resolved_at = NOW(), resolved_by = 'auto' WHERE status = 'active' AND expires_at < NOW()`
    );
    return (result as any).affectedRows || 0;
  }
}
