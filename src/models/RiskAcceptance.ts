import pool from '../config/database';

export interface RiskAcceptance {
  id: number;
  user_id: number;
  strategy_id: number;
  accepted_at: Date;
  ip_address: string | null;
  user_agent: string | null;
  acceptance_text: string;
}

export class RiskAcceptanceModel {
  static async create(
    userId: number,
    strategyId: number,
    acceptanceText: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<number> {
    try {
      const [result] = await pool.execute(
        `INSERT INTO risk_acceptance (user_id, strategy_id, acceptance_text, ip_address, user_agent) 
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE 
         accepted_at = CURRENT_TIMESTAMP,
         ip_address = VALUES(ip_address),
         user_agent = VALUES(user_agent),
         acceptance_text = VALUES(acceptance_text)`,
        [userId, strategyId, acceptanceText, ipAddress || null, userAgent || null]
      );
      const acceptanceId = (result as any).insertId;
      console.log(`[RiskAcceptanceModel] ✅ Aceptación de riesgo registrada: User ${userId}, Strategy ${strategyId}`);
      return acceptanceId;
    } catch (error: any) {
      console.error(`[RiskAcceptanceModel] ❌ Error al registrar aceptación de riesgo:`, error);
      throw error;
    }
  }

  static async hasAccepted(userId: number, strategyId: number): Promise<boolean> {
    try {
      const [rows] = await pool.execute(
        'SELECT id FROM risk_acceptance WHERE user_id = ? AND strategy_id = ?',
        [userId, strategyId]
      );
      const result = rows as any[];
      return result.length > 0;
    } catch (error: any) {
      console.error(`[RiskAcceptanceModel] ❌ Error al verificar aceptación de riesgo:`, error);
      throw error;
    }
  }

  static async findByUserId(userId: number): Promise<RiskAcceptance[]> {
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM risk_acceptance WHERE user_id = ? ORDER BY accepted_at DESC',
        [userId]
      );
      return rows as RiskAcceptance[];
    } catch (error: any) {
      console.error(`[RiskAcceptanceModel] ❌ Error al obtener aceptaciones de riesgo:`, error);
      throw error;
    }
  }

  static async findByUserAndStrategy(userId: number, strategyId: number): Promise<RiskAcceptance | null> {
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM risk_acceptance WHERE user_id = ? AND strategy_id = ?',
        [userId, strategyId]
      );
      const result = rows as RiskAcceptance[];
      return result.length > 0 ? result[0] : null;
    } catch (error: any) {
      console.error(`[RiskAcceptanceModel] ❌ Error al obtener aceptación de riesgo:`, error);
      throw error;
    }
  }
}
