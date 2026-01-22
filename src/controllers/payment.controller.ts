import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { NOWPaymentsService } from '../services/nowpayments.service';
import { PaymentSubscriptionModel } from '../models/PaymentSubscription';
import { UserModel } from '../models/User';

export class PaymentController {
  static async createPayment(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { amount, currency = 'USD' } = req.body;

      if (!amount || amount <= 0) {
        res.status(400).json({ error: 'Valid amount is required' });
        return;
      }

      const nowpayments = new NOWPaymentsService();

      // Calcular fecha de expiración (1 mes desde ahora)
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1);

      const paymentData = {
        price_amount: amount,
        price_currency: currency,
        order_id: `SUB_${req.user.userId}_${Date.now()}`,
        order_description: `Monthly subscription for user ${req.user.userId}`,
        ipn_callback_url: `${process.env.APP_URL || 'https://your-backend.vercel.app'}/api/payments/webhook`,
        success_url: `${process.env.FRONTEND_URL || 'https://your-frontend.vercel.app'}/dashboard?payment=success`,
        cancel_url: `${process.env.FRONTEND_URL || 'https://your-frontend.vercel.app'}/dashboard?payment=cancelled`,
      };

      const payment = await nowpayments.createPayment(paymentData);

      // Guardar en base de datos
      await PaymentSubscriptionModel.create(
        req.user.userId,
        payment.payment_id,
        amount,
        currency,
        expiresAt
      );

      res.json({
        payment_id: payment.payment_id,
        pay_address: payment.pay_address,
        pay_amount: payment.pay_amount,
        pay_currency: payment.pay_currency,
        expires_at: expiresAt,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async webhook(req: any, res: Response): Promise<void> {
    try {
      const nowpayments = new NOWPaymentsService();
      const signature = req.headers['x-nowpayments-sig'] || '';

      // Verificar firma del webhook
      const payload = JSON.stringify(req.body);
      const isValid = nowpayments.verifyWebhookSignature(payload, signature);

      if (!isValid) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      const { payment_id, payment_status } = req.body;

      if (!payment_id) {
        res.status(400).json({ error: 'payment_id is required' });
        return;
      }

      // Buscar suscripción
      const subscription = await PaymentSubscriptionModel.findByPaymentId(
        payment_id
      );

      if (!subscription) {
        res.status(404).json({ error: 'Subscription not found' });
        return;
      }

      // Actualizar estado
      let status: 'pending' | 'confirmed' | 'expired' | 'cancelled' = 'pending';
      
      if (payment_status === 'finished' || payment_status === 'confirmed') {
        status = 'confirmed';
        
        // Actualizar estado de suscripción del usuario
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 1);
        
        await UserModel.updateSubscription(
          subscription.user_id,
          'active',
          expiresAt
        );
      } else if (payment_status === 'failed' || payment_status === 'cancelled') {
        status = 'cancelled';
      }

      await PaymentSubscriptionModel.updateStatus(payment_id, status);

      res.json({ message: 'Webhook processed successfully' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getPaymentStatus(
    req: AuthRequest,
    res: Response
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { payment_id } = req.params;

      const nowpayments = new NOWPaymentsService();
      const payment = await nowpayments.getPaymentStatus(payment_id);

      res.json(payment);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

