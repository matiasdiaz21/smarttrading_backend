import pool from '../config/database';

export type SenderRole = 'user' | 'admin';

export interface SupportMessage {
  id: number;
  ticket_id: number;
  sender_role: SenderRole;
  message: string;
  created_at: Date;
}

export class SupportMessageModel {
  static async create(
    ticketId: number,
    senderRole: SenderRole,
    message: string
  ): Promise<number> {
    const [result] = await pool.execute(
      'INSERT INTO support_messages (ticket_id, sender_role, message) VALUES (?, ?, ?)',
      [ticketId, senderRole, message]
    );
    return (result as any).insertId;
  }

  static async findByTicketId(ticketId: number): Promise<SupportMessage[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC',
      [ticketId]
    );
    return rows as SupportMessage[];
  }
}
