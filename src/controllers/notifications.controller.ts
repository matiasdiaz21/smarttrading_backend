import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { NotificationModel } from '../models/Notification';

export class NotificationsController {
  static async getNotifications(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const unreadOnly = req.query.unreadOnly === 'true';

      const notifications = await NotificationModel.findByUserId(
        req.user.userId,
        limit,
        offset,
        unreadOnly
      );

      res.json(notifications);
    } catch (error: any) {
      console.error('[NotificationsController] Error al obtener notificaciones:', error);
      res.status(500).json({ error: error.message });
    }
  }

  static async getUnreadCount(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const count = await NotificationModel.getUnreadCount(req.user.userId);

      res.json({ count });
    } catch (error: any) {
      console.error('[NotificationsController] Error al obtener conteo de no leídas:', error);
      res.status(500).json({ error: error.message });
    }
  }

  static async markAsRead(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      await NotificationModel.markAsRead(parseInt(id), req.user.userId);

      res.json({ success: true, message: 'Notification marked as read' });
    } catch (error: any) {
      console.error('[NotificationsController] Error al marcar como leída:', error);
      res.status(500).json({ error: error.message });
    }
  }

  static async markAllAsRead(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      await NotificationModel.markAllAsRead(req.user.userId);

      res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error: any) {
      console.error('[NotificationsController] Error al marcar todas como leídas:', error);
      res.status(500).json({ error: error.message });
    }
  }
}
