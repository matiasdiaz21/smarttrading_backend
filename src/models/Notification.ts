import pool from '../config/database';

export type NotificationType = 
  | 'trade_executed' 
  | 'trade_failed' 
  | 'tp_failed' 
  | 'sl_failed' 
  | 'tp_sl_failed' 
  | 'position_warning' 
  | 'system';

export type NotificationSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface Notification {
  id: number;
  user_id: number;
  type: NotificationType;
  title: string;
  message: string;
  severity: NotificationSeverity;
  is_read: boolean;
  metadata: any;
  created_at: Date;
  read_at: Date | null;
}

export class NotificationModel {
  static async create(
    userId: number,
    type: NotificationType,
    title: string,
    message: string,
    severity: NotificationSeverity,
    metadata?: any
  ): Promise<number> {
    try {
      const [result] = await pool.execute(
        `INSERT INTO notifications (user_id, type, title, message, severity, metadata) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, type, title, message, severity, metadata ? JSON.stringify(metadata) : null]
      );
      const notificationId = (result as any).insertId;
      console.log(`[NotificationModel] ✅ Notificación creada con ID ${notificationId} para usuario ${userId}: ${title}`);
      return notificationId;
    } catch (error: any) {
      console.error(`[NotificationModel] ❌ Error al crear notificación:`, error);
      throw error;
    }
  }

  static async findByUserId(
    userId: number,
    limit: number = 50,
    offset: number = 0,
    unreadOnly: boolean = false
  ): Promise<Notification[]> {
    try {
      // Asegurar que limit y offset sean enteros
      const limitInt = Math.max(1, Math.floor(limit));
      const offsetInt = Math.max(0, Math.floor(offset));
      
      let query = 'SELECT * FROM notifications WHERE user_id = ?';
      const params: any[] = [userId];
      
      if (unreadOnly) {
        query += ' AND is_read = false';
      }
      
      // Usar valores literales para LIMIT y OFFSET en lugar de parámetros preparados
      // Esto evita el error "Incorrect arguments to mysqld_stmt_execute"
      query += ` ORDER BY created_at DESC LIMIT ${limitInt} OFFSET ${offsetInt}`;
      
      const [rows] = await pool.execute(query, params);
      const notifications = rows as Notification[];
      
      // Parse metadata JSON solo si viene como string (MySQL JSON puede devolverlo ya como objeto)
      return notifications.map(n => {
        let metadata = n.metadata;
        if (metadata != null && typeof metadata === 'string') {
          try {
            metadata = JSON.parse(metadata);
          } catch {
            metadata = null;
          }
        }
        return { ...n, metadata: metadata ?? null };
      });
    } catch (error: any) {
      console.error(`[NotificationModel] ❌ Error al obtener notificaciones:`, error);
      throw error;
    }
  }

  static async markAsRead(notificationId: number, userId: number): Promise<void> {
    try {
      await pool.execute(
        'UPDATE notifications SET is_read = true, read_at = NOW() WHERE id = ? AND user_id = ?',
        [notificationId, userId]
      );
      console.log(`[NotificationModel] ✅ Notificación ${notificationId} marcada como leída`);
    } catch (error: any) {
      console.error(`[NotificationModel] ❌ Error al marcar notificación como leída:`, error);
      throw error;
    }
  }

  static async markAllAsRead(userId: number): Promise<void> {
    try {
      await pool.execute(
        'UPDATE notifications SET is_read = true, read_at = NOW() WHERE user_id = ? AND is_read = false',
        [userId]
      );
      console.log(`[NotificationModel] ✅ Todas las notificaciones marcadas como leídas para usuario ${userId}`);
    } catch (error: any) {
      console.error(`[NotificationModel] ❌ Error al marcar todas las notificaciones como leídas:`, error);
      throw error;
    }
  }

  static async getUnreadCount(userId: number): Promise<number> {
    try {
      const [rows] = await pool.execute(
        'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = false',
        [userId]
      );
      const result = rows as any[];
      return result[0]?.count || 0;
    } catch (error: any) {
      console.error(`[NotificationModel] ❌ Error al obtener conteo de notificaciones no leídas:`, error);
      throw error;
    }
  }

  static async deleteOldNotifications(daysOld: number = 30): Promise<number> {
    try {
      const [result] = await pool.execute(
        'DELETE FROM notifications WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
        [daysOld]
      );
      const deletedCount = (result as any).affectedRows;
      console.log(`[NotificationModel] 🗑️ ${deletedCount} notificaciones antiguas eliminadas`);
      return deletedCount;
    } catch (error: any) {
      console.error(`[NotificationModel] ❌ Error al eliminar notificaciones antiguas:`, error);
      throw error;
    }
  }
}
