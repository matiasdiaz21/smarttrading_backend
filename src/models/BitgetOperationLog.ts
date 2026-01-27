import pool from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface BitgetOperationLog {
  id: number;
  user_id: number;
  strategy_id: number | null;
  symbol: string;
  operation_type: string;
  http_method: string;
  endpoint: string;
  full_url: string;
  request_payload: any;
  request_headers: any;
  response_data: any;
  response_status: number | null;
  success: boolean;
  is_reviewed: boolean;
  error_message: string | null;
  order_id: string | null;
  client_oid: string | null;
  created_at: string;
}

export interface BitgetOperationLogWithDetails extends BitgetOperationLog {
  user_email: string;
  strategy_name: string | null;
}

// Función helper para parsear JSON de forma segura
function safeJsonParse(value: any): any {
  if (value === null || value === undefined) return null;
  
  if (typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value)) {
    if (value.toString && value.toString() === '[object Object]') {
      return null;
    }
    return value;
  }
  
  if (Buffer.isBuffer(value)) {
    value = value.toString('utf8');
  }
  
  if (typeof value === 'string') {
    if (value === '[object Object]' || value.trim() === '[object Object]') {
      return null;
    }
    
    if (value.trim() === '') {
      return null;
    }
    
    try {
      return JSON.parse(value);
    } catch (e) {
      console.warn(`[BitgetOperationLog] Error parsing JSON: ${value.substring(0, 100)}`);
      return null;
    }
  }
  
  return value;
}

// Función helper para serializar de forma segura
function safeJsonStringify(value: any): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  
  if (typeof value === 'string') {
    if (value === '[object Object]' || value.trim() === '[object Object]') {
      return null;
    }
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  
  try {
    return JSON.stringify(value);
  } catch (e) {
    console.warn(`[BitgetOperationLog] Error stringifying value:`, e);
    return null;
  }
}

class BitgetOperationLogModel {
  async create(
    userId: number,
    strategyId: number | null,
    symbol: string,
    operationType: string,
    httpMethod: string,
    endpoint: string,
    fullUrl: string,
    requestPayload: any,
    requestHeaders: any,
    responseData: any,
    responseStatus: number | null,
    success: boolean,
    errorMessage: string | null,
    orderId: string | null = null,
    clientOid: string | null = null
  ): Promise<number> {
    // Marcar automáticamente como revisado si la operación fue exitosa (200 y success=true)
    const isReviewed = responseStatus === 200 && success === true;
    
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO bitget_operation_logs 
       (user_id, strategy_id, symbol, operation_type, http_method, endpoint, full_url, 
        request_payload, request_headers, response_data, response_status, success, 
        is_reviewed, error_message, order_id, client_oid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        strategyId || null,
        symbol,
        operationType,
        httpMethod,
        endpoint,
        fullUrl,
        safeJsonStringify(requestPayload),
        safeJsonStringify(requestHeaders),
        safeJsonStringify(responseData),
        responseStatus || null,
        success,
        isReviewed ? 1 : 0, // Marcar como revisado automáticamente si es exitoso
        errorMessage || null,
        orderId || null,
        clientOid || null,
      ]
    );
    return result.insertId;
  }

  async getAll(limit: number = 100, reviewed?: boolean): Promise<BitgetOperationLogWithDetails[]> {
    const limitInt = Math.max(1, Math.min(1000, parseInt(String(limit), 10) || 100));
    
    if (!Number.isInteger(limitInt) || limitInt < 1 || limitInt > 1000) {
      throw new Error('Invalid limit value');
    }
    
    let query = `SELECT 
        bol.*,
        u.email as user_email,
        s.name as strategy_name
       FROM bitget_operation_logs bol
       LEFT JOIN users u ON bol.user_id = u.id
       LEFT JOIN strategies s ON bol.strategy_id = s.id`;
    
    const params: any[] = [];
    
    if (reviewed !== undefined) {
      query += ` WHERE bol.is_reviewed = ?`;
      params.push(reviewed ? 1 : 0);
    }
    
    query += ` ORDER BY bol.created_at DESC LIMIT ${limitInt}`;
    
    const [rows] = await pool.execute<RowDataPacket[]>(query, params);

    return rows.map((row) => ({
      ...row,
      request_payload: safeJsonParse(row.request_payload),
      request_headers: safeJsonParse(row.request_headers),
      response_data: safeJsonParse(row.response_data),
    })) as BitgetOperationLogWithDetails[];
  }

  async getBySymbol(symbol: string, limit: number = 50, reviewed?: boolean): Promise<BitgetOperationLogWithDetails[]> {
    const limitInt = Math.max(1, Math.min(1000, parseInt(String(limit), 10) || 50));
    
    let query = `SELECT 
        bol.*,
        u.email as user_email,
        s.name as strategy_name
       FROM bitget_operation_logs bol
       LEFT JOIN users u ON bol.user_id = u.id
       LEFT JOIN strategies s ON bol.strategy_id = s.id
       WHERE bol.symbol = ?`;
    
    const params: any[] = [symbol];
    
    if (reviewed !== undefined) {
      query += ` AND bol.is_reviewed = ?`;
      params.push(reviewed ? 1 : 0);
    }
    
    query += ` ORDER BY bol.created_at DESC LIMIT ${limitInt}`;
    
    const [rows] = await pool.execute<RowDataPacket[]>(query, params);

    return rows.map((row) => ({
      ...row,
      request_payload: safeJsonParse(row.request_payload),
      request_headers: safeJsonParse(row.request_headers),
      response_data: safeJsonParse(row.response_data),
    })) as BitgetOperationLogWithDetails[];
  }

  async getByUser(userId: number, limit: number = 50): Promise<BitgetOperationLog[]> {
    const limitInt = Math.max(1, Math.min(1000, parseInt(String(limit), 10) || 50));
    
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM bitget_operation_logs
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ${limitInt}`,
      [userId]
    );

    return rows.map((row) => ({
      ...row,
      request_payload: safeJsonParse(row.request_payload),
      request_headers: safeJsonParse(row.request_headers),
      response_data: safeJsonParse(row.response_data),
    })) as BitgetOperationLog[];
  }

  async markAsReviewed(id: number): Promise<void> {
    await pool.execute(
      'UPDATE bitget_operation_logs SET is_reviewed = true WHERE id = ?',
      [id]
    );
  }

  async markAsUnreviewed(id: number): Promise<void> {
    await pool.execute(
      'UPDATE bitget_operation_logs SET is_reviewed = false WHERE id = ?',
      [id]
    );
  }
}

export default new BitgetOperationLogModel();
