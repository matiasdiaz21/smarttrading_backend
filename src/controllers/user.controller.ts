import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { StrategyModel } from '../models/Strategy';
import { SubscriptionModel } from '../models/Subscription';
import { TradeModel } from '../models/Trade';
import { PaymentSubscriptionModel } from '../models/PaymentSubscription';
import { UserModel } from '../models/User';
import { WebhookLogModel } from '../models/WebhookLog';
import { RiskAcceptanceModel } from '../models/RiskAcceptance';

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

      // Normalizar allowed_symbols (puede venir como JSON string desde MySQL)
      const normalizeAllowedSymbols = (s: any): string[] | null => {
        if (s == null) return null;
        if (Array.isArray(s)) return s.length ? s : null;
        if (typeof s === 'string') {
          try {
            const parsed = JSON.parse(s);
            return Array.isArray(parsed) && parsed.length ? parsed : null;
          } catch {
            return null;
          }
        }
        return null;
      };

      const normalizeExcludedSymbols = (s: any): string[] | null => {
        if (s == null) return null;
        if (Array.isArray(s)) return s.length ? s : null;
        if (typeof s === 'string') {
          try {
            const parsed = JSON.parse(s);
            return Array.isArray(parsed) && parsed.length ? parsed : null;
          } catch {
            return null;
          }
        }
        return null;
      };

      // Combinar estrategias con estado de suscripción
      const result = strategies.map((strategy: any) => {
        const subscription = subscriptionMap.get(strategy.id);
        
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
          allowed_symbols: normalizeAllowedSymbols(strategy.allowed_symbols),
          subscribed: !!subscription,
          is_enabled: subscription?.is_enabled || false,
          subscription_id: subscription?.id || null,
          user_leverage: userLeverage,
          default_leverage: strategy.leverage || 10,
          user_position_size: subscription?.position_size || null,
          credential_id: subscription?.credential_id ?? null,
          excluded_symbols: subscription ? normalizeExcludedSymbols(subscription.excluded_symbols) : null,
          use_partial_tp: subscription?.use_partial_tp !== false, // Default true
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
      const strategyId = parseInt(id);

      const strategy = await StrategyModel.findById(strategyId);
      if (!strategy) {
        res.status(404).json({ error: 'Strategy not found' });
        return;
      }

      const existing = await SubscriptionModel.findById(req.user.userId, strategyId);
      if (existing) {
        res.status(409).json({ error: 'Already subscribed to this strategy' });
        return;
      }

      const credentialId = req.body.credential_id != null ? parseInt(String(req.body.credential_id), 10) : null;
      if (credentialId != null) {
        const { CredentialsModel } = await import('../models/Credentials');
        const cred = await CredentialsModel.findById(credentialId, req.user.userId);
        if (!cred) {
          res.status(400).json({ error: 'Credential not found or does not belong to you' });
          return;
        }
        // Verificar conflicto de símbolos con otras estrategias que usen esta misma credencial
        const allSubs = await SubscriptionModel.findByUserId(req.user.userId);
        const subsWithSameCred = allSubs.filter(s => s.credential_id === credentialId);
        if (subsWithSameCred.length > 0) {
          const allStrategies = await StrategyModel.findAll(false);
          const strategyMap = new Map(allStrategies.map((s: any) => [s.id, s]));
          const parseSymbols = (s: any): string[] | null => {
            if (s == null) return null;
            if (Array.isArray(s)) return s.length ? s.map((x: string) => x.toUpperCase()) : null;
            if (typeof s === 'string') { try { const p = JSON.parse(s); return Array.isArray(p) && p.length ? p.map((x: string) => x.toUpperCase()) : null; } catch { return null; } }
            return null;
          };
          const parseExcluded = (s: any): string[] => {
            if (s == null) return [];
            if (Array.isArray(s)) return s.map((x: string) => x.toUpperCase());
            if (typeof s === 'string') { try { const p = JSON.parse(s); return Array.isArray(p) ? p.map((x: string) => x.toUpperCase()) : []; } catch { return []; } }
            return [];
          };
          const targetAllowed = parseSymbols((strategy as any).allowed_symbols);
          const targetExcluded: string[] = []; // nueva suscripción, sin excluded aún
          for (const otherSub of subsWithSameCred) {
            const otherStrat = strategyMap.get(otherSub.strategy_id) as any;
            if (!otherStrat) continue;
            const otherAllowed = parseSymbols(otherStrat.allowed_symbols);
            const otherExcluded = parseExcluded(otherSub.excluded_symbols);
            let conflicting: string[] = [];
            if (targetAllowed === null && otherAllowed === null) {
              res.status(400).json({ error: `No se puede usar esta credencial: ambas estrategias operan todos los símbolos. Configura símbolos específicos o usa otra credencial.` });
              return;
            } else if (targetAllowed === null) {
              conflicting = otherAllowed!.filter(s => !otherExcluded.includes(s)).filter(s => !targetExcluded.includes(s));
            } else if (otherAllowed === null) {
              conflicting = targetAllowed.filter(s => !targetExcluded.includes(s)).filter(s => !otherExcluded.includes(s));
            } else {
              const targetActive = targetAllowed.filter(s => !targetExcluded.includes(s));
              const otherActive = otherAllowed.filter(s => !otherExcluded.includes(s));
              conflicting = targetActive.filter(s => otherActive.includes(s));
            }
            if (conflicting.length > 0) {
              res.status(400).json({ error: `No se puede usar esta credencial: los símbolos ${conflicting.join(', ')} chocan con "${otherStrat.name}". Usa otra credencial o excluye esos símbolos.` });
              return;
            }
          }
        }
      }

      await SubscriptionModel.create(req.user.userId, strategyId, null, credentialId);

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
      const { enabled, riskAcceptance } = req.body;

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

      // Si se está activando: la estrategia debe tener una credencial asignada (1:1)
      if (enabled && !subscription.credential_id) {
        res.status(400).json({
          error: 'Asigna una credencial de Bitget a esta estrategia antes de activarla. Ve a la página de Estrategias y selecciona una credencial.',
        });
        return;
      }

      // Si se está activando: verificar que los símbolos no choquen con otras estrategias habilitadas
      if (enabled) {
        const strategyId = parseInt(id);
        const targetStrategy = await StrategyModel.findById(strategyId);
        if (!targetStrategy) {
          res.status(404).json({ error: 'Strategy not found' });
          return;
        }

        // Normalizar allowed_symbols
        const parseSymbols = (s: any): string[] | null => {
          if (s == null) return null;
          if (Array.isArray(s)) return s.length ? s.map((x: string) => x.toUpperCase()) : null;
          if (typeof s === 'string') {
            try { const p = JSON.parse(s); return Array.isArray(p) && p.length ? p.map((x: string) => x.toUpperCase()) : null; } catch { return null; }
          }
          return null;
        };
        const parseExcluded = (s: any): string[] => {
          if (s == null) return [];
          if (Array.isArray(s)) return s.map((x: string) => x.toUpperCase());
          if (typeof s === 'string') {
            try { const p = JSON.parse(s); return Array.isArray(p) ? p.map((x: string) => x.toUpperCase()) : []; } catch { return []; }
          }
          return [];
        };

        const targetAllowed = parseSymbols(targetStrategy.allowed_symbols);
        const targetExcluded = parseExcluded(subscription.excluded_symbols);

        // Obtener todas las suscripciones habilitadas del usuario (excepto la actual)
        const allSubs = await SubscriptionModel.findByUserId(req.user.userId);
        const enabledSubs = allSubs.filter(s => s.is_enabled && s.strategy_id !== strategyId);

        if (enabledSubs.length > 0) {
          const allStrategies = await StrategyModel.findAll(false);
          const strategyMap = new Map(allStrategies.map((s: any) => [s.id, s]));

          for (const otherSub of enabledSubs) {
            const otherStrategy = strategyMap.get(otherSub.strategy_id) as any;
            if (!otherStrategy) continue;

            const otherAllowed = parseSymbols(otherStrategy.allowed_symbols);
            const otherExcluded = parseExcluded(otherSub.excluded_symbols);

            // Calcular símbolos activos de cada estrategia
            // null = todos los símbolos (wildcard)
            let conflictingSymbols: string[] = [];

            if (targetAllowed === null && otherAllowed === null) {
              // Ambas operan TODOS los símbolos → siempre chocan
              res.status(400).json({
                error: `No se puede activar: esta estrategia opera todos los símbolos y choca con "${otherStrategy.name}" que también opera todos los símbolos. Excluye símbolos en una de las dos para evitar conflictos.`,
                symbolConflict: true,
              });
              return;
            } else if (targetAllowed === null) {
              // Target opera todos, other opera algunos → chocan en los de other (menos excluidos)
              const otherActive = otherAllowed!.filter(s => !otherExcluded.includes(s));
              conflictingSymbols = otherActive.filter(s => !targetExcluded.includes(s));
            } else if (otherAllowed === null) {
              // Target opera algunos, other opera todos → chocan en los de target (menos excluidos)
              const targetActive = targetAllowed.filter(s => !targetExcluded.includes(s));
              conflictingSymbols = targetActive.filter(s => !otherExcluded.includes(s));
            } else {
              // Ambas tienen lista específica
              const targetActive = targetAllowed.filter(s => !targetExcluded.includes(s));
              const otherActive = otherAllowed.filter(s => !otherExcluded.includes(s));
              conflictingSymbols = targetActive.filter(s => otherActive.includes(s));
            }

            if (conflictingSymbols.length > 0) {
              res.status(400).json({
                error: `No se puede activar: los símbolos ${conflictingSymbols.join(', ')} chocan con la estrategia "${otherStrategy.name}". Excluye estos símbolos en una de las dos estrategias para poder activar ambas.`,
                symbolConflict: true,
                conflictingSymbols,
                conflictingStrategy: otherStrategy.name,
              });
              return;
            }
          }
        }
      }

      // Si se está activando la estrategia, verificar aceptación de riesgo
      if (enabled) {
        const hasAccepted = await RiskAcceptanceModel.hasAccepted(req.user.userId, parseInt(id));
        
        if (!hasAccepted) {
          // Si no ha aceptado antes, requiere que envíe la aceptación
          if (!riskAcceptance || typeof riskAcceptance !== 'string') {
            res.status(400).json({ 
              error: 'Risk acceptance required',
              requiresRiskAcceptance: true 
            });
            return;
          }
          
          // Registrar la aceptación de riesgo
          const ipAddress = req.ip || req.headers['x-forwarded-for'] as string || req.socket.remoteAddress;
          const userAgent = req.headers['user-agent'];
          
          await RiskAcceptanceModel.create(
            req.user.userId,
            parseInt(id),
            riskAcceptance,
            ipAddress,
            userAgent
          );
          
          console.log(`[UserController] ✅ Aceptación de riesgo registrada para usuario ${req.user.userId}, estrategia ${id}`);
        }
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

  static async updatePositionSize(
    req: AuthRequest,
    res: Response
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const { position_size } = req.body;

      // position_size puede ser null para usar el tamaño automático
      if (position_size !== null && position_size !== undefined) {
        // Validar position_size (debe ser un número positivo)
        const positionSizeValue = parseFloat(String(position_size));
        if (isNaN(positionSizeValue) || positionSizeValue <= 0) {
          res.status(400).json({ error: 'position_size must be a positive number or null' });
          return;
        }

        // Validar mínimo (al menos 5 USDT, que es el mínimo típico de Bitget)
        if (positionSizeValue < 5) {
          res.status(400).json({ error: 'position_size must be at least 5 USDT' });
          return;
        }
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

      const positionSizeToSave = position_size === null || position_size === undefined 
        ? null 
        : parseFloat(String(position_size));

      await SubscriptionModel.updatePositionSize(req.user.userId, parseInt(id), positionSizeToSave);

      res.json({
        message: 'Position size updated successfully',
        position_size: positionSizeToSave,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** Asigna o cambia la credencial de Bitget para una estrategia. Una credencial solo puede estar en una estrategia. */
  static async updateStrategyCredential(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const strategyId = parseInt(id);
      const credentialId = req.body.credential_id !== undefined && req.body.credential_id !== null
        ? parseInt(String(req.body.credential_id), 10)
        : null;

      const subscription = await SubscriptionModel.findById(req.user.userId, strategyId);
      if (!subscription) {
        res.status(404).json({ error: 'Not subscribed to this strategy' });
        return;
      }

      if (credentialId !== null) {
        const { CredentialsModel } = await import('../models/Credentials');
        const cred = await CredentialsModel.findById(credentialId, req.user.userId);
        if (!cred) {
          res.status(400).json({ error: 'Credential not found or does not belong to you' });
          return;
        }
        // Verificar conflicto de símbolos con otras estrategias que usen esta misma credencial
        const allSubs = await SubscriptionModel.findByUserId(req.user.userId);
        const subsWithSameCred = allSubs.filter(s => s.credential_id === credentialId && s.strategy_id !== strategyId);
        if (subsWithSameCred.length > 0) {
          const targetStrategy = await StrategyModel.findById(strategyId);
          const allStrategies = await StrategyModel.findAll(false);
          const strategyMap = new Map(allStrategies.map((s: any) => [s.id, s]));
          const parseSymbols = (s: any): string[] | null => {
            if (s == null) return null;
            if (Array.isArray(s)) return s.length ? s.map((x: string) => x.toUpperCase()) : null;
            if (typeof s === 'string') { try { const p = JSON.parse(s); return Array.isArray(p) && p.length ? p.map((x: string) => x.toUpperCase()) : null; } catch { return null; } }
            return null;
          };
          const parseExcluded = (s: any): string[] => {
            if (s == null) return [];
            if (Array.isArray(s)) return s.map((x: string) => x.toUpperCase());
            if (typeof s === 'string') { try { const p = JSON.parse(s); return Array.isArray(p) ? p.map((x: string) => x.toUpperCase()) : []; } catch { return []; } }
            return [];
          };
          const targetAllowed = parseSymbols((targetStrategy as any)?.allowed_symbols);
          const targetExcluded = parseExcluded(subscription.excluded_symbols);
          for (const otherSub of subsWithSameCred) {
            const otherStrat = strategyMap.get(otherSub.strategy_id) as any;
            if (!otherStrat) continue;
            const otherAllowed = parseSymbols(otherStrat.allowed_symbols);
            const otherExcluded = parseExcluded(otherSub.excluded_symbols);
            let conflicting: string[] = [];
            if (targetAllowed === null && otherAllowed === null) {
              res.status(400).json({ error: `No se puede usar esta credencial: ambas estrategias operan todos los símbolos. Configura símbolos específicos o usa otra credencial.` });
              return;
            } else if (targetAllowed === null) {
              conflicting = otherAllowed!.filter(s => !otherExcluded.includes(s)).filter(s => !targetExcluded.includes(s));
            } else if (otherAllowed === null) {
              conflicting = targetAllowed.filter(s => !targetExcluded.includes(s)).filter(s => !otherExcluded.includes(s));
            } else {
              const targetActive = targetAllowed.filter(s => !targetExcluded.includes(s));
              const otherActive = otherAllowed.filter(s => !otherExcluded.includes(s));
              conflicting = targetActive.filter(s => otherActive.includes(s));
            }
            if (conflicting.length > 0) {
              res.status(400).json({ error: `No se puede usar esta credencial: los símbolos ${conflicting.join(', ')} chocan con "${otherStrat.name}". Usa otra credencial o excluye esos símbolos.` });
              return;
            }
          }
        }
      }

      await SubscriptionModel.updateCredential(req.user.userId, strategyId, credentialId);

      res.json({
        message: 'Credential updated successfully',
        credential_id: credentialId,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** Activa o desactiva el take profit parcial (50% en breakeven) para esta estrategia. */
  static async updatePartialTp(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const strategyId = parseInt(id);
      const { use_partial_tp } = req.body;

      if (typeof use_partial_tp !== 'boolean') {
        res.status(400).json({ error: 'use_partial_tp must be a boolean' });
        return;
      }

      const subscription = await SubscriptionModel.findById(req.user.userId, strategyId);
      if (!subscription) {
        res.status(404).json({ error: 'Not subscribed to this strategy' });
        return;
      }

      await SubscriptionModel.updatePartialTp(req.user.userId, strategyId, use_partial_tp);

      res.json({
        message: 'Partial take profit setting updated successfully',
        use_partial_tp,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /** Actualiza los símbolos que el usuario no quiere copiar en esta estrategia. */
  static async updateExcludedSymbols(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      const strategyId = parseInt(id);
      const raw = req.body.excluded_symbols;
      const excludedSymbols = Array.isArray(raw)
        ? raw.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim().toUpperCase())
        : [];
      const toSave = excludedSymbols.length ? excludedSymbols : null;

      const subscription = await SubscriptionModel.findById(req.user.userId, strategyId);
      if (!subscription) {
        res.status(404).json({ error: 'Not subscribed to this strategy' });
        return;
      }

      await SubscriptionModel.updateExcludedSymbols(req.user.userId, strategyId, toSave);

      res.json({
        message: 'Excluded symbols updated successfully',
        excluded_symbols: toSave,
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

      const pageSize = parseInt(req.query.limit as string) || 100;
      const productType = (req.query.productType as string) || 'USDT-FUTURES';
      const endTime = Date.now();
      const startTime = req.query.startTime 
        ? parseInt(req.query.startTime as string) 
        : endTime - (30 * 24 * 60 * 60 * 1000);

      // Obtener historial de órdenes (incluye leverage)
      const bitgetOrders = await bitgetService.getOrdersHistory(
        decryptedCredentials,
        productType,
        pageSize,
        startTime,
        endTime
      );

      // Obtener posiciones abiertas actuales (incluye leverage)
      const openPositionsData = await bitgetService.getPositions(
        decryptedCredentials,
        undefined,
        productType
      );

      console.log('[UserController] ===== POSITION DATA SUMMARY =====');
      console.log('[UserController] Total órdenes:', bitgetOrders.length);
      console.log('[UserController] Total posiciones abiertas:', openPositionsData?.length || 0);
      console.log('[UserController] ================================');

      // Identificar qué órdenes son automáticas (de estrategias) vs manuales
      // Extraer todos los orderIds de las órdenes de Bitget
      const allOrderIds = bitgetOrders
        .map((o: any) => o.orderId)
        .filter((id: string) => id && id !== 'N/A');
      
      // Buscar en la tabla trades para identificar cuáles son automáticas
      const tradeInfoMap = await TradeModel.findByBitgetOrderIds(req.user.userId, allOrderIds);
      console.log(`[UserController] 🔍 Identificadas ${tradeInfoMap.size} órdenes automáticas de ${allOrderIds.length} totales`);

      // Agrupar órdenes cerradas por símbolo + posSide + proximidad temporal
      const groupedOrders = new Map<string, any[]>();
      
      bitgetOrders.forEach((order: any) => {
        const symbol = order.symbol?.toUpperCase();
        const posSide = order.posSide?.toLowerCase();
        const tradeSide = order.tradeSide?.toLowerCase();
        const status = order.status?.toLowerCase();
        
        // Solo procesar órdenes completadas
        if (status !== 'filled') return;
        
        const key = `${symbol}_${posSide}`;
        if (!groupedOrders.has(key)) {
          groupedOrders.set(key, []);
        }
        groupedOrders.get(key)!.push(order);
      });

      // Crear posiciones cerradas agrupando órdenes de apertura y cierre
      const closedPositions: any[] = [];
      
      groupedOrders.forEach((orders, key) => {
        const [symbol, posSide] = key.split('_');
        
        // Separar órdenes de apertura y cierre
        const openOrders = orders.filter((o: any) => o.tradeSide?.toLowerCase() === 'open');
        const closeOrders = orders.filter((o: any) => o.tradeSide?.toLowerCase() === 'close');
        
        // Si no hay órdenes de cierre, no es una posición cerrada
        if (closeOrders.length === 0) return;
        
        // Agrupar por proximidad temporal (posiciones que se abrieron y cerraron juntas)
        const positionGroups: any[] = [];
        const usedCloseOrders = new Set<string>();
        
        openOrders.forEach((openOrder: any) => {
          const openTime = parseInt(openOrder.cTime || openOrder.uTime || '0');
          
          // Buscar órdenes de cierre cercanas (dentro de 24 horas)
          const relatedCloseOrders = closeOrders.filter((closeOrder: any) => {
            if (usedCloseOrders.has(closeOrder.orderId)) return false;
            const closeTime = parseInt(closeOrder.uTime || closeOrder.cTime || '0');
            return closeTime >= openTime && closeTime <= (openTime + 24 * 60 * 60 * 1000);
          });
          
          if (relatedCloseOrders.length > 0) {
            relatedCloseOrders.forEach((co: any) => usedCloseOrders.add(co.orderId));
            positionGroups.push({
              openOrders: [openOrder],
              closeOrders: relatedCloseOrders
            });
          }
        });
        
        // Crear una posición por cada grupo
        positionGroups.forEach((group) => {
          const { openOrders: groupOpenOrders, closeOrders: groupCloseOrders } = group;
          
          // Calcular datos agregados
          const totalOpenSize = groupOpenOrders.reduce((sum: number, o: any) => 
            sum + parseFloat(o.baseVolume || o.size || '0'), 0);
          const totalCloseSize = groupCloseOrders.reduce((sum: number, o: any) => 
            sum + parseFloat(o.baseVolume || o.size || '0'), 0);
          
          const openFees = groupOpenOrders.reduce((sum: number, o: any) => 
            sum + Math.abs(parseFloat(o.fee || '0')), 0);
          const closeFees = groupCloseOrders.reduce((sum: number, o: any) => 
            sum + Math.abs(parseFloat(o.fee || '0')), 0);
          const totalFees = openFees + closeFees;
          
          // Precio promedio ponderado de apertura
          const openPriceWeighted = groupOpenOrders.reduce((sum: number, o: any) => {
            const price = parseFloat(o.priceAvg || o.price || '0');
            const size = parseFloat(o.baseVolume || o.size || '0');
            return sum + (price * size);
          }, 0);
          const openPrice = totalOpenSize > 0 ? (openPriceWeighted / totalOpenSize) : 0;
          
          // Precio promedio ponderado de cierre
          const closePriceWeighted = groupCloseOrders.reduce((sum: number, o: any) => {
            const price = parseFloat(o.priceAvg || o.price || '0');
            const size = parseFloat(o.baseVolume || o.size || '0');
            return sum + (price * size);
          }, 0);
          const closePrice = totalCloseSize > 0 ? (closePriceWeighted / totalCloseSize) : 0;
          
          // PnL total de las órdenes de cierre
          const grossPnl = groupCloseOrders.reduce((sum: number, o: any) => 
            sum + parseFloat(o.totalProfits || '0'), 0);
          const netPnl = grossPnl - totalFees;
          
          // Leverage (de la primera orden de apertura)
          const leverage = groupOpenOrders[0]?.leverage || '1';
          const marginMode = groupOpenOrders[0]?.marginMode || 'crossed';
          const holdSide = groupOpenOrders[0]?.posSide?.toLowerCase() || posSide;
          
          const openTime = parseInt(groupOpenOrders[0]?.cTime || groupOpenOrders[0]?.uTime || '0');
          const closeTime = parseInt(groupCloseOrders[groupCloseOrders.length - 1]?.uTime || '0');
          
          console.log(`[UserController] ✓ ${symbol} ${posSide}: size=${totalOpenSize.toFixed(4)}, open=${openPrice.toFixed(2)}, close=${closePrice.toFixed(2)}, leverage=${leverage}x, grossPnL=${grossPnl.toFixed(4)}, fees=${totalFees.toFixed(4)}, netPnL=${netPnl.toFixed(4)}`);
          
          // Identificar si esta posición es automática o manual
          // Si alguna de las órdenes de apertura está en trades, es automática
          const isAutomatic = groupOpenOrders.some((o: any) => tradeInfoMap.has(o.orderId));
          const tradeInfo = groupOpenOrders
            .map((o: any) => tradeInfoMap.get(o.orderId))
            .find((info: any) => info !== undefined);
          
          closedPositions.push({
            position_id: `${symbol}_${posSide}_${openTime}`,
            symbol: symbol,
            pos_side: holdSide,
            status: 'closed' as const,
            side: holdSide === 'long' ? 'buy' : 'sell',
            leverage: leverage,
            margin_mode: marginMode,
            open_price: openPrice.toString(),
            close_price: closePrice.toString(),
            size: totalOpenSize.toString(),
            total_pnl: grossPnl,
            total_fees: totalFees,
            net_pnl: netPnl,
            opened_at: new Date(openTime).toISOString(),
            closed_at: new Date(closeTime).toISOString(),
            latest_update: new Date(closeTime).toISOString(),
            is_automatic: isAutomatic,
            strategy_id: tradeInfo?.strategy_id || null,
            strategy_name: tradeInfo?.strategy_name || null,
            open_orders: groupOpenOrders.map((o: any) => ({
              order_id: o.orderId,
              size: o.baseVolume || o.size || '0',
              price: o.priceAvg || o.price || null,
              fee: o.fee || null,
              total_profits: o.totalProfits || null,
              executed_at: new Date(parseInt(o.uTime || o.cTime || '0')).toISOString(),
              is_automatic: tradeInfoMap.has(o.orderId),
            })),
            close_orders: groupCloseOrders.map((o: any) => ({
              order_id: o.orderId,
              size: o.baseVolume || o.size || '0',
              price: o.priceAvg || o.price || null,
              fee: o.fee || null,
              total_profits: o.totalProfits || null,
              executed_at: new Date(parseInt(o.uTime || o.cTime || '0')).toISOString(),
              is_automatic: tradeInfoMap.has(o.orderId),
            })),
          });
        });
      });

      // Mapear posiciones abiertas actuales
      // Para posiciones abiertas, buscamos en trades por símbolo y usuario
      // Una posición es automática si tiene trades registrados para ese símbolo
      const { StrategyModel } = await import('../models/Strategy');
      const userTrades = await TradeModel.findByUserId(req.user.userId, 1000);
      const tradesBySymbol = new Map<string, { strategy_id: number; strategy_name?: string; latest_trade_at: Date }>();
      
      // Agrupar trades por símbolo (mantener el más reciente)
      userTrades.forEach((trade) => {
        const symbol = trade.symbol.toUpperCase();
        const existing = tradesBySymbol.get(symbol);
        const tradeDate = new Date(trade.executed_at);
        
        if (!existing || tradeDate > existing.latest_trade_at) {
          tradesBySymbol.set(symbol, {
            strategy_id: trade.strategy_id,
            strategy_name: null, // Se cargará después
            latest_trade_at: tradeDate,
          });
        }
      });
      
      // Cargar nombres de estrategias
      if (tradesBySymbol.size > 0) {
        const strategyIds = Array.from(new Set(Array.from(tradesBySymbol.values()).map(t => t.strategy_id)));
        const strategies = await StrategyModel.findAll(true);
        const strategyMap = new Map(strategies.map(s => [s.id, s.name]));
        
        // Actualizar nombres de estrategias
        tradesBySymbol.forEach((value, symbol) => {
          value.strategy_name = strategyMap.get(value.strategy_id) || null;
        });
      }
      
      const openPositions = (openPositionsData || []).map((pos: any) => {
        const openTime = pos.cTime ? parseInt(pos.cTime) : Date.now();
        const updateTime = pos.uTime ? parseInt(pos.uTime) : (pos.cTime ? parseInt(pos.cTime) : Date.now());
        const symbol = pos.symbol?.toUpperCase();
        const posSide = pos.holdSide?.toLowerCase();
        
        // Extraer datos de posición abierta
        const positionSize = pos.total || pos.available || '0';
        const openPrice = pos.openPriceAvg || pos.averageOpenPrice || pos.openAvgPrice || null;
        const marginMode = pos.marginMode || pos.marginCoin || 'crossed';
        const leverage = pos.leverage || '1';
        
        // PnL no realizado
        const unrealizedPnl = parseFloat(pos.unrealizedPL || pos.upl || pos.pnl || '0');
        const totalFees = Math.abs(parseFloat(pos.totalFee || pos.fee || '0'));
        const netPnl = unrealizedPnl - totalFees;
        
        // Verificar si esta posición es automática (tiene trades registrados para este símbolo)
        const tradeInfo = tradesBySymbol.get(symbol);
        const isAutomatic = !!tradeInfo;
        
        console.log(`[UserController] ✓ OPEN ${symbol} ${posSide}: size=${positionSize}, open=${openPrice}, leverage=${leverage}x, unrealizedPnL=${unrealizedPnl}, fees=${totalFees}, automatic=${isAutomatic}`);
        
        return {
          position_id: pos.positionId || pos.posId || `${pos.symbol}_${openTime}_open`,
          symbol: symbol || 'N/A',
          pos_side: posSide || 'net',
          status: 'open' as const,
          side: posSide === 'long' ? 'buy' : 'sell',
          leverage: leverage,
          margin_mode: marginMode,
          open_price: openPrice,
          close_price: null,
          size: positionSize,
          total_pnl: unrealizedPnl,
          total_fees: totalFees,
          net_pnl: netPnl,
          opened_at: new Date(openTime).toISOString(),
          closed_at: null,
          latest_update: new Date(updateTime).toISOString(),
          is_automatic: isAutomatic,
          strategy_id: tradeInfo?.strategy_id || null,
          strategy_name: tradeInfo?.strategy_name || null,
          open_orders: [],
          close_orders: [],
        };
      });

      // Combinar posiciones abiertas y cerradas
      const allPositions = [...closedPositions, ...openPositions];

      // Ordenar por fecha más reciente
      allPositions.sort((a, b) => {
        return new Date(b.latest_update).getTime() - new Date(a.latest_update).getTime();
      });

      res.json(allPositions);
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

