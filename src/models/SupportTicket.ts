import pool from '../config/database';

export type TicketStatus = 'open' | 'answered' | 'closed';

export interface SupportTicket {
  id: number;
  user_id: number;
  status: TicketStatus;
  is_conflictive_flag: boolean;
  closed_by_admin: boolean;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

export interface SupportTicketWithUser extends SupportTicket {
  user_email: string;
  user_uuid: string;
  first_message?: string;
}

export class SupportTicketModel {
  static async create(userId: number): Promise<number> {
    const [result] = await pool.execute(
      'INSERT INTO support_tickets (user_id, status) VALUES (?, ?)',
      [userId, 'open']
    );
    return (result as any).insertId;
  }

  static async findById(ticketId: number): Promise<SupportTicket | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM support_tickets WHERE id = ?',
      [ticketId]
    );
    const tickets = rows as SupportTicket[];
    return tickets[0] || null;
  }

  /** Ticket con email del usuario (para panel admin) */
  static async findByIdWithUser(ticketId: number): Promise<SupportTicketWithUser | null> {
    const [rows] = await pool.execute(
      `SELECT st.*, u.email AS user_email, u.uuid AS user_uuid
       FROM support_tickets st
       INNER JOIN users u ON u.id = st.user_id
       WHERE st.id = ?`,
      [ticketId]
    );
    const tickets = rows as SupportTicketWithUser[];
    return tickets[0] || null;
  }

  static async findByUserId(userId: number): Promise<SupportTicket[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    return rows as SupportTicket[];
  }

  static async findActiveByUserId(userId: number): Promise<SupportTicket | null> {
    const [rows] = await pool.execute(
      "SELECT * FROM support_tickets WHERE user_id = ? AND status IN ('open', 'answered') LIMIT 1",
      [userId]
    );
    const tickets = rows as SupportTicket[];
    return tickets[0] || null;
  }

  /** Devuelve el último ticket cerrado por admin en las últimas 24h */
  static async findRecentAdminClose(userId: number): Promise<SupportTicket | null> {
    const [rows] = await pool.execute(
      `SELECT * FROM support_tickets
       WHERE user_id = ? AND closed_by_admin = 1 AND closed_at > NOW() - INTERVAL 24 HOUR
       ORDER BY closed_at DESC LIMIT 1`,
      [userId]
    );
    const tickets = rows as SupportTicket[];
    return tickets[0] || null;
  }

  static async updateStatus(
    ticketId: number,
    status: TicketStatus,
    closedByAdmin: boolean = false
  ): Promise<void> {
    const closedAt = status === 'closed' ? new Date() : null;
    await pool.execute(
      'UPDATE support_tickets SET status = ?, closed_by_admin = ?, closed_at = ?, updated_at = NOW() WHERE id = ?',
      [status, closedByAdmin ? 1 : 0, closedAt, ticketId]
    );
  }

  static async toggleConflictiveFlag(ticketId: number): Promise<boolean> {
    const [rows] = await pool.execute(
      'SELECT is_conflictive_flag FROM support_tickets WHERE id = ?',
      [ticketId]
    );
    const tickets = rows as SupportTicket[];
    if (!tickets[0]) return false;
    const newValue = !tickets[0].is_conflictive_flag;
    await pool.execute(
      'UPDATE support_tickets SET is_conflictive_flag = ?, updated_at = NOW() WHERE id = ?',
      [newValue ? 1 : 0, ticketId]
    );
    return newValue;
  }

  /** Lista todos los tickets para el admin con email de usuario y primer mensaje */
  static async findAllForAdmin(status?: TicketStatus): Promise<SupportTicketWithUser[]> {
    let query = `
      SELECT
        st.*,
        u.email AS user_email,
        u.uuid AS user_uuid,
        (
          SELECT sm.message FROM support_messages sm
          WHERE sm.ticket_id = st.id ORDER BY sm.created_at ASC LIMIT 1
        ) AS first_message
      FROM support_tickets st
      INNER JOIN users u ON u.id = st.user_id
    `;
    const params: any[] = [];

    if (status) {
      query += ' WHERE st.status = ?';
      params.push(status);
    }

    query += ' ORDER BY st.created_at DESC';

    const [rows] = await pool.execute(query, params);
    return rows as SupportTicketWithUser[];
  }
}
