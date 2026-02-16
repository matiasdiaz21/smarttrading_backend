import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppSettingsModel } from '../models/AppSettings';

export class SettingsController {
  /** Público: devuelve solo lo necesario para que el frontend calcule prueba gratuita. */
  static async getPublic(req: Request, res: Response): Promise<void> {
    try {
      const settings = await AppSettingsModel.get();
      res.json({
        free_trial_enabled: !!settings.free_trial_enabled,
        free_trial_days: Math.max(1, Math.min(365, settings.free_trial_days || 7)),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getAdmin(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }
      const settings = await AppSettingsModel.get();
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async updateAdmin(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }
      const { free_trial_enabled, free_trial_days } = req.body;
      await AppSettingsModel.update(
        !!free_trial_enabled,
        free_trial_days != null ? Math.max(1, Math.min(365, parseInt(String(free_trial_days), 10) || 7)) : 7
      );
      const settings = await AppSettingsModel.get();
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async updateStatsStrategies(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
      }
      const { stats_strategy_ids } = req.body;
      const ids = Array.isArray(stats_strategy_ids)
        ? stats_strategy_ids.map((id: any) => parseInt(String(id), 10)).filter((id: number) => !isNaN(id) && Number.isInteger(id))
        : null;
      await AppSettingsModel.updateStatsStrategyIds(ids && ids.length > 0 ? ids : null);
      const settings = await AppSettingsModel.get();
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
