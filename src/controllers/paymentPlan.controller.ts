import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { PaymentPlanModel } from '../models/PaymentPlan';

export class PaymentPlanController {
  static async list(req: AuthRequest, res: Response): Promise<void> {
    try {
      const includeInactive = req.user?.role === 'admin';
      const plans = await PaymentPlanModel.findAll(includeInactive);

      res.json(plans);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getActive(req: AuthRequest, res: Response): Promise<void> {
    try {
      const plans = await PaymentPlanModel.findActive();
      res.json(plans);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const plan = await PaymentPlanModel.findById(parseInt(id));

      if (!plan) {
        res.status(404).json({ error: 'Payment plan not found' });
        return;
      }

      res.json(plan);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { title, description, amount, currency, pay_currency, duration_days, features } = req.body;

      if (!title || !amount || amount <= 0) {
        res.status(400).json({ error: 'Title and valid amount are required' });
        return;
      }

      const planId = await PaymentPlanModel.create(
        title,
        description || null,
        amount,
        currency || 'USD',
        duration_days || 30,
        features || null,
        pay_currency || null
      );

      const plan = await PaymentPlanModel.findById(planId);

      res.status(201).json(plan);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { title, description, amount, currency, pay_currency, duration_days, features, is_active } = req.body;

      const plan = await PaymentPlanModel.findById(parseInt(id));
      if (!plan) {
        res.status(404).json({ error: 'Payment plan not found' });
        return;
      }

      await PaymentPlanModel.update(
        parseInt(id),
        title,
        description,
        amount,
        currency,
        pay_currency,
        duration_days,
        features,
        is_active !== undefined ? Boolean(is_active) : undefined
      );

      const updated = await PaymentPlanModel.findById(parseInt(id));
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const plan = await PaymentPlanModel.findById(parseInt(id));

      if (!plan) {
        res.status(404).json({ error: 'Payment plan not found' });
        return;
      }

      await PaymentPlanModel.delete(parseInt(id));

      res.json({ message: 'Payment plan deleted successfully' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

