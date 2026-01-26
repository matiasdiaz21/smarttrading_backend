import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { StrategyModel } from '../models/Strategy';
import { SubscriptionModel } from '../models/Subscription';
import { TradeModel } from '../models/Trade';
import { PaymentSubscriptionModel } from '../models/PaymentSubscription';
import { UserModel } from '../models/User';
import { WebhookLogModel } from '../models/WebhookLog';

export class UserController {
  static async getStrategies(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Obtener todas las estrategias activas
      const strategies = await StrategyModel.findAll(false);

      // Obtener suscripciones del usuario
      const subscriptions = await SubscriptionModel.findByUserId(req.user.userId);
      const subscriptionMap = new Map(
        subscriptions.map((sub) => [sub.strategy_id, sub])
      );

      // Combinar estrategias con estado de suscripción
      const result = strategies.map((strategy) => {
        const subscription = subscriptionMap.get(strategy.id);
        
        // Determinar el leverage a usar:
        // 1. Si el usuario tiene leverage personalizado (no null), usarlo
        // 2. Si no, usar el leverage de la estrategia
        // 3. Si la estrategia no tiene leverage, usar 10 por defecto
        let userLeverage: number;
        if (subscription?.leverage !== null && subscription?.leverage !== undefined) {
          userLeverage = subscription.leverage;
        } else if (strategy.leverage) {
          userLeverage = strategy.leverage;
        } else {
          userLeverage = 10;
        }
        
        return {
          ...strategy,
          subscribed: !!subscription,
          is_enabled: subscription?.is_enabled || false,
          subscription_id: subscription?.id || null,
          user_leverage: userLeverage,
          default_leverage: strategy.leverage || 10,
        };
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async subscribeToStrategy(
    req: AuthRequest,
    res: Response
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      // Verificar que la estrategia existe
      const strategy = await StrategyModel.findById(parseInt(id));
      if (!strategy) {
        res.status(404).json({ error: 'Strategy not found' });
        return;
      }

      // Verificar si ya está suscrito
      const existing = await SubscriptionModel.findById(
        req.user.userId,
        parseInt(id)
      );

      if (existing) {
        res.status(409).json({ error: 'Already subscribed to this strategy' });
        return;
      }

      await SubscriptionModel.create(req.user.userId, parseInt(id));

      res.status(201).json({ message: 'Subscribed to strategy successfully' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async toggleStrategy(
    req: AuthRequest,
    res: Response
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled must be a boolean' });
        return;
      }

      // Verificar que existe la suscripción
      const subscription = await SubscriptionModel.findById(
        req.user.userId,
        parseInt(id)
      );

      if (!subscription) {
        res.status(404).json({
          error: 'Not subscribed to this strategy',
        });
        return;
      }

      await SubscriptionModel.toggle(req.user.userId, parseInt(id), enabled);

      res.json({
        message: `Strategy ${enabled ? 'enabled' : 'disabled'} successfully`,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async updateLeverage(
    req: AuthRequest,
    res: Response
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const { leverage } = req.body;

      if (leverage === undefined || leverage === null) {
        res.status(400).json({ error: 'leverage is required' });
        return;
      }

      // Validar leverage (entre 1 y 125)
      const leverageValue = Math.max(1, Math.min(125, parseInt(String(leverage), 10)));
      if (isNaN(leverageValue) || leverageValue < 1 || leverageValue > 125) {
        res.status(400).json({ error: 'leverage must be between 1 and 125' });
        return;
      }

      // Verificar que existe la suscripción
      const subscription = await SubscriptionModel.findById(
        req.user.userId,
        parseInt(id)
      );

      if (!subscription) {
        res.status(404).json({
          error: 'Not subscribed to this strategy',
        });
        return;
      }

      await SubscriptionModel.updateLeverage(req.user.userId, parseInt(id), leverageValue);

      res.json({
        message: 'Leverage updated successfully',
        leverage: leverageValue,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getPositions(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { CredentialsModel } = await import('../models/Credentials');
      const credentials = await CredentialsModel.findActiveByUserId(req.user.userId);

      if (!credentials) {
        res.json([]);
        return;
      }

      const { BitgetService } = await import('../services/bitget.service');
      const decryptedCredentials = BitgetService.getDecryptedCredentials({
        api_key: credentials.api_key,
        api_secret: credentials.api_secret,
        passphrase: credentials.passphrase,
      });

      const bitgetService = new BitgetService();
      const limit = parseInt(req.query.limit as string) || 100;
      const productType = (req.query.productType as string) || 'USDT-FUTURES';
      
      const endTime = Date.now();
      const startTime = req.query.startTime 
        ? parseInt(req.query.startTime as string)
        : endTime - (30 * 24 * 60 * 60 * 1000);

      const bitgetOrders = await bitgetService.getOrdersHistory(
        decryptedCredentials,
        productType,
        limit,
        startTime,
        endTime
      );

      // Agrupar órdenes por símbolo y posSide (posición de Bitget)
      // Bitget usa 'posSide' para identificar la dirección de la posición (long/short)
      const positionsMap = new Map<string, any>();
      let positionCounter = 0;

      bitgetOrders.forEach((order: any) => {
        const tradeSide = order.tradeSide?.toLowerCase();
        const symbol = order.symbol?.toUpperCase() || 'N/A';
        const posSide = order.posSide?.toLowerCase() || 'net'; // long, short, o net
        const orderTime = parseInt(order.uTime || order.cTime || Date.now().toString());
        
        // Crear clave única por símbolo y posSide
        // Para órdenes de apertura, crear nueva posición
        // Para órdenes de cierre, buscar la posición abierta más reciente del mismo símbolo/posSide
        
        const orderData = {
          order_id: order.orderId,
          client_oid: order.clientOid,
          side: order.side?.toLowerCase() === 'sell' ? 'sell' : 'buy',
          size: order.baseVolume || order.size || '0',
          price: order.priceAvg || order.price || null,
          leverage: order.leverage || null,
          margin_mode: order.marginMode || null,
          order_type: order.orderType?.toLowerCase() === 'limit' ? 'limit' : 'market',
          status: order.status?.toLowerCase() || 'unknown',
          total_profits: order.totalProfits || null,
          fee: order.fee || null,
          executed_at: new Date(orderTime).toISOString(),
          pos_side: posSide,
          trade_side: tradeSide,
        };

        if (tradeSide === 'open') {
          // Crear nueva posición para cada orden de apertura
          positionCounter++;
          const key = `${symbol}_${posSide}_${positionCounter}`;
          positionsMap.set(key, {
            position_id: key,
            symbol: symbol,
            pos_side: posSide,
            open_order: orderData,
            close_orders: [],
            status: 'open',
            open_time: orderTime,
          });
        } else if (tradeSide === 'close') {
          // Buscar la posición abierta más reciente del mismo símbolo y posSide
          let matchedPosition: any = null;
          let matchedKey: string = '';
          
          for (const [key, pos] of positionsMap.entries()) {
            if (pos.symbol === symbol && pos.pos_side === posSide) {
              // Verificar que la orden de cierre sea posterior a la apertura
              if (pos.open_order && pos.open_time <= orderTime) {
                // Tomar la posición más reciente que aún no esté completamente cerrada
                if (!matchedPosition || pos.open_time > matchedPosition.open_time) {
                  matchedPosition = pos;
                  matchedKey = key;
                }
              }
            }
          }
          
          if (matchedPosition) {
            matchedPosition.close_orders.push(orderData);
          } else {
            // Orden de cierre huérfana (sin apertura en el historial)
            // Crear una posición solo con cierre
            positionCounter++;
            const key = `${symbol}_${posSide}_orphan_${positionCounter}`;
            positionsMap.set(key, {
              position_id: key,
              symbol: symbol,
              pos_side: posSide,
              open_order: null,
              close_orders: [orderData],
              status: 'closed',
              open_time: orderTime,
            });
          }
        }
      });

      // Convertir Map a array y calcular estado y PnL total
      const positions = Array.from(positionsMap.values()).map(position => {
        const hasOpen = position.open_order !== null;
        const hasClose = position.close_orders.length > 0;

        // Calcular PnL total sumando todas las órdenes de cierre
        const totalPnL = position.close_orders.reduce((sum: number, order: any) => {
          return sum + parseFloat(order.total_profits || '0');
        }, 0);

        // Calcular fees totales
        const totalFees = [
          ...(position.open_order ? [position.open_order] : []),
          ...position.close_orders
        ].reduce((sum: number, order: any) => {
          return sum + Math.abs(parseFloat(order.fee || '0'));
        }, 0);

        // Determinar estado de la posición
        let status: 'open' | 'closed' | 'partial';
        if (!hasOpen && hasClose) {
          status = 'closed';
        } else if (hasOpen && !hasClose) {
          status = 'open';
        } else if (hasOpen && hasClose) {
          // Verificar si se cerró completamente comparando tamaños
          const openSize = parseFloat(position.open_order.size || '0');
          const closedSize = position.close_orders.reduce((sum: number, order: any) => {
            return sum + parseFloat(order.size || '0');
          }, 0);
          status = Math.abs(openSize - closedSize) < 0.0001 ? 'closed' : 'partial';
        } else {
          status = 'open';
        }

        // Usar la fecha más reciente (cierre si existe, sino apertura)
        const latestDate = hasClose 
          ? position.close_orders[position.close_orders.length - 1].executed_at
          : position.open_order?.executed_at || new Date().toISOString();

        return {
          position_id: position.position_id,
          symbol: position.symbol,
          pos_side: position.pos_side,
          status: status,
          open_order: position.open_order,
          close_orders: position.close_orders,
          total_pnl: totalPnL,
          total_fees: totalFees,
          net_pnl: totalPnL - totalFees,
          latest_update: latestDate,
        };
      });

      // Ordenar por fecha más reciente
      positions.sort((a, b) => {
        return new Date(b.latest_update).getTime() - new Date(a.latest_update).getTime();
      });

      res.json(positions);
    } catch (error: any) {
      console.error('[UserController] Error al obtener posiciones:', error);
      res.status(500).json({ error: error.message || 'Error al obtener posiciones' });
    }
  }

  static async getClosedTrades(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const limit = parseInt(req.query.limit as string) || 10;
      
      // Obtener estrategias a las que el usuario está suscrito
      const subscriptions = await SubscriptionModel.findByUserId(req.user.userId);
      const strategyIds = subscriptions.map(sub => sub.strategy_id);
      
      if (strategyIds.length === 0) {
        res.json([]);
        return;
      }

      // Obtener las últimas señales cerradas (STOP_LOSS o TAKE_PROFIT) de las estrategias suscritas
      const webhookLogs = await WebhookLogModel.findClosedSignalsByUserStrategies(strategyIds, limit);
      
      // Parsear el payload y formatear la respuesta
      // Aplicar la misma lógica de negocio que en webhook-logs:
      // - TAKE_PROFIT → siempre ganado
      // - BREAKEVEN → siempre ganado (se tomó 50% de ganancia)
      // - STOP_LOSS con BREAKEVEN previo → ganado
      // - STOP_LOSS sin BREAKEVEN → perdido
      const closedSignals = await Promise.all(webhookLogs.map(async (log) => {
        try {
          const payload = typeof log.payload === 'string' ? JSON.parse(log.payload) : log.payload;
          const tradeId = payload.alertData?.id || payload.trade_id;
          let alertType = payload.alertType || payload.alert_type || 'N/A';
          
          // Aplicar lógica de negocio para determinar el tipo de alerta a mostrar
          if (alertType === 'TAKE_PROFIT') {
            // TAKE_PROFIT siempre es ganado
            alertType = 'TAKE_PROFIT';
          } else if (alertType === 'BREAKEVEN') {
            // BREAKEVEN es ganado (50% de ganancia tomada)
            alertType = 'TAKE_PROFIT';
          } else if (alertType === 'STOP_LOSS' && tradeId) {
            // STOP_LOSS: verificar si hubo BREAKEVEN previo
            const hasBreakeven = await WebhookLogModel.hasBreakevenForTrade(
              log.strategy_id,
              tradeId
            );
            if (hasBreakeven) {
              // Si tuvo BREAKEVEN, es ganado
              alertType = 'TAKE_PROFIT';
            } else {
              // Si no tuvo BREAKEVEN, es perdido
              alertType = 'STOP_LOSS';
            }
          }
          
          return {
            id: log.id,
            strategy_id: log.strategy_id,
            symbol: payload.symbol || 'N/A',
            side: payload.side || 'N/A',
            entryPrice: payload.entryPrice || payload.entry_price || null,
            stopLoss: payload.stopLoss || payload.stop_loss || null,
            takeProfit: payload.takeProfit || payload.take_profit || null,
            alertType: alertType,
            tradeId: tradeId || null,
            processedAt: log.processed_at,
            payload: log.payload
          };
        } catch (error) {
          console.error('Error parsing webhook log payload:', error);
          return {
            id: log.id,
            strategy_id: log.strategy_id,
            symbol: 'N/A',
            side: 'N/A',
            entryPrice: null,
            stopLoss: null,
            takeProfit: null,
            alertType: 'N/A',
            tradeId: null,
            processedAt: log.processed_at,
            payload: log.payload
          };
        }
      }));

      res.json(closedSignals);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getSubscriptionStatus(
    req: AuthRequest,
    res: Response
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const activeSubscription =
        await PaymentSubscriptionModel.findActiveByUserId(req.user.userId);

      res.json({
        has_active_subscription: !!activeSubscription,
        subscription: activeSubscription,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getPendingPayment(
    req: AuthRequest,
    res: Response
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Obtener todas las suscripciones del usuario
      const subscriptions = await PaymentSubscriptionModel.findByUserId(req.user.userId);
      
      // Buscar la última suscripción pendiente (solo las que están realmente pendientes, no las expiradas o canceladas)
      const pendingSubscription = subscriptions
        .filter(sub => sub.status === 'pending')
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

      if (!pendingSubscription) {
        res.json({ pending_payment: null });
        return;
      }

      // Obtener el plan asociado si existe
      let plan = null;
      if (pendingSubscription.payment_plan_id) {
        const { PaymentPlanModel } = await import('../models/PaymentPlan');
        plan = await PaymentPlanModel.findById(pendingSubscription.payment_plan_id);
      }

      // Obtener detalles del payment desde NOWPayments
      const { NOWPaymentsService } = await import('../services/nowpayments.service');
      const nowpayments = new NOWPaymentsService();
      let paymentDetails = null;
      
      try {
        paymentDetails = await nowpayments.getPaymentStatus(pendingSubscription.payment_id);
        // Asegurarse de que expiration_estimate_date esté presente (usar el de la BD si no viene de la API)
        if (!paymentDetails.expiration_estimate_date && pendingSubscription.expiration_estimate_date) {
          paymentDetails.expiration_estimate_date = pendingSubscription.expiration_estimate_date instanceof Date 
            ? pendingSubscription.expiration_estimate_date.toISOString() 
            : pendingSubscription.expiration_estimate_date;
        }
      } catch (error) {
        console.error('Error al obtener detalles del payment:', error);
        // Si falla, usar los datos guardados en la suscripción
        paymentDetails = {
          payment_id: pendingSubscription.payment_id,
          payment_status: pendingSubscription.payment_status || 'waiting',
          pay_address: pendingSubscription.pay_address || '',
          price_amount: pendingSubscription.amount,
          price_currency: pendingSubscription.currency,
          pay_amount: pendingSubscription.pay_amount,
          pay_currency: pendingSubscription.pay_currency,
          order_id: pendingSubscription.order_id,
          expiration_estimate_date: pendingSubscription.expiration_estimate_date,
          purchase_id: pendingSubscription.purchase_id,
          amount_received: pendingSubscription.amount_received,
          network: pendingSubscription.network,
        };
      }

      res.json({
        pending_payment: {
          ...paymentDetails,
          plan: plan,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async acceptTradingTerms(
    req: AuthRequest,
    res: Response
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      await UserModel.acceptTradingTerms(req.user.userId);

      res.json({
        message: 'Trading terms accepted successfully',
        accepted_at: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getTradingTermsStatus(
    req: AuthRequest,
    res: Response
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const hasAccepted = await UserModel.hasAcceptedTradingTerms(req.user.userId);
      const user = await UserModel.findById(req.user.userId);

      res.json({
        has_accepted: hasAccepted,
        accepted_at: user?.trading_terms_accepted_at || null,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

