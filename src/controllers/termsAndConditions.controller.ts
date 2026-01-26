import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { TermsAndConditionsModel } from '../models/TermsAndConditions';

export class TermsAndConditionsController {
  // Obtener términos activos (público)
  static async getActive(req: Request, res: Response): Promise<void> {
    try {
      const terms = await TermsAndConditionsModel.findActive();
      
      if (!terms) {
        res.status(404).json({ error: 'No hay términos y condiciones disponibles' });
        return;
      }

      res.json(terms);
    } catch (error: any) {
      console.error('[TermsController] Error al obtener términos activos:', error);
      res.status(500).json({ error: error.message || 'Error al obtener términos y condiciones' });
    }
  }

  // Obtener todos los términos (admin)
  static async getAll(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }

      const terms = await TermsAndConditionsModel.findAll();
      res.json(terms);
    } catch (error: any) {
      console.error('[TermsController] Error al obtener todos los términos:', error);
      res.status(500).json({ error: error.message || 'Error al obtener términos y condiciones' });
    }
  }

  // Obtener términos por ID (admin)
  static async getById(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: 'ID inválido' });
        return;
      }

      const terms = await TermsAndConditionsModel.findById(id);
      if (!terms) {
        res.status(404).json({ error: 'Términos y condiciones no encontrados' });
        return;
      }

      res.json(terms);
    } catch (error: any) {
      console.error('[TermsController] Error al obtener términos por ID:', error);
      res.status(500).json({ error: error.message || 'Error al obtener términos y condiciones' });
    }
  }

  // Crear nuevos términos (admin)
  static async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }

      const { title, content } = req.body;

      if (!title || !content) {
        res.status(400).json({ error: 'Título y contenido son requeridos' });
        return;
      }

      if (typeof title !== 'string' || typeof content !== 'string') {
        res.status(400).json({ error: 'Título y contenido deben ser texto' });
        return;
      }

      if (title.trim().length === 0 || content.trim().length === 0) {
        res.status(400).json({ error: 'Título y contenido no pueden estar vacíos' });
        return;
      }

      const terms = await TermsAndConditionsModel.create(
        title.trim(),
        content.trim(),
        req.user.userId
      );

      res.status(201).json(terms);
    } catch (error: any) {
      console.error('[TermsController] Error al crear términos:', error);
      res.status(500).json({ error: error.message || 'Error al crear términos y condiciones' });
    }
  }

  // Actualizar términos (admin)
  static async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: 'ID inválido' });
        return;
      }

      const { title, content } = req.body;

      if (!title || !content) {
        res.status(400).json({ error: 'Título y contenido son requeridos' });
        return;
      }

      if (typeof title !== 'string' || typeof content !== 'string') {
        res.status(400).json({ error: 'Título y contenido deben ser texto' });
        return;
      }

      if (title.trim().length === 0 || content.trim().length === 0) {
        res.status(400).json({ error: 'Título y contenido no pueden estar vacíos' });
        return;
      }

      const terms = await TermsAndConditionsModel.update(
        id,
        title.trim(),
        content.trim()
      );

      res.json(terms);
    } catch (error: any) {
      console.error('[TermsController] Error al actualizar términos:', error);
      res.status(500).json({ error: error.message || 'Error al actualizar términos y condiciones' });
    }
  }

  // Activar términos (admin)
  static async setActive(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: 'ID inválido' });
        return;
      }

      await TermsAndConditionsModel.setActive(id);
      res.json({ message: 'Términos y condiciones activados correctamente' });
    } catch (error: any) {
      console.error('[TermsController] Error al activar términos:', error);
      res.status(500).json({ error: error.message || 'Error al activar términos y condiciones' });
    }
  }

  // Eliminar términos (admin)
  static async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: 'ID inválido' });
        return;
      }

      await TermsAndConditionsModel.delete(id);
      res.json({ message: 'Términos y condiciones eliminados correctamente' });
    } catch (error: any) {
      console.error('[TermsController] Error al eliminar términos:', error);
      res.status(500).json({ error: error.message || 'Error al eliminar términos y condiciones' });
    }
  }
}
