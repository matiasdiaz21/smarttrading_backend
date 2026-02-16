import pool from '../config/database';
import { WebhookLog } from '../types';

export class WebhookLogModel {
  static async create(
    strategyId: number | null,
    payload: string,
    signature: string | null,
    status: 'success' | 'failed' | 'invalid'
  ): Promise<number> {
    const [result] = await pool.execute(
      'INSERT INTO webhook_logs (strategy_id, payload, signature, status) VALUES (?, ?, ?, ?)',
      [strategyId, payload, signature, status]
    );
    return (result as any).insertId;
  }

  static async findAll(limit = 100): Promise<WebhookLog[]> {
    // Convertir limit a entero y validar (entre 1 y 1000)
    const limitInt = Math.max(1, Math.min(1000, parseInt(String(limit), 10) || 100));
    
    // Validar que sea un entero válido
    if (!Number.isInteger(limitInt) || limitInt < 1 || limitInt > 1000) {
      throw new Error('Invalid limit value');
    }
    
    // MySQL2 puede tener problemas con LIMIT como parámetro preparado
    // Usamos execute con el número validado directamente en la query
    // La validación previa asegura que no hay riesgo de SQL injection
    const [rows] = await pool.execute(
      `SELECT * FROM webhook_logs ORDER BY processed_at DESC, id DESC LIMIT ${limitInt}`
    );
    return rows as WebhookLog[];
  }

