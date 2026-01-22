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

      const { name, description } = req.body;

      if (!name) {
        res.status(400).json({ error: 'Name is required' });
        return;
      }

      // Generar secret para el webhook
      const webhookSecret = crypto.randomBytes(32).toString('hex');

      const strategyId = await StrategyModel.create(
        name,
        description || null,
        webhookSecret,
        req.user.userId
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
      const { name, description, is_active } = req.body;

      const strategy = await StrategyModel.findById(parseInt(id));
      if (!strategy) {
        res.status(404).json({ error: 'Strategy not found' });
        return;
      }

      await StrategyModel.update(
        parseInt(id),
        name,
        description,
        is_active !== undefined ? Boolean(is_active) : undefined
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

