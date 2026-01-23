import pool from '../config/database';
import { encrypt, decrypt } from '../utils/encryption';

export interface NOWPaymentsCredentials {
  id: number;
  email: string | null; // encriptado
  password: string | null; // encriptado
  token: string | null; // token de autenticación
  token_expires_at: Date | null; // fecha de expiración del token
  api_key: string; // encriptado (mantener para compatibilidad)
  public_key: string; // encriptado
  api_url: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export class NOWPaymentsCredentialsModel {
  static async findActive(): Promise<NOWPaymentsCredentials | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM nowpayments_credentials WHERE is_active = true LIMIT 1'
    ) as any[];

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      email: row.email ? decrypt(row.email) : null,
      password: row.password ? decrypt(row.password) : null,
      token: row.token || null,
      token_expires_at: row.token_expires_at || null,
      api_key: decrypt(row.api_key || ''),
      public_key: decrypt(row.public_key || ''),
      api_url: row.api_url || '',
      is_active: row.is_active || false,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  static async findAll(): Promise<NOWPaymentsCredentials[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM nowpayments_credentials ORDER BY created_at DESC'
    ) as any[];

    return rows.map((row) => ({
      id: row.id,
      email: row.email ? decrypt(row.email) : null,
      password: row.password ? decrypt(row.password) : null,
      token: row.token || null,
      token_expires_at: row.token_expires_at || null,
      api_key: decrypt(row.api_key || ''),
      public_key: decrypt(row.public_key || ''),
      api_url: row.api_url || '',
      is_active: row.is_active || false,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  static async findById(id: number): Promise<NOWPaymentsCredentials | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM nowpayments_credentials WHERE id = ?',
      [id]
    ) as any[];

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      email: row.email ? decrypt(row.email) : null,
      password: row.password ? decrypt(row.password) : null,
      token: row.token || null,
      token_expires_at: row.token_expires_at || null,
      api_key: decrypt(row.api_key || ''),
      public_key: decrypt(row.public_key || ''),
      api_url: row.api_url || '',
      is_active: row.is_active || false,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  static async create(
    apiKey: string,
    publicKey: string,
    apiUrl: string,
    email?: string,
    password?: string
  ): Promise<number> {
    const encryptedApiKey = encrypt(apiKey);
    const encryptedPublicKey = encrypt(publicKey);
    const encryptedEmail = email ? encrypt(email) : null;
    const encryptedPassword = password ? encrypt(password) : null;

    // Desactivar todas las demás credenciales
    await pool.execute(
      'UPDATE nowpayments_credentials SET is_active = false'
    );

    const [result] = await pool.execute(
      'INSERT INTO nowpayments_credentials (email, password, api_key, public_key, api_url, is_active) VALUES (?, ?, ?, ?, ?, true)',
      [encryptedEmail, encryptedPassword, encryptedApiKey, encryptedPublicKey, apiUrl]
    ) as any[];

    return result.insertId;
  }

  static async update(
    id: number,
    apiKey?: string,
    publicKey?: string,
    apiUrl?: string,
    isActive?: boolean,
    email?: string,
    password?: string,
    token?: string,
    tokenExpiresAt?: Date | null
  ): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];

    if (email !== undefined) {
      updates.push('email = ?');
      values.push(email ? encrypt(email) : null);
    }

    if (password !== undefined) {
      updates.push('password = ?');
      values.push(password ? encrypt(password) : null);
    }

    if (token !== undefined) {
      updates.push('token = ?');
      values.push(token);
    }

    if (tokenExpiresAt !== undefined) {
      updates.push('token_expires_at = ?');
      values.push(tokenExpiresAt);
    }

    if (apiKey !== undefined) {
      updates.push('api_key = ?');
      values.push(encrypt(apiKey));
    }

    if (publicKey !== undefined) {
      updates.push('public_key = ?');
      values.push(encrypt(publicKey));
    }

    if (apiUrl !== undefined) {
      updates.push('api_url = ?');
      values.push(apiUrl);
    }

    if (isActive !== undefined) {
      updates.push('is_active = ?');
      values.push(isActive);

      // Si se activa, desactivar todas las demás
      if (isActive) {
        await pool.execute(
          'UPDATE nowpayments_credentials SET is_active = false WHERE id != ?',
          [id]
        );
      }
    }

    if (updates.length === 0) {
      return;
    }

    values.push(id);
    await pool.execute(
      `UPDATE nowpayments_credentials SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
  }

  static async delete(id: number): Promise<void> {
    await pool.execute('DELETE FROM nowpayments_credentials WHERE id = ?', [id]);
  }
}