  static async findByStrategyIds(strategyIds: number[], limit = 1000): Promise<WebhookLog[]> {
    if (!strategyIds || strategyIds.length === 0) {
      return [];
    }
    const limitInt = Math.max(1, Math.min(1000, parseInt(String(limit), 10) || 1000));
    const validIds = strategyIds.map(id => parseInt(String(id), 10)).filter(id => !isNaN(id) && Number.isInteger(id));
    if (validIds.length === 0) return [];
    const placeholders = validIds.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `SELECT * FROM webhook_logs WHERE strategy_id IN (${placeholders}) ORDER BY processed_at DESC, id DESC LIMIT ${limitInt}`,
      validIds
    );
    return rows as WebhookLog[];
  }

  static async findByStrategyId(strategyId: number, limit = 50): Promise<WebhookLog[]> {
    // Validar y convertir parámetros
    const strategyIdInt = parseInt(String(strategyId), 10);
    const limitInt = Math.max(1, Math.min(1000, parseInt(String(limit), 10) || 50));
    
    if (isNaN(strategyIdInt) || !Number.isInteger(strategyIdInt)) {
      throw new Error('Invalid strategy_id');
    }
    
    if (!Number.isInteger(limitInt) || limitInt < 1 || limitInt > 1000) {
      throw new Error('Invalid limit value');
    }
    
    // MySQL2 puede tener problemas con LIMIT como parámetro preparado
    // Usamos execute con strategy_id como parámetro y limit validado en la query
    // La validación previa asegura que no hay riesgo de SQL injection
    const [rows] = await pool.execute(
      `SELECT * FROM webhook_logs WHERE strategy_id = ? ORDER BY processed_at DESC, id DESC LIMIT ${limitInt}`,
      [strategyIdInt]
    );
    return rows as WebhookLog[];
  }

  /**
   * Verifica si existe un ENTRY previo para un trade_id específico en webhook_logs
   */
  static async hasEntryForTradeId(
    strategyId: number,
    tradeId: number | string
  ): Promise<boolean> {
    const strategyIdInt = parseInt(String(strategyId), 10);
    const tradeIdStr = String(tradeId);
    
    if (isNaN(strategyIdInt) || !Number.isInteger(strategyIdInt)) {
      return false;
    }
    
    // Buscar en webhook_logs si existe un ENTRY con el mismo trade_id
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as count 
       FROM webhook_logs 
       WHERE strategy_id = ? 
         AND JSON_EXTRACT(payload, '$.alertData.id') = ?
         AND JSON_EXTRACT(payload, '$.alertType') = 'ENTRY'
       LIMIT 1`,
      [strategyIdInt, tradeIdStr]
    );
    const result = rows as any[];
    return result[0]?.count > 0;
  }

  /**
   * Verifica si existe un ENTRY previo para un símbolo específico en webhook_logs
   */
  static async hasEntryForSymbol(
    strategyId: number,
    symbol: string
  ): Promise<boolean> {
    const strategyIdInt = parseInt(String(strategyId), 10);
    
    if (isNaN(strategyIdInt) || !Number.isInteger(strategyIdInt)) {
      return false;
    }
    
    // Buscar en webhook_logs si existe un ENTRY con el mismo símbolo
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as count 
       FROM webhook_logs 
       WHERE strategy_id = ? 
         AND JSON_EXTRACT(payload, '$.symbol') = ?
         AND JSON_EXTRACT(payload, '$.alertType') = 'ENTRY'
       LIMIT 1`,
      [strategyIdInt, symbol]
    );
    const result = rows as any[];
    return result[0]?.count > 0;
  }

  /**
   * Obtiene las últimas señales cerradas (STOP_LOSS, TAKE_PROFIT o BREAKEVEN) para estrategias a las que el usuario está suscrito
   * Solo incluye señales que tengan un ENTRY previo y un cierre (TAKE_PROFIT, STOP_LOSS o BREAKEVEN)
   * Excluye: solo ENTRY sin cierre, solo BREAKEVEN sin ENTRY
   * 
   * Requisitos:
   * - Debe tener ENTRY previo (por trade_id o symbol)
   * - Debe tener STOP_LOSS, TAKE_PROFIT o BREAKEVEN (cierre)
   * 
   * Lógica de negocio:
   * - TAKE_PROFIT = Ganado (100% del objetivo)
   * - BREAKEVEN = Ganado (50% de ganancia tomada, SL movido a entrada)
   * - STOP_LOSS sin BREAKEVEN previo = Perdido
   * - STOP_LOSS con BREAKEVEN previo = Ganado (ya se tomó 50% de ganancia)
   */
  static async hasBreakevenForTrade(
    strategyId: number,
    tradeId: string | number
  ): Promise<boolean> {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as count FROM webhook_logs
       WHERE strategy_id = ?
         AND JSON_EXTRACT(payload, '$.alertType') = 'BREAKEVEN'
         AND (
           JSON_EXTRACT(payload, '$.alertData.id') = ?
           OR JSON_EXTRACT(payload, '$.trade_id') = ?
         )
         AND status = 'success'`,
      [strategyId, String(tradeId), String(tradeId)]
    );
    const result = rows as any[];
    return result[0]?.count > 0;
  }

  static async findClosedSignalsByUserStrategies(
    strategyIds: number[],
    limit = 10
  ): Promise<WebhookLog[]> {
    if (!strategyIds || strategyIds.length === 0) {
      return [];
    }

    const limitInt = Math.max(1, Math.min(100, parseInt(String(limit), 10) || 10));
    
    if (!Number.isInteger(limitInt) || limitInt < 1 || limitInt > 100) {
      throw new Error('Invalid limit value');
    }

    // Crear placeholders para los strategy_ids
    const placeholders = strategyIds.map(() => '?').join(',');
    
    // Obtener señales cerradas: STOP_LOSS, TAKE_PROFIT o BREAKEVEN
    // Lógica de negocio:
    // - TAKE_PROFIT = trade ganado (100% objetivo alcanzado)
    // - BREAKEVEN = trade ganado (50% de ganancia tomada, SL movido a entrada)
    // - STOP_LOSS = puede ser ganado (si tuvo BREAKEVEN previo) o perdido (si no tuvo BREAKEVEN)
    const [rows] = await pool.execute(
      `SELECT DISTINCT wl.* FROM webhook_logs wl
       WHERE wl.strategy_id IN (${placeholders})
         AND JSON_EXTRACT(wl.payload, '$.alertType') IN ('STOP_LOSS', 'TAKE_PROFIT', 'BREAKEVEN')
         AND wl.status = 'success'
         AND EXISTS (
           SELECT 1 FROM webhook_logs wl_entry
           WHERE wl_entry.strategy_id = wl.strategy_id
             AND JSON_EXTRACT(wl_entry.payload, '$.alertType') = 'ENTRY'
             AND wl_entry.status = 'success'
             AND (
               -- Verificar por trade_id (alertData.id) - método preferido
               (
                 JSON_EXTRACT(wl_entry.payload, '$.alertData.id') IS NOT NULL
                 AND JSON_EXTRACT(wl_entry.payload, '$.alertData.id') = JSON_EXTRACT(wl.payload, '$.alertData.id')
               )
               OR
               (
                 JSON_EXTRACT(wl_entry.payload, '$.alertData.id') IS NOT NULL
                 AND JSON_EXTRACT(wl_entry.payload, '$.alertData.id') = JSON_EXTRACT(wl.payload, '$.trade_id')
               )
               OR
               -- Fallback: verificar por symbol si no hay trade_id
               (
                 JSON_EXTRACT(wl_entry.payload, '$.alertData.id') IS NULL
                 AND JSON_EXTRACT(wl_entry.payload, '$.symbol') = JSON_EXTRACT(wl.payload, '$.symbol')
               )
             )
         )
       ORDER BY wl.processed_at DESC 
       LIMIT ${limitInt}`,
      strategyIds
    );
    return rows as WebhookLog[];
  }

  /**
   * Busca un webhook log por trade_id (alertData.id) y symbol
   * Útil para encontrar el payload original del webhook cuando hay un error
   */
  static async findByTradeIdAndSymbol(
    strategyId: number,
    tradeId: number | string | null,
    symbol: string
  ): Promise<WebhookLog | null> {
    const strategyIdInt = parseInt(String(strategyId), 10);
    
    if (isNaN(strategyIdInt) || !Number.isInteger(strategyIdInt)) {
      console.log(`[WebhookLogModel] Invalid strategy_id: ${strategyId}`);
      return null;
    }

    // Normalizar el símbolo (remover .P si existe para búsqueda más flexible)
    const normalizedSymbol = symbol.replace(/\.P$/, '');
    const symbolWithP = symbol.endsWith('.P') ? symbol : `${symbol}.P`;
    
    console.log(`[WebhookLogModel] Buscando webhook log: strategy_id=${strategyIdInt}, trade_id=${tradeId}, symbol=${symbol}`);

    let query: string;
    let params: any[];

    // Si hay trade_id, buscar por trade_id y symbol (más preciso)
    // Usamos CAST para comparar números correctamente y JSON_UNQUOTE para strings
    if (tradeId !== null && tradeId !== undefined) {
      const tradeIdNum = parseInt(String(tradeId), 10);
      
      // Intentar múltiples variaciones de búsqueda
      // 1. Buscar con el símbolo exacto y trade_id como número
      query = `SELECT * FROM webhook_logs 
               WHERE strategy_id = ? 
                 AND CAST(JSON_EXTRACT(payload, '$.alertData.id') AS UNSIGNED) = ?
                 AND (
                   JSON_UNQUOTE(JSON_EXTRACT(payload, '$.symbol')) = ?
                   OR JSON_UNQUOTE(JSON_EXTRACT(payload, '$.symbol')) = ?
                   OR JSON_UNQUOTE(JSON_EXTRACT(payload, '$.symbol')) = ?
                 )
               ORDER BY processed_at DESC, id DESC 
               LIMIT 1`;
      params = [strategyIdInt, tradeIdNum, symbol, normalizedSymbol, symbolWithP];
    } else {
      // Si no hay trade_id, buscar solo por symbol (menos preciso)
      query = `SELECT * FROM webhook_logs 
               WHERE strategy_id = ? 
                 AND (
                   JSON_UNQUOTE(JSON_EXTRACT(payload, '$.symbol')) = ?
                   OR JSON_UNQUOTE(JSON_EXTRACT(payload, '$.symbol')) = ?
                   OR JSON_UNQUOTE(JSON_EXTRACT(payload, '$.symbol')) = ?
                 )
                 AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.alertType')) = 'ENTRY'
               ORDER BY processed_at DESC, id DESC 
               LIMIT 1`;
      params = [strategyIdInt, symbol, normalizedSymbol, symbolWithP];
    }

    try {
      const [rows] = await pool.execute(query, params);
      const result = rows as WebhookLog[];
      
      if (result.length > 0) {
        console.log(`[WebhookLogModel] ✅ Webhook log encontrado: id=${result[0].id}`);
        return result[0];
      } else {
        console.log(`[WebhookLogModel] ⚠️ No se encontró webhook log para strategy_id=${strategyIdInt}, trade_id=${tradeId}, symbol=${symbol}`);
        return null;
      }
    } catch (error: any) {
      console.error(`[WebhookLogModel] ❌ Error al buscar webhook log:`, error.message);
      console.error(`[WebhookLogModel] Query:`, query);
      console.error(`[WebhookLogModel] Params:`, params);
      return null;
    }
  }

  /**
   * Obtiene los símbolos distintos que han llegado en webhook_logs.
   * Busca en $.symbol, $.ticker y $.alertData.symbol por compatibilidad con distintos formatos de webhook.
   * @param strategyId Opcional: filtrar por estrategia
   */
  static async getDistinctSymbols(strategyId?: number): Promise<string[]> {
    const strategyFilter = strategyId !== undefined && strategyId !== null ? ' AND strategy_id = ?' : '';
    const params: any[] = [];
    if (strategyId !== undefined && strategyId !== null) {
      params.push(strategyId);
    }
    const [rows] = await pool.execute(
      `SELECT DISTINCT
        COALESCE(
          NULLIF(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.symbol')), '')), ''),
          NULLIF(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.ticker')), '')), ''),
          NULLIF(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.alertData.symbol')), '')), '')
        ) AS symbol
       FROM webhook_logs
       WHERE (
         (JSON_EXTRACT(payload, '$.symbol') IS NOT NULL AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.symbol')), '')) != '')
         OR (JSON_EXTRACT(payload, '$.ticker') IS NOT NULL AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.ticker')), '')) != '')
         OR (JSON_EXTRACT(payload, '$.alertData.symbol') IS NOT NULL AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.alertData.symbol')), '')) != '')
       )
       ${strategyFilter}
       ORDER BY symbol ASC`,
      params
    );
    const list = (rows as { symbol: string | null }[]).map((r) => {
      const raw = r.symbol || '';
      const s = raw.trim().replace(/\.P$/i, '');
      return s.toUpperCase();
    });
    return [...new Set(list)].filter(Boolean).sort();
  }

  /** Elimina un log por id. */
  static async deleteById(id: number): Promise<boolean> {
    const idInt = parseInt(String(id), 10);
    if (!Number.isInteger(idInt)) return false;
    const [result] = await pool.execute('DELETE FROM webhook_logs WHERE id = ?', [idInt]);
    return (result as any).affectedRows > 0;
  }

  /**
   * Elimina todos los logs de un trade (mismo strategy_id, symbol y trade_id en payload).
   * Acepta symbol en $.symbol, $.ticker o $.alertData.symbol y trade_id en $.alertData.id o $.trade_id.
   */
  static async deleteGroup(strategyId: number, symbol: string, tradeId: string): Promise<number> {
    const strategyIdInt = parseInt(String(strategyId), 10);
    if (!Number.isInteger(strategyIdInt)) return 0;
    const symbolNorm = String(symbol).trim().toUpperCase();
    const tradeIdStr = String(tradeId).trim();
    const [result] = await pool.execute(
      `DELETE FROM webhook_logs
       WHERE strategy_id = ?
         AND (
           UPPER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.symbol')), ''))) = ?
           OR UPPER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.ticker')), ''))) = ?
           OR UPPER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.alertData.symbol')), ''))) = ?
         )
         AND (
           TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.alertData.id')), '')) = ?
           OR TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.trade_id')), '')) = ?
         )`,
      [strategyIdInt, symbolNorm, symbolNorm, symbolNorm, tradeIdStr, tradeIdStr]
    );
    return (result as any).affectedRows || 0;
  }

  /**
   * Elimina todos los logs de un símbolo (payload con ese symbol en $.symbol, $.ticker o $.alertData.symbol).
   */
  static async deleteBySymbol(symbol: string): Promise<number> {
    const symbolNorm = String(symbol).trim().toUpperCase();
    if (!symbolNorm) return 0;
    const [result] = await pool.execute(
      `DELETE FROM webhook_logs
       WHERE (
         UPPER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.symbol')), ''))) = ?
         OR UPPER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.ticker')), ''))) = ?
         OR UPPER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.alertData.symbol')), ''))) = ?
       )`,
      [symbolNorm, symbolNorm, symbolNorm]
    );
    return (result as any).affectedRows || 0;
  }
}

