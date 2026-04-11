import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { SupportTicketModel, TicketStatus } from '../models/SupportTicket';
import { SupportMessageModel } from '../models/SupportMessage';
import { NotificationModel } from '../models/Notification';

export class SupportController {
  // ─── Usuario ──────────────────────────────────────────────────────────────

  static async getMyTickets(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const tickets = await SupportTicketModel.findByUserId(req.user.userId);
      res.json(tickets);
    } catch (error: any) {
      console.error('[SupportController] getMyTickets error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  static async getActiveTicket(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const ticket = await SupportTicketModel.findActiveByUserId(req.user.userId);

      if (!ticket) {
        // Verificar cooldown de 24h post-cierre admin (incluye historial del último ticket para que el usuario vea el cierre)
        const recentClose = await SupportTicketModel.findRecentAdminClose(req.user.userId);
        if (recentClose && recentClose.closed_at) {
          const closedAt = new Date(recentClose.closed_at).getTime();
          const cooldownEndsAt = closedAt + 24 * 60 * 60 * 1000;
          const lastMessages = await SupportMessageModel.findByTicketId(recentClose.id);
          res.json({
            ticket: null,
            cooldown: true,
            cooldown_ends_at: new Date(cooldownEndsAt),
            last_closed_ticket: recentClose,
            last_ticket_messages: lastMessages,
          });
          return;
        }
        res.json({ ticket: null, cooldown: false });
        return;
      }

      const messages = await SupportMessageModel.findByTicketId(ticket.id);
      res.json({ ticket, messages, cooldown: false });
    } catch (error: any) {
      console.error('[SupportController] getActiveTicket error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  static async createTicket(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const { message } = req.body;
      if (!message || typeof message !== 'string' || message.trim().length < 5) {
        res.status(400).json({ error: 'El mensaje debe tener al menos 5 caracteres' });
        return;
      }

      // Verificar ticket activo existente
      const active = await SupportTicketModel.findActiveByUserId(req.user.userId);
      if (active) {
        res.status(409).json({ error: 'Ya tienes un ticket de soporte activo', ticket_id: active.id });
        return;
      }

      // Verificar cooldown de 24h
      const recentClose = await SupportTicketModel.findRecentAdminClose(req.user.userId);
      if (recentClose && recentClose.closed_at) {
        const closedAt = new Date(recentClose.closed_at).getTime();
        const cooldownEndsAt = closedAt + 24 * 60 * 60 * 1000;
        if (Date.now() < cooldownEndsAt) {
          res.status(429).json({
            error: 'Debes esperar 24 horas para abrir un nuevo ticket',
            cooldown_ends_at: new Date(cooldownEndsAt),
          });
          return;
        }
      }

      const ticketId = await SupportTicketModel.create(req.user.userId);
      await SupportMessageModel.create(ticketId, 'user', message.trim());

      const ticket = await SupportTicketModel.findById(ticketId);
      const messages = await SupportMessageModel.findByTicketId(ticketId);

      console.log(`[SupportController] ✅ Ticket #${ticketId} creado por usuario ${req.user.userId}`);
      res.status(201).json({ ticket, messages });
    } catch (error: any) {
      console.error('[SupportController] createTicket error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  static async getTicketMessages(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const ticketId = parseInt(req.params.id);
      const ticket = await SupportTicketModel.findById(ticketId);

      if (!ticket) { res.status(404).json({ error: 'Ticket no encontrado' }); return; }
      if (ticket.user_id !== req.user.userId) { res.status(403).json({ error: 'Forbidden' }); return; }

      const messages = await SupportMessageModel.findByTicketId(ticketId);
      res.json({ ticket, messages });
    } catch (error: any) {
      console.error('[SupportController] getTicketMessages error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  static async addUserMessage(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const ticketId = parseInt(req.params.id);
      const { message } = req.body;

      if (!message || typeof message !== 'string' || message.trim().length < 1) {
        res.status(400).json({ error: 'El mensaje no puede estar vacío' });
        return;
      }

      const ticket = await SupportTicketModel.findById(ticketId);
      if (!ticket) { res.status(404).json({ error: 'Ticket no encontrado' }); return; }
      if (ticket.user_id !== req.user.userId) { res.status(403).json({ error: 'Forbidden' }); return; }
      if (ticket.status === 'closed') { res.status(400).json({ error: 'El ticket está cerrado' }); return; }

      await SupportMessageModel.create(ticketId, 'user', message.trim());

      // Si el ticket estaba answered, regresa a open al responder el usuario
      if (ticket.status === 'answered') {
        await SupportTicketModel.updateStatus(ticketId, 'open');
      }

      const messages = await SupportMessageModel.findByTicketId(ticketId);
      const updatedTicket = await SupportTicketModel.findById(ticketId);
      res.json({ ticket: updatedTicket, messages });
    } catch (error: any) {
      console.error('[SupportController] addUserMessage error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  static async closeTicketByUser(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const ticketId = parseInt(req.params.id);
      const ticket = await SupportTicketModel.findById(ticketId);

      if (!ticket) { res.status(404).json({ error: 'Ticket no encontrado' }); return; }
      if (ticket.user_id !== req.user.userId) { res.status(403).json({ error: 'Forbidden' }); return; }
      if (ticket.status === 'closed') { res.status(400).json({ error: 'El ticket ya está cerrado' }); return; }

      await SupportTicketModel.updateStatus(ticketId, 'closed', false);
      console.log(`[SupportController] ✅ Ticket #${ticketId} cerrado por usuario ${req.user.userId}`);
      res.json({ success: true, message: 'Ticket cerrado' });
    } catch (error: any) {
      console.error('[SupportController] closeTicketByUser error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // ─── Admin ────────────────────────────────────────────────────────────────

  static async adminListTickets(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const status = req.query.status as TicketStatus | undefined;
      const validStatuses: TicketStatus[] = ['open', 'answered', 'closed'];
      const filteredStatus = status && validStatuses.includes(status) ? status : undefined;

      const tickets = await SupportTicketModel.findAllForAdmin(filteredStatus);
      res.json(tickets);
    } catch (error: any) {
      console.error('[SupportController] adminListTickets error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  static async adminGetTicket(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const ticketId = parseInt(req.params.id);
      const ticket = await SupportTicketModel.findByIdWithUser(ticketId);
      if (!ticket) { res.status(404).json({ error: 'Ticket no encontrado' }); return; }

      const messages = await SupportMessageModel.findByTicketId(ticketId);
      res.json({ ticket, messages });
    } catch (error: any) {
      console.error('[SupportController] adminGetTicket error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  static async adminReply(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const ticketId = parseInt(req.params.id);
      const { message } = req.body;

      if (!message || typeof message !== 'string' || message.trim().length < 1) {
        res.status(400).json({ error: 'El mensaje no puede estar vacío' });
        return;
      }

      const ticket = await SupportTicketModel.findById(ticketId);
      if (!ticket) { res.status(404).json({ error: 'Ticket no encontrado' }); return; }
      if (ticket.status === 'closed') { res.status(400).json({ error: 'El ticket está cerrado' }); return; }

      await SupportMessageModel.create(ticketId, 'admin', message.trim());
      await SupportTicketModel.updateStatus(ticketId, 'answered');

      // Notificación campanita al usuario
      await NotificationModel.create(
        ticket.user_id,
        'system',
        'Soporte',
        'El administrador respondió tu ticket de soporte',
        'info',
        { ticket_id: ticketId }
      );

      const messages = await SupportMessageModel.findByTicketId(ticketId);
      const updatedTicket = await SupportTicketModel.findByIdWithUser(ticketId);

      console.log(`[SupportController] ✅ Admin respondió ticket #${ticketId}`);
      res.json({ ticket: updatedTicket, messages });
    } catch (error: any) {
      console.error('[SupportController] adminReply error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  static async adminCloseTicket(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const ticketId = parseInt(req.params.id);
      const ticket = await SupportTicketModel.findById(ticketId);
      if (!ticket) { res.status(404).json({ error: 'Ticket no encontrado' }); return; }
      if (ticket.status === 'closed') { res.status(400).json({ error: 'El ticket ya está cerrado' }); return; }

      await SupportTicketModel.updateStatus(ticketId, 'closed', true);
      console.log(`[SupportController] ✅ Admin cerró ticket #${ticketId}`);
      res.json({ success: true, message: 'Ticket cerrado' });
    } catch (error: any) {
      console.error('[SupportController] adminCloseTicket error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  static async adminReopenTicket(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const ticketId = parseInt(req.params.id);
      const ticket = await SupportTicketModel.findById(ticketId);
      if (!ticket) { res.status(404).json({ error: 'Ticket no encontrado' }); return; }
      if (ticket.status !== 'closed') { res.status(400).json({ error: 'El ticket no está cerrado' }); return; }

      await SupportTicketModel.updateStatus(ticketId, 'open', false);
      console.log(`[SupportController] ✅ Admin reabrió ticket #${ticketId}`);
      res.json({ success: true, message: 'Ticket reabierto' });
    } catch (error: any) {
      console.error('[SupportController] adminReopenTicket error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  static async adminFlagConflictive(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const ticketId = parseInt(req.params.id);
      const ticket = await SupportTicketModel.findById(ticketId);
      if (!ticket) { res.status(404).json({ error: 'Ticket no encontrado' }); return; }

      const newValue = await SupportTicketModel.toggleConflictiveFlag(ticketId);
      console.log(`[SupportController] ✅ Ticket #${ticketId} conflictivo=${newValue}`);
      res.json({ success: true, is_conflictive_flag: newValue });
    } catch (error: any) {
      console.error('[SupportController] adminFlagConflictive error:', error);
      res.status(500).json({ error: error.message });
    }
  }
}
