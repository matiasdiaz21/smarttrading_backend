import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { StrategyModel } from '../models/Strategy';
import crypto from 'crypto';

export class StrategyController {
  static async list(req: AuthRequest, res: Response): Promise<void> {
    try {
      const includeInactive = req.user?.role === 'admin';
      const strategies = await StrategyModel.findAll(includeInactive);

      res.json(strategies);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const strategy = await StrategyModel.findById(parseInt(id));

      if (!strategy) {
        res.status(404).json({ error: 'Strategy not found' });
        return;
      }

      res.json(strategy);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }

      const { name, description, warnings, leverage } = req.body;

      if (!name) {
        res.status(400).json({ error: 'Name is required' });
        return;
      }

      // Validar leverage (entre 1 y 125, por defecto 10)
      const leverageValue = leverage ? Math.max(1, Math.min(125, parseInt(String(leverage), 10) || 10)) : 10;

      // Generar secret para el webhook
      const webhookSecret = crypto.randomBytes(32).toString('hex');

      const strategyId = await StrategyModel.create(
        name,
        description || null,
        warnings || null,
        webhookSecret,
        req.user.userId,
        leverageValue
      );

      const strategy = await StrategyModel.findById(strategyId);

      res.status(201).json(strategy);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }

      const { id } = req.params;
      const { name, description, warnings, is_active, leverage } = req.body;

      const strategy = await StrategyModel.findById(parseInt(id));
      if (!strategy) {
        res.status(404).json({ error: 'Strategy not found' });
        return;
      }

      // Validar leverage si se proporciona (entre 1 y 125)
      const leverageValue = leverage !== undefined 
        ? Math.max(1, Math.min(125, parseInt(String(leverage), 10) || 10))
        : undefined;

      await StrategyModel.update(
        parseInt(id),
        name,
        description,
        warnings,
        is_active !== undefined ? Boolean(is_active) : undefined,
        leverageValue
      );

      const updated = await StrategyModel.findById(parseInt(id));
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }

      const { id } = req.params;
      const strategy = await StrategyModel.findById(parseInt(id));

      if (!strategy) {
        res.status(404).json({ error: 'Strategy not found' });
        return;
      }

      await StrategyModel.delete(parseInt(id));

      res.json({ message: 'Strategy deleted successfully' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

