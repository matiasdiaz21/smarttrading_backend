import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { NOWPaymentsService } from '../services/nowpayments.service';
import { PaymentSubscriptionModel } from '../models/PaymentSubscription';
import { PaymentPlanModel } from '../models/PaymentPlan';
import { UserModel } from '../models/User';

export class PaymentController {
  static async createPayment(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { payment_plan_id, amount, currency, pay_currency } = req.body;

      let finalAmount: number;
      let finalCurrency: string;
      let durationDays: number = 30;
      let planId: number | null = null;
      let orderDescription: string;
      let plan: any = null;

      // Si se proporciona un plan, usar sus datos (ignorar currency del body)
      if (payment_plan_id) {
        plan = await PaymentPlanModel.findById(payment_plan_id);
        if (!plan || !plan.is_active) {
          res.status(404).json({ error: 'Payment plan not found or inactive' });
          return;
        }
        finalAmount = plan.amount;
        finalCurrency = plan.currency; // Usar currency del plan guardado en DB
        durationDays = plan.duration_days;
        planId = plan.id;
        orderDescription = plan.title;
      } else {
        // Usar valores proporcionados directamente (compatibilidad hacia atrás)
        if (!amount || amount <= 0) {
          res.status(400).json({ error: 'Valid amount or payment_plan_id is required' });
          return;
        }
        finalAmount = amount;
        finalCurrency = currency || 'USD'; // Solo usar currency del body si no hay plan
        orderDescription = `Subscription for user ${req.user.userId}`;
      }

      const nowpayments = new NOWPaymentsService();

      // Obtener o crear UUID del usuario
      const userUuid = await UserModel.getOrCreateUuid(req.user.userId);

      // pay_currency es la criptomoneda en la que el usuario quiere pagar
      // Si el plan tiene pay_currency configurado, usarlo; si no, usar el del request; si no hay ninguno, usar USDT en BSC como valor por defecto
      let finalPayCurrency = pay_currency;
      if (!finalPayCurrency && plan) {
        if (plan.pay_currency) {
          finalPayCurrency = plan.pay_currency;
        }
      }
      if (!finalPayCurrency) {
        finalPayCurrency = 'usdtbsc'; // USDT en BSC como valor por defecto
      }

      // Crear order_id: nombre del plan + UUID del usuario
      const orderId = `${orderDescription.replace(/\s+/g, '_').toUpperCase()}_${userUuid}`;
      const backendUrl = process.env.APP_URL || 'http://localhost:5400';

      // Crear payment usando el endpoint /payment
      const paymentData = {
        price_amount: finalAmount,
        price_currency: finalCurrency.toLowerCase(),
        pay_currency: finalPayCurrency.toLowerCase(),
        order_id: orderId,
        order_description: orderDescription,
        ipn_callback_url: `${backendUrl}/api/payments/webhook`,
        is_fixed_rate: true,
        is_fee_paid_by_user: true,
      };

      const payment = await nowpayments.createPayment(paymentData);

      console.log('Payment creado en NOWPayments:', {
        payment_id: payment.payment_id,
        payment_status: payment.payment_status,
        order_id: payment.order_id,
        pay_address: payment.pay_address,
        pay_amount: payment.pay_amount,
        pay_currency: payment.pay_currency,
      });

      // Guardar en base de datos con toda la información del payment
      // Usar expiration_estimate_date como expires_at inicial (se actualizará cuando se confirme el pago)
      const initialExpiresAt = payment.expiration_estimate_date 
        ? new Date(payment.expiration_estimate_date) 
        : null;
      
      await PaymentSubscriptionModel.create(
        req.user.userId,
        planId,
        payment.payment_id,
        payment.order_id,
        finalAmount,
        finalCurrency,
        initialExpiresAt, // Usar expiration_estimate_date como expires_at inicial
        {
          payment_status: payment.payment_status,
          pay_address: payment.pay_address,
          pay_amount: payment.pay_amount,
          pay_currency: payment.pay_currency,
          purchase_id: payment.purchase_id,
          amount_received: payment.amount_received,
          network: payment.network,
          expiration_estimate_date: payment.expiration_estimate_date,
          created_at: payment.created_at,
          updated_at: payment.updated_at,
        }
      );

      // Devolver toda la información del payment al frontend
      res.json({
        payment_id: payment.payment_id,
        payment_status: payment.payment_status,
        pay_address: payment.pay_address,
        price_amount: payment.price_amount,
        price_currency: payment.price_currency,
        pay_amount: payment.pay_amount,
        pay_currency: payment.pay_currency,
        order_id: payment.order_id,
        order_description: payment.order_description,
        purchase_id: payment.purchase_id,
        amount_received: payment.amount_received,
        network: payment.network,
        expiration_estimate_date: payment.expiration_estimate_date,
        created_at: payment.created_at,
        updated_at: payment.updated_at,
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
      // NOWPayments envía el body como objeto, necesitamos pasarlo directamente
      const isValid = await nowpayments.verifyWebhookSignature(req.body, signature);

      if (!isValid) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      // NOWPayments envía order_id en el webhook, usamos eso para buscar la suscripción
      const order_id = req.body.order_id;
      const payment_id = req.body.payment_id;
      const payment_status = req.body.payment_status || req.body.status;

      if (!order_id && !payment_id) {
        res.status(400).json({ error: 'order_id or payment_id is required' });
        return;
      }

      // Buscar suscripción por order_id (preferido) o por payment_id (fallback)
      let subscription = null;
      if (order_id) {
        subscription = await PaymentSubscriptionModel.findByOrderId(order_id);
      }
      if (!subscription && payment_id) {
        subscription = await PaymentSubscriptionModel.findByPaymentId(payment_id);
      }

      if (!subscription) {
        res.status(404).json({ error: 'Subscription not found' });
        return;
      }

      // Actualizar información del payment desde el webhook
      const updatePaymentId = payment_id || (subscription ? subscription.payment_id : null);
      if (updatePaymentId) {
        await PaymentSubscriptionModel.updatePaymentDetails(updatePaymentId, {
          payment_status: payment_status,
          pay_address: req.body.pay_address,
          pay_amount: req.body.pay_amount,
          pay_currency: req.body.pay_currency,
          purchase_id: req.body.purchase_id,
          amount_received: req.body.amount_received,
          network: req.body.network,
          expiration_estimate_date: req.body.expiration_estimate_date,
          updated_at: req.body.updated_at || new Date().toISOString(),
        });
      }

      // Actualizar estado
      // NOWPayments puede enviar diferentes estados: 'waiting', 'confirming', 'confirmed', 'sending', 'partially_paid', 'finished', 'failed', 'refunded', 'expired'
      let status: 'pending' | 'confirmed' | 'expired' | 'cancelled' = 'pending';
      
      // Estados que indican pago exitoso
      if (payment_status === 'finished' || payment_status === 'confirmed' || payment_status === 'sending' || payment_status === 'paid') {
        status = 'confirmed';
        
        // NOWPayments solo procesa el pago, nosotros gestionamos la suscripción
        // Registrar la fecha del pago y contar los días desde ahí
        const paymentDate = new Date(); // Fecha actual cuando se confirma el pago
        
        // Si hay un plan asociado, usar su duración, sino usar 30 días por defecto
        let durationDays = 30;
        if (subscription.payment_plan_id) {
          const plan = await PaymentPlanModel.findById(subscription.payment_plan_id);
          if (plan) {
            durationDays = plan.duration_days;
          }
        }
        
        // Calcular fecha de expiración: fecha del pago + duración del plan
        const expiresAt = new Date(paymentDate);
        expiresAt.setDate(expiresAt.getDate() + durationDays);
        
        // Actualizar estado de suscripción del usuario
        await UserModel.updateSubscription(
          subscription.user_id,
          'active',
          expiresAt
        );
        
        // Actualizar la fecha de expiración en la suscripción también
        if (updatePaymentId) {
          await PaymentSubscriptionModel.updateExpiresAt(updatePaymentId, expiresAt);
        }
      } else if (payment_status === 'failed' || payment_status === 'cancelled' || payment_status === 'refunded') {
        status = 'cancelled';
      } else if (payment_status === 'expired') {
        status = 'expired';
      }

      // Actualizar estado usando payment_id o order_id
      if (updatePaymentId) {
        await PaymentSubscriptionModel.updateStatus(updatePaymentId, status);
      }

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

      // Buscar la suscripción asociada y actualizar su estado
      const subscription = await PaymentSubscriptionModel.findByPaymentId(payment_id);
      if (subscription) {
        // Actualizar información del payment en la base de datos
        await PaymentSubscriptionModel.updatePaymentDetails(payment_id, {
          payment_status: payment.payment_status,
          pay_address: payment.pay_address,
          pay_amount: payment.pay_amount,
          pay_currency: payment.pay_currency,
          purchase_id: payment.purchase_id,
          amount_received: payment.amount_received,
          network: payment.network,
          expiration_estimate_date: payment.expiration_estimate_date,
          updated_at: payment.updated_at,
        });

        // Si el pago está confirmado, actualizar la suscripción del usuario
        if (payment.payment_status === 'finished' || payment.payment_status === 'confirmed' || payment.payment_status === 'sending' || payment.payment_status === 'paid') {
          const paymentDate = new Date();
          let durationDays = 30;
          if (subscription.payment_plan_id) {
            const plan = await PaymentPlanModel.findById(subscription.payment_plan_id);
            if (plan) {
              durationDays = plan.duration_days;
            }
          }
          const expiresAt = new Date(paymentDate);
          expiresAt.setDate(expiresAt.getDate() + durationDays);

          await UserModel.updateSubscription(
            subscription.user_id,
            'active',
            expiresAt
          );
          await PaymentSubscriptionModel.updateExpiresAt(payment_id, expiresAt);
          await PaymentSubscriptionModel.updateStatus(payment_id, 'confirmed');
        } else if (payment.payment_status === 'failed' || payment.payment_status === 'cancelled' || payment.payment_status === 'refunded') {
          await PaymentSubscriptionModel.updateStatus(payment_id, 'cancelled');
        } else if (payment.payment_status === 'expired') {
          await PaymentSubscriptionModel.updateStatus(payment_id, 'expired');
        }
      }

      res.json(payment);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async cancelPayment(
    req: AuthRequest,
    res: Response
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { payment_id } = req.params;

      // Buscar la suscripción asociada
      const subscription = await PaymentSubscriptionModel.findByPaymentId(payment_id);
      
      if (!subscription) {
        res.status(404).json({ error: 'Payment not found' });
        return;
      }

      // Verificar que el pago pertenece al usuario
      if (subscription.user_id !== req.user.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      // Solo permitir cancelar si el pago está pendiente
      if (subscription.status !== 'pending') {
        res.status(400).json({ error: 'Payment cannot be cancelled. It is not in pending status.' });
        return;
      }

      // Actualizar el estado a expired
      await PaymentSubscriptionModel.updateStatus(payment_id, 'expired');

      res.json({ message: 'Payment cancelled successfully', payment_id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

