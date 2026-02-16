import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { StrategyModel } from '../models/Strategy';
import crypto from 'crypto';

function normalizeStrategy(s: any) {
  if (!s) return s;
  const allowed = s.allowed_symbols;
  if (typeof allowed === 'string') {
    try {
      s.allowed_symbols = JSON.parse(allowed);
    } catch {
      s.allowed_symbols = null;
    }
  }
  if (Array.isArray(s.allowed_symbols) && !s.allowed_symbols.length) s.allowed_symbols = null;
  return s;
}

export class StrategyController {
  static async list(req: AuthRequest, res: Response): Promise<void> {
    try {
      const includeInactive = req.user?.role === 'admin';
      const strategies = await StrategyModel.findAll(includeInactive);
      const normalized = (strategies as any[]).map(normalizeStrategy);

      res.json(normalized);
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

      res.json(normalizeStrategy(strategy));
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

      const { name, description, warnings, leverage, allowed_symbols, category } = req.body;

      if (!name) {
        res.status(400).json({ error: 'Name is required' });
        return;
      }

      const leverageValue = leverage ? Math.max(1, Math.min(125, parseInt(String(leverage), 10) || 10)) : 10;
      const webhookSecret = crypto.randomBytes(32).toString('hex');
      const allowedSymbols = Array.isArray(allowed_symbols)
        ? allowed_symbols.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim().toUpperCase())
        : null;
      const categoryValue = typeof category === 'string' && category.trim() ? category.trim() : 'crypto';

      const strategyId = await StrategyModel.create(
        name,
        description || null,
        warnings || null,
        webhookSecret,
        req.user.userId,
        leverageValue,
        allowedSymbols?.length ? allowedSymbols : null,
        categoryValue
      );

      const strategy = await StrategyModel.findById(strategyId);

      res.status(201).json(normalizeStrategy(strategy));
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
      const { name, description, warnings, is_active, leverage, allowed_symbols, category } = req.body;

      const strategy = await StrategyModel.findById(parseInt(id));
      if (!strategy) {
        res.status(404).json({ error: 'Strategy not found' });
        return;
      }

      // Validar leverage si se proporciona (entre 1 y 125)
      const leverageValue = leverage !== undefined 
        ? Math.max(1, Math.min(125, parseInt(String(leverage), 10) || 10))
        : undefined;

      const allowedSymbols = allowed_symbols !== undefined
        ? (Array.isArray(allowed_symbols)
            ? allowed_symbols.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim().toUpperCase())
            : null)
        : undefined;
      const categoryValue = category !== undefined
        ? (typeof category === 'string' && category.trim() ? category.trim() : null)
        : undefined;

      await StrategyModel.update(
        parseInt(id),
        name,
        description,
        warnings,
        is_active !== undefined ? Boolean(is_active) : undefined,
        leverageValue,
        allowedSymbols,
        categoryValue
      );

      const updated = await StrategyModel.findById(parseInt(id));
      res.json(normalizeStrategy(updated));
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

