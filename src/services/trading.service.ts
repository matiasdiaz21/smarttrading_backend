import crypto from 'crypto';
import { BitgetService } from './bitget.service';
import { BybitService } from './bybit.service';
import { CredentialsModel } from '../models/Credentials';
import { BybitCredentialsModel } from '../models/BybitCredentials';
import { SubscriptionModel } from '../models/Subscription';
import { TradeModel } from '../models/Trade';
import { UserModel } from '../models/User';
import { PaymentSubscriptionModel } from '../models/PaymentSubscription';
import { NotificationModel } from '../models/Notification';
import { TradingViewAlert } from '../types';
import { decrypt } from '../utils/encryption';
import OrderErrorModel from '../models/orderError.model';
import { StrategyModel } from '../models/Strategy';
import { AppSettingsModel } from '../models/AppSettings';
import { isStrategyFreeAndActive } from '../utils/strategyUtils';
import { userHasActiveFreeTrial } from '../utils/freeTrialUtils';
import type { ExchangeType } from '../types';

export class TradingService {
  private bitgetService: BitgetService;
  private bybitService: BybitService;

  constructor() {
    this.bitgetService = new BitgetService();
    this.bybitService = new BybitService();
  }

  async executeTradeForUser(
    userId: number,
    strategyId: number,
    alert: TradingViewAlert
  ): Promise<{ success: boolean; orderId?: string; error?: string; fillEntryPrice?: number; fillNotional?: number }> {
    try {
      console.log(`[TradeService] 🔍 Verificando condiciones para usuario ${userId}...`);
      
      // Verificar que el usuario exista
      const user = await UserModel.findById(userId);
      if (!user) {
        console.error(`[TradeService] ❌ Usuario ${userId} no encontrado`);
        return { success: false, error: 'User not found' };
      }

      // Verificar: pago activo, o estrategia gratuita vigente, o prueba gratuita GLOBAL (usuarios nuevos X días; sobrescribe configuración de estrategia) (excepto admin)
      if (user.role !== 'admin') {
        const activePayment = await PaymentSubscriptionModel.findActiveByUserId(userId);
        const strategy = await StrategyModel.findById(strategyId);
        const freeAndActive = strategy ? isStrategyFreeAndActive(strategy as any) : false;
        const appSettings = await AppSettingsModel.get();
        const hasFreeTrial = userHasActiveFreeTrial(user, appSettings);
        if (!activePayment && !freeAndActive && !hasFreeTrial) {
          console.warn(`[TradeService] ⚠️ Usuario ${userId} no tiene suscripción de pago, ni estrategia gratuita vigente, ni prueba activa`);
          return { success: false, error: 'User does not have an active payment subscription' };
        }
        if (activePayment) {
          console.log(`[TradeService] ✅ Usuario ${userId} tiene suscripción de pago activa`);
        } else if (hasFreeTrial) {
          console.log(`[TradeService] ✅ Usuario ${userId} está en período de prueba gratuita`);
        } else {
          console.log(`[TradeService] ✅ Estrategia ${strategyId} es gratuita y vigente para usuario ${userId}`);
        }
      } else {
        console.log(`[TradeService] ✅ Usuario ${userId} es administrador - se omite verificación de suscripción de pago`);
      }

      // Verificar que el usuario tenga suscripción a la estrategia activada
      const strategySubscription = await SubscriptionModel.findById(userId, strategyId);
      if (!strategySubscription || !strategySubscription.is_enabled) {
        console.warn(`[TradeService] ⚠️ Usuario ${userId} no tiene suscripción activa a la estrategia ${strategyId}`);
        return { success: false, error: 'User does not have active subscription to this strategy' };
      }
      console.log(`[TradeService] ✅ Usuario ${userId} tiene suscripción activa a la estrategia ${strategyId}`);

      // Obtener el leverage del usuario (si tiene uno personalizado) o el de la estrategia por defecto
      // PRIORIDAD: 1. Leverage del usuario en user_strategy_subscriptions, 2. Leverage de la estrategia, 3. 10x por defecto
      const strategy = await StrategyModel.findById(strategyId);
      
      let leverage: number;
      let leverageSource: string;
      
      // Verificar si el usuario tiene leverage personalizado en user_strategy_subscriptions
      const userLeverage = strategySubscription.leverage;
      console.log(`[TradeService] 🔍 Verificando leverage - Usuario: ${userLeverage}, Estrategia: ${strategy?.leverage || 'N/A'}`);
      
      if (userLeverage !== null && userLeverage !== undefined && userLeverage > 0) {
        // Usuario configuró leverage personalizado - PRIORIDAD MÁXIMA
        leverage = userLeverage;
        leverageSource = 'personalizado del usuario (user_strategy_subscriptions)';
        console.log(`[TradeService] ✅ Usando leverage personalizado del usuario: ${leverage}x`);
      } else if (strategy?.leverage && strategy.leverage > 0) {
        // Usar leverage por defecto de la estrategia
        leverage = strategy.leverage;
        leverageSource = 'por defecto de la estrategia';
        console.log(`[TradeService] ✅ Usando leverage de la estrategia: ${leverage}x`);
      } else {
        // Usar leverage por defecto del sistema (10x)
        leverage = 10;
        leverageSource = 'por defecto del sistema';
        console.log(`[TradeService] ✅ Usando leverage por defecto del sistema: ${leverage}x`);
      }
      
      console.log(`[TradeService] 📊 Apalancamiento final seleccionado: ${leverage}x (${leverageSource})`);

      const exchange: ExchangeType = strategySubscription.exchange || 'bitget';

      // Obtener credencial asignada a esta estrategia (cada estrategia tiene una credencial 1:1)
      if (!strategySubscription.credential_id) {
        console.error(`[TradeService] ❌ La estrategia ${strategyId} no tiene credencial de exchange asignada`);
        return { success: false, error: 'This strategy has no credential assigned. Assign one in your strategy settings.' };
      }
      let decryptedCredentials: any;
      if (exchange === 'bybit') {
        const credentials = await BybitCredentialsModel.findById(strategySubscription.credential_id, userId);
        if (!credentials) {
          console.error(`[TradeService] ❌ Credencial Bybit ${strategySubscription.credential_id} no encontrada`);
          return { success: false, error: 'Bybit credential not found or invalid' };
        }
        decryptedCredentials = BybitService.getDecryptedCredentials({ api_key: credentials.api_key, api_secret: credentials.api_secret });
      } else {
        const credentials = await CredentialsModel.findById(strategySubscription.credential_id, userId);
        if (!credentials) {
          console.error(`[TradeService] ❌ Credencial Bitget ${strategySubscription.credential_id} no encontrada`);
          return { success: false, error: 'Bitget credential not found or invalid' };
        }
        decryptedCredentials = BitgetService.getDecryptedCredentials({
          api_key: credentials.api_key,
          api_secret: credentials.api_secret,
          passphrase: credentials.passphrase,
        });
      }
      console.log(`[TradeService] ✅ Usando credencial ${strategySubscription.credential_id} (${exchange}) para estrategia ${strategyId}`);

      // Normalizar campos que pueden venir en snake_case desde TradingView/Pine (mismo criterio que test-orders)
      if (alert.stopLoss == null && (alert as any).stop_loss != null) alert.stopLoss = (alert as any).stop_loss;
      if (alert.takeProfit == null && (alert as any).take_profit != null) alert.takeProfit = (alert as any).take_profit;
      if (alert.entryPrice == null && (alert as any).entry_price != null) alert.entryPrice = (alert as any).entry_price;
      if (alert.breakeven == null && (alert as any).breakeven != null) alert.breakeven = (alert as any).breakeven;

      // Preparar datos de la orden
      // Para ENTRY, usar entryPrice si está disponible, sino usar price
      const entryPrice = alert.entryPrice || alert.price;
      
      // Remover .P del símbolo si existe (Bitget no acepta .P en el símbolo)
      const symbol = alert.symbol ? alert.symbol.replace(/\.P$/, '') : alert.symbol;
      
      if (!symbol) {
        console.error(`[TradeService] ❌ Symbol no proporcionado en la alerta`);
        return { success: false, error: 'Symbol is required' };
      }

      const symbolUpper = symbol.toUpperCase();
      const rawAllowed = strategy?.allowed_symbols;
      const allowedSymbols = typeof rawAllowed === 'string'
        ? (() => { try { const a = JSON.parse(rawAllowed); return Array.isArray(a) ? a : null; } catch { return null; } })()
        : rawAllowed;
      if (Array.isArray(allowedSymbols) && allowedSymbols.length > 0) {
        const allowedUpper = allowedSymbols.map((s: string) => String(s).toUpperCase());
        if (!allowedUpper.includes(symbolUpper)) {
          console.warn(`[TradeService] ⚠️ Símbolo ${symbolUpper} no permitido para la estrategia "${strategy?.name}". Permitidos: ${allowedUpper.join(', ')}`);
          return { success: false, error: `Symbol ${symbolUpper} is not allowed for this strategy. Allowed: ${allowedUpper.join(', ')}` };
        }
        console.log(`[TradeService] ✅ Símbolo ${symbolUpper} permitido para la estrategia`);
      }

      const rawExcluded = strategySubscription.excluded_symbols;
      const excludedSymbols = typeof rawExcluded === 'string'
        ? (() => { try { const a = JSON.parse(rawExcluded); return Array.isArray(a) ? a : []; } catch { return []; } })()
        : (Array.isArray(rawExcluded) ? rawExcluded : []);
      if (excludedSymbols.length > 0) {
        const excludedUpper = excludedSymbols.map((s: string) => String(s).toUpperCase());
        if (excludedUpper.includes(symbolUpper)) {
          console.warn(`[TradeService] ⚠️ Usuario excluyó el símbolo ${symbolUpper} para esta estrategia. No se copiará.`);
          return { success: false, error: `Symbol ${symbolUpper} is excluded by you for this strategy` };
        }
      }

      const productType = alert.productType || 'USDT-FUTURES';
      
      // Obtener información del contrato para validar el tamaño de la orden
      let contractInfo: any;
      try {
        if (exchange === 'bybit') {
          contractInfo = await this.bybitService.getContractInfo(symbol, 'linear');
        } else {
          contractInfo = await this.bitgetService.getContractInfo(symbol, productType);
        }
        console.log(`[TradeService] 📊 Información del contrato para ${symbol}:`, contractInfo);
      } catch (error: any) {
        console.warn(`[TradeService] ⚠️ No se pudo obtener información del contrato: ${error.message}. Usando valores por defecto.`);
        contractInfo = {
          minTradeNum: '0.01',
          sizeMultiplier: '0.01',
          minTradeUSDT: '5',
          volumePlace: '2',
          pricePlace: '1',
        };
      }

      // CONVENCIÓN PARA CRUCE CON SIMULACIÓN / WEBHOOK-LOGS:
      // position_size (USDT) = VALOR NOTIONAL de la posición (no margen). Es decir: valor en USDT de la posición al precio de entrada.
      // Fórmula ejecutada: contratos = position_size / precio_entrada (redondeado al step del contrato).
      // Para que la simulación coincida con la ejecución real, la sim debe usar la misma regla: PnL_sim = contratos_sim * (precio_salida - precio_entrada) con contratos_sim = position_size_usdt / precio_entrada.
      //
      // PRIORIDAD: 0. % riesgo (si position_sizing_mode === 'risk_percent'), 1. position_size personalizado del usuario, 2. alert.size, 3. minTradeUSDT calculado
      let requestedSize = alert.size;
      let positionSizeSource = 'alerta (alert.size)';

      const positionSizingMode = strategySubscription.position_sizing_mode || 'fixed_usdt';
      const riskPercent = strategySubscription.risk_percent != null ? Number(strategySubscription.risk_percent) : null;

      if (positionSizingMode === 'risk_percent' && riskPercent != null && riskPercent > 0 && entryPrice && alert.stopLoss != null) {
        const price = parseFloat(entryPrice.toString());
        const stopLossNum = parseFloat(alert.stopLoss.toString());
        const distanceSl = Math.abs(price - stopLossNum);
        if (distanceSl <= 0) {
          console.warn(`[TradeService] ⚠️ Modo % riesgo: distance_sl <= 0 (entry=${price}, sl=${stopLossNum}). Usando tamaño mínimo.`);
          requestedSize = contractInfo.minTradeNum;
          positionSizeSource = 'mínimo (risk_percent sin distance_sl válida)';
        } else {
          try {
            let availableBalance: number;
            if (exchange === 'bybit') {
              const bal = await this.bybitService.getAccountBalance(decryptedCredentials);
              availableBalance = bal.available;
            } else {
              const bal = await this.bitgetService.getAccountBalance(decryptedCredentials, productType, 'USDT');
              availableBalance = bal.available;
            }
            const riskUsdt = availableBalance * (riskPercent / 100);
            const contracts = riskUsdt / distanceSl;
            const notional = contracts * price;
            const minUSDT = parseFloat(contractInfo.minTradeUSDT);
            const effectiveNotional = Math.max(notional, minUSDT * 1.05);
            requestedSize = (effectiveNotional / price).toString();
            positionSizeSource = `% riesgo (${riskPercent}% de ${availableBalance.toFixed(2)} USDT, risk_usdt=${riskUsdt.toFixed(2)}, distance_sl=${distanceSl.toFixed(4)})`;
            console.log(`[TradeService] ✅ Tamaño por % riesgo: ${requestedSize} contratos (notional ≈ ${effectiveNotional.toFixed(2)} USDT)`);
          } catch (balanceError: any) {
            console.warn(`[TradeService] ⚠️ Modo % riesgo: no se pudo obtener balance (${balanceError.message}). Usando tamaño mínimo.`);
            requestedSize = contractInfo.minTradeNum;
            positionSizeSource = 'mínimo (error balance en risk_percent)';
          }
        }
      } else if (positionSizingMode === 'risk_percent' && (riskPercent == null || riskPercent <= 0 || !entryPrice || alert.stopLoss == null)) {
        console.warn(`[TradeService] ⚠️ Modo % riesgo activo pero falta risk_percent, entryPrice o stopLoss. Usando tamaño mínimo.`);
        requestedSize = requestedSize || contractInfo.minTradeNum;
        positionSizeSource = positionSizeSource === 'alerta (alert.size)' ? 'mínimo (risk_percent sin SL/entry)' : positionSizeSource;
      }

      const userPositionSize = strategySubscription.position_size;
      if (positionSizingMode === 'fixed_usdt' && userPositionSize !== null && userPositionSize !== undefined && userPositionSize > 0 && entryPrice) {
        // position_size en USDT = notional (valor de la posición). Contratos = position_size / precio_entrada.
        // IMPORTANTE: Agregar margen de seguridad del 10% para órdenes de mercado
        // porque el precio puede variar ligeramente y caer por debajo del mínimo
        const price = parseFloat(entryPrice.toString());
        const minUSDT = parseFloat(contractInfo.minTradeUSDT);
        const userPositionSizeNum = parseFloat(userPositionSize.toString());
        
        // Si el position_size está muy cerca del mínimo, agregar margen de seguridad
        const effectivePositionSize = userPositionSizeNum < minUSDT * 1.5 
          ? userPositionSizeNum * 1.1  // Agregar 10% de margen si está cerca del mínimo
          : userPositionSizeNum;
        
        requestedSize = (effectivePositionSize / price).toString();
        positionSizeSource = `personalizado del usuario (${userPositionSizeNum.toFixed(2)} USDT${effectivePositionSize !== userPositionSizeNum ? ' + 10% margen' : ''})`;
        console.log(`[TradeService] ✅ Usando position_size personalizado: ${effectivePositionSize.toFixed(8)} USDT / ${price} = ${requestedSize} contratos`);
        
        if (effectivePositionSize !== userPositionSizeNum) {
          console.log(`[TradeService] 📊 Margen de seguridad aplicado: ${userPositionSizeNum.toFixed(2)} USDT → ${effectivePositionSize.toFixed(2)} USDT (para evitar rechazo por precio de mercado)`);
        }
      } else if (!requestedSize && entryPrice) {
        // Calcular el tamaño mínimo basado en minTradeUSDT y el precio de entrada
        const minUSDT = parseFloat(contractInfo.minTradeUSDT);
        const price = parseFloat(entryPrice.toString());
        
        // Tamaño mínimo = minTradeUSDT / precio
        // Añadir un pequeño margen (5%) para asegurar que se cumpla el mínimo
        requestedSize = ((minUSDT * 1.05) / price).toString();
        positionSizeSource = 'calculado automáticamente (minTradeUSDT)';
        console.log(`[TradeService] 📊 Calculando tamaño basado en minTradeUSDT: ${minUSDT} USDT / ${price} = ${requestedSize} contratos`);
      } else if (!requestedSize) {
        requestedSize = contractInfo.minTradeNum;
        positionSizeSource = 'mínimo del contrato (minTradeNum)';
      }
      
      console.log(`[TradeService] 📊 Tamaño de posición seleccionado: ${requestedSize} contratos (${positionSizeSource})`);
      
      const calcOrderSize = (req: string, min: string, mult: string) =>
        exchange === 'bybit'
          ? this.bybitService.calculateOrderSize(req, min, mult)
          : this.bitgetService.calculateOrderSize(req, min, mult);
      let calculatedSize = calcOrderSize(requestedSize, contractInfo.minTradeNum, contractInfo.sizeMultiplier);

      // Convertir side de LONG/SHORT a buy/sell para Bitget
      const bitgetSide: 'buy' | 'sell' = alert.side === 'LONG' || alert.side === 'buy' ? 'buy' : 'sell';

      // Verificar que el valor notional cumpla con el mínimo de USDT
      if (entryPrice) {
        const notionalValue = parseFloat(calculatedSize) * parseFloat(entryPrice.toString());
        const minUSDT = parseFloat(contractInfo.minTradeUSDT);
        console.log(`[TradeService] 📏 Tamaño calculado: ${calculatedSize} contratos, Valor notional: ${notionalValue.toFixed(2)} USDT (mínimo: ${minUSDT} USDT)`);
        
        if (notionalValue < minUSDT) {
          console.warn(`[TradeService] ⚠️ Valor notional (${notionalValue.toFixed(2)} USDT) es menor al mínimo (${minUSDT} USDT). Ajustando tamaño...`);
          // Recalcular el tamaño para cumplir con el mínimo
          // Si el usuario configuró un position_size personalizado pero es menor al mínimo, usar el mínimo
          const adjustedSize = ((minUSDT * 1.05) / parseFloat(entryPrice.toString())).toString();
          calculatedSize = calcOrderSize(adjustedSize, contractInfo.minTradeNum, contractInfo.sizeMultiplier);
          console.log(`[TradeService] ✅ Tamaño ajustado: ${calculatedSize} contratos, Valor notional ajustado: ${(parseFloat(calculatedSize) * parseFloat(entryPrice.toString())).toFixed(2)} USDT`);
          console.log(`[TradeService] ⚠️ Nota: El position_size configurado era menor al mínimo requerido, se usó el mínimo`);
        }
      } else {
        console.log(`[TradeService] 📏 Tamaño solicitado: ${requestedSize}, Tamaño calculado: ${calculatedSize}`);
      }

      // Si la señal tiene breakeven y el usuario tiene TP parcial, asegurar tamaño >= 2× minTradeNum
      // para poder colocar TP 50% en breakeven + TP 50% en take profit (Bitget exige mínimo por orden)
      const usePartialTp = strategySubscription.use_partial_tp !== false;
      let breakevenPrice = alert.breakeven ? parseFloat(alert.breakeven.toString()) : undefined;
      
      // Auto-calcular breakeven si no viene en la alerta pero TP parcial está habilitado
      if (!breakevenPrice && usePartialTp && entryPrice && alert.takeProfit) {
        const entryNum = parseFloat(entryPrice.toString());
        const tpNum = parseFloat(alert.takeProfit.toString());
        breakevenPrice = entryNum + (tpNum - entryNum) / 2;
        console.log(`[TradeService] 📊 TP Parcial (Breakeven) calculado automáticamente (50% de recorrido): ${breakevenPrice}`);
      }

      if (breakevenPrice && breakevenPrice > 0 && usePartialTp) {
        const minTradeNum = parseFloat(contractInfo.minTradeNum || '0.01');
        const minSizeForPartial = 2 * minTradeNum;
        if (parseFloat(calculatedSize) < minSizeForPartial - 1e-8) {
          const previousSize = calculatedSize;
          calculatedSize = calcOrderSize(minSizeForPartial.toString(), contractInfo.minTradeNum, contractInfo.sizeMultiplier);
          const approxUsdt = entryPrice ? (parseFloat(calculatedSize) * parseFloat(entryPrice.toString())).toFixed(2) : '?';
          console.log(`[TradeService] 📊 Breakeven activo: tamaño ajustado al mínimo para TP 50%/50% (≥ 2× min): ${previousSize} → ${calculatedSize} contratos (~${approxUsdt} USDT)`);
        }
      }

      // Configurar el apalancamiento Y verificar posiciones existentes EN PARALELO
      // (Optimización: antes eran 2 llamadas secuenciales + 500ms delay = ~1.5s, ahora ~0.5s)
      const holdSide = alert.side === 'LONG' || alert.side === 'buy' ? 'long' : 'short';
      
      let existingPosition = null;
      let actualPositionSize = calculatedSize;
      let shouldOpenPosition = true;
      let result: any = null;
      let tpslConfigured = false;
      let tpslError: any = null;
      let usedOpenWithFullTPSL = false;

      console.log(`[TradeService] ⚡ Ejecutando setLeverage + getPositions en PARALELO para ${symbol}...`);
      const [leverageResult, positionsResult] = await Promise.allSettled([
        exchange === 'bybit'
          ? this.bybitService.setLeverage(decryptedCredentials, symbol, leverage)
          : this.bitgetService.setLeverage(
              decryptedCredentials,
              symbol,
              leverage,
              productType,
              alert.marginCoin || 'USDT',
              holdSide,
              { userId, strategyId }
            ),
        exchange === 'bybit'
          ? this.bybitService.getPositions(decryptedCredentials, symbol, 'linear')
          : this.bitgetService.getPositions(decryptedCredentials, symbol, productType),
      ]);

      // Evaluar resultado de leverage (CRÍTICO - falla = abortar)
      if (leverageResult.status === 'rejected') {
        const leverageError = leverageResult.reason;
        console.error(`[TradeService] ❌ ERROR CRÍTICO: No se pudo configurar el apalancamiento a ${leverage}x: ${leverageError.message}`);
        throw new Error(`No se pudo configurar el apalancamiento a ${leverage}x: ${leverageError.message}. La operación se ha cancelado para evitar usar un leverage incorrecto.`);
      }
      console.log(`[TradeService] ✅ Apalancamiento configurado exitosamente a ${leverage}x para ${symbol}`);

      // Evaluar resultado de getPositions (no crítico - si falla, simplemente abrimos)
      if (positionsResult.status === 'fulfilled') {
        const positions = positionsResult.value;
        if (positions && positions.length > 0) {
          const matchingPosition = positions.find((p: any) => 
            p.symbol === symbol && 
            p.holdSide === holdSide &&
            parseFloat(p.total || p.available || '0') > 0
          );
          
          if (matchingPosition) {
            existingPosition = matchingPosition;
            actualPositionSize = matchingPosition.total || matchingPosition.available || matchingPosition.size || calculatedSize;
            shouldOpenPosition = false;
            console.log(`[TradeService] ⚠️ Ya existe una posición ${holdSide} para ${symbol} con tamaño ${actualPositionSize}. No se abrirá nueva posición.`);
            console.log(`[TradeService] 🎯 Se configurarán TP/SL para la posición existente.`);
            if (matchingPosition.positionId || matchingPosition.id) {
              result = { orderId: matchingPosition.positionId || matchingPosition.id };
            }
          }
        }
      } else {
        console.warn(`[TradeService] ⚠️ No se pudo verificar posiciones existentes: ${positionsResult.reason?.message}. Se intentará abrir la posición.`);
      }
      
      // Apertura de posición: sin fallbacks. Si hay error en cancelación de triggers o en la orden, la posición no se abre.
      if (shouldOpenPosition) {
        // 1) Limpiar TODOS los triggers (SL/TP) del símbolo. Obligatorio: si falla o quedan triggers, no se abre posición.
        const cancelResult =
          exchange === 'bybit'
            ? await this.bybitService.cancelAllTriggerOrders(decryptedCredentials, symbol.toUpperCase(), 'linear', alert.marginCoin || 'USDT')
            : await this.bitgetService.cancelAllTriggerOrders(
                decryptedCredentials,
                symbol.toUpperCase(),
                productType,
                alert.marginCoin || 'USDT',
                { userId, strategyId }
              );
        if (exchange === 'bitget' && (cancelResult as { remaining?: number }).remaining != null && (cancelResult as { remaining: number }).remaining > 0) {
          const msg = `No se pudieron cancelar todos los triggers en ${symbol} (quedan ${(cancelResult as { remaining: number }).remaining}). No se abre posición.`;
          console.error(`[TradeService] ❌ ${msg}`);
          throw new Error(msg);
        }
        if ((cancelResult as { cancelled?: number }).cancelled != null && (cancelResult as { cancelled: number }).cancelled > 0) {
          console.log(`[TradeService] 🗑️ Cancelados ${(cancelResult as { cancelled: number }).cancelled} triggers en ${symbol} antes de abrir.`);
        }

        // Generar clientOid único con alta entropía para evitar 40786 (Duplicate clientOid) en reintentos
        const ts = Date.now();
        const hexEntropy = crypto.randomBytes(4).toString('hex');
        const randomSuffix = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
        const uniqueClientOid = `ST_${userId}_${strategyId}_${alert.trade_id || 'ENTRY'}_${ts}_${randomSuffix}_${hexEntropy}`.substring(0, 64);
        
        const orderData = {
          symbol: symbol,
          productType: productType,
          marginMode: alert.marginMode || 'isolated',
          marginCoin: alert.marginCoin || 'USDT',
          size: calculatedSize,
          price: entryPrice ? entryPrice.toString() : undefined,
          side: bitgetSide,
          tradeSide: alert.tradeSide || 'open',
          orderType: (alert.orderType || 'market') as 'market' | 'limit',
          force: alert.force || (alert.orderType === 'limit' ? 'gtc' : undefined),
          clientOid: uniqueClientOid,
        };

        if (alert.stopLoss != null && alert.takeProfit != null) {
          // Mismo flujo que /admin/test-orders: openPositionWithFullTPSL (open + SL + TP en un solo método)
          try {
            console.log(`[TradeService] 🚀 Abriendo posición + TP/SL con mismo flujo que test-orders (openPositionWithFullTPSL)...`);
            const tpslData: { stopLossPrice: number; takeProfitPrice: number; takeProfitPartialPrice?: number } = {
              stopLossPrice: parseFloat(alert.stopLoss.toString()),
              takeProfitPrice: parseFloat(alert.takeProfit.toString()),
            };
            if (breakevenPrice && breakevenPrice > 0) {
              tpslData.takeProfitPartialPrice = breakevenPrice;
            }
            const openResult =
              exchange === 'bybit'
                ? await this.bybitService.openPositionWithFullTPSL(
                    decryptedCredentials,
                    {
                      symbol: symbol.toUpperCase(),
                      size: calculatedSize,
                      price: orderData.price || '',
                      side: bitgetSide,
                      orderType: orderData.orderType,
                      clientOid: uniqueClientOid,
                    },
                    tpslData,
                    contractInfo,
                    { userId, strategyId }
                  )
                : await (() => {
                    const orderDataForOpen = {
                      symbol: symbol.toUpperCase(),
                      productType,
                      marginMode: alert.marginMode || 'isolated',
                      marginCoin: alert.marginCoin || 'USDT',
                      size: calculatedSize,
                      price: orderData.price || '',
                      side: bitgetSide,
                      orderType: orderData.orderType,
                      clientOid: uniqueClientOid,
                    };
                    if (tpslData.takeProfitPartialPrice != null && orderDataForOpen.orderType !== 'limit') {
                      orderDataForOpen.orderType = 'limit';
                      orderDataForOpen.price = orderData.price ?? String(alert.entry_price ?? '');
                    }
                    return this.bitgetService.openPositionWithFullTPSL(
                      decryptedCredentials,
                      orderDataForOpen,
                      tpslData,
                      contractInfo,
                      { userId, strategyId }
                    );
                  })();
            if (openResult.success && openResult.orderId) {
              result = { orderId: openResult.orderId, clientOid: uniqueClientOid };
              actualPositionSize = calculatedSize;
              usedOpenWithFullTPSL = true;
              const steps = openResult.tpslResults || [];
              tpslConfigured = steps.some((r: any) => (r.type === 'open_with_sl_tp' && r.success) || (r.type === 'limit_open_sl' && r.success));
              console.log(`[TradeService] ✅ Posición + TP/SL. Method: ${openResult.method}. OrderId: ${openResult.orderId}, TP/SL OK: ${tpslConfigured}`);
            } else {
              console.error(`[TradeService] ❌ openPositionWithFullTPSL no retornó success. No se abre orden por fallback (mismo comportamiento que el flujo original).`);
              throw new Error(`openPositionWithFullTPSL falló (sin success). No se ejecutará apertura alternativa.`);
            }
          } catch (openWithTpslError: any) {
            console.error(`[TradeService] ❌ Error en openPositionWithFullTPSL: ${openWithTpslError.message}. No se abre orden por fallback.`);
            throw openWithTpslError;
          }
        }

        // Solo abrir orden por separado cuando NUNCA se intentó openPositionWithFullTPSL (ej. señal sin SL/TP).
        // Si se intentó openPositionWithFullTPSL y falló, no abrir otra orden (evitar comportamiento distinto al original).
        if (!usedOpenWithFullTPSL) {
          try {
            console.log(`[TradeService] 🚀 Ejecutando orden en ${exchange} para usuario ${userId}...`);
            console.log(`[TradeService] 📋 Datos de la orden:`, JSON.stringify(orderData, null, 2));
            if (exchange === 'bybit') {
              result = await this.bybitService.placeOrder(decryptedCredentials, {
                symbol: symbol.toUpperCase(),
                side: bitgetSide,
                orderType: orderData.orderType,
                qty: calculatedSize,
                price: orderData.price,
                orderLinkId: uniqueClientOid,
              });
              result = { orderId: result.orderId, clientOid: result.orderLinkId || uniqueClientOid };
            } else {
              result = await this.bitgetService.placeOrder(
                decryptedCredentials,
                orderData,
                { userId, strategyId }
              );
            }
            console.log(`[TradeService] ✅ Orden ejecutada en ${exchange}. Order ID: ${result.orderId}, Client OID: ${result.clientOid}`);

            actualPositionSize = calculatedSize;
            console.log(`[TradeService] 📊 Usando tamaño calculado como posición real: ${actualPositionSize}`);
          } catch (orderError: any) {
            console.error(`[TradeService] ❌ Error al ejecutar orden: ${orderError.message}. No se abre posición.`);
            throw orderError;
          }
        }
      }

      // Configurar Stop Loss y Take Profit cuando la orden se abrió por separado (placeOrder sin openPositionWithFullTPSL).
      // Solo Bitget; Bybit abre con TP/SL en una sola llamada.
      if (alert.stopLoss && alert.takeProfit && !usedOpenWithFullTPSL && exchange === 'bitget') {
        try {
          console.log(`[TradeService] 📊 Configurando TP/SL para posición abierta...`);
          console.log(`[TradeService]   SL: ${alert.stopLoss} | BE: ${alert.breakeven || 'N/A'} | TP: ${alert.takeProfit} | Size: ${actualPositionSize}`);
          
          const usePartialTp = strategySubscription.use_partial_tp !== false;
          const hasBreakeven = alert.breakeven && parseFloat(alert.breakeven.toString()) > 0 && usePartialTp;
          const fallbackLogContext = { userId, strategyId, orderId: result?.orderId };
          
          const tpslResults = await this.bitgetService.setPositionTPSLTriggers(
            decryptedCredentials,
            {
              symbol: symbol.toUpperCase(),
              productType,
              marginMode: alert.marginMode || 'isolated',
              marginCoin: alert.marginCoin || 'USDT',
              side: bitgetSide,
              size: actualPositionSize,
            },
            {
              stopLossPrice: parseFloat(alert.stopLoss.toString()),
              takeProfitPrice: parseFloat(alert.takeProfit.toString()),
              breakevenPrice: hasBreakeven ? parseFloat(alert.breakeven!.toString()) : undefined,
            },
            contractInfo,
            fallbackLogContext,
            entryPrice ? parseFloat(entryPrice.toString()) : undefined
          );
          
          const slOk = tpslResults.some(r => r.type === 'stop_loss' && r.success);
          const tpOk = tpslResults.some(r => ['take_profit', 'take_profit_final', 'take_profit_partial'].includes(r.type) && r.success);
          
          if (slOk && tpOk) {
            console.log(`[TradeService] ✅ TP/SL configurados correctamente`);
            tpslConfigured = true;
          } else if (!slOk && !tpOk) {
            console.error(`[TradeService] ❌ CRÍTICO: Ni TP ni SL se pudieron configurar`);
            tpslError = { type: 'tp_sl_failed', slSuccess: slOk, tpSuccess: tpOk, results: tpslResults };
          } else if (!slOk) {
            console.error(`[TradeService] ❌ CRÍTICO: Stop Loss no se pudo configurar`);
            tpslError = { type: 'sl_failed', slSuccess: slOk, tpSuccess: tpOk, results: tpslResults };
          } else {
            console.error(`[TradeService] ⚠️ ADVERTENCIA: Take Profit no se pudo configurar`);
            tpslError = { type: 'tp_failed', slSuccess: slOk, tpSuccess: tpOk, results: tpslResults };
          }
        } catch (error: any) {
          console.error(`[TradeService] ⚠️ Error al configurar TP/SL: ${error.message}`);
          tpslError = { type: 'tp_sl_failed', error: error.message };
        }
      } else if (!alert.stopLoss || !alert.takeProfit) {
        console.warn(`[TradeService] ⚠️ No se configuró TP/SL: stopLoss=${alert.stopLoss}, takeProfit=${alert.takeProfit}`);
      }

      // Registrar trade en base de datos con toda la información
      // Convertir side a buy/sell para la base de datos
      const dbSide: 'buy' | 'sell' = alert.side === 'LONG' || alert.side === 'buy' ? 'buy' : 'sell';
      
      const tradeId = await TradeModel.create(
        userId,
        strategyId,
        result?.orderId || existingPosition?.positionId || 'N/A',
        alert.symbol,
        dbSide,
        alert.orderType || 'market',
        actualPositionSize,
        entryPrice ? entryPrice.toString() : null,
        'pending',
        alert.trade_id || null,
        alert.entryPrice || null,
        alert.stopLoss || null,
        alert.takeProfit || null,
        alert.breakeven || null,
        alert.alertType || 'ENTRY',
        exchange
      );

      console.log(`[TradeService] ✅ Trade registrado en base de datos con ID: ${tradeId}`);

      // Crear notificación para el usuario
      try {
        if (tpslConfigured) {
          // Trade ejecutado exitosamente con TP/SL
          await NotificationModel.create(
            userId,
            'trade_executed',
            `Trade ejecutado: ${symbol}`,
            `Posición ${bitgetSide === 'buy' ? 'LONG' : 'SHORT'} abierta en ${symbol} con ${actualPositionSize} contratos. TP y SL configurados correctamente.`,
            'info',
            {
              symbol,
              side: bitgetSide,
              size: actualPositionSize,
              entryPrice: alert.entryPrice,
              stopLoss: alert.stopLoss,
              takeProfit: alert.takeProfit,
              orderId: result?.orderId,
              tradeId
            }
          );
        } else if (tpslError) {
          // Trade ejecutado pero con problemas en TP/SL - NOTIFICACIÓN CRÍTICA
          const notifType = tpslError.type || 'tp_sl_failed';
          let title = '';
          let message = '';
          let severity: 'warning' | 'error' | 'critical' = 'critical';
          
          if (notifType === 'tp_sl_failed') {
            title = `⚠️ CRÍTICO: Trade sin protección - ${symbol}`;
            message = `Posición ${bitgetSide === 'buy' ? 'LONG' : 'SHORT'} abierta en ${symbol} pero NO SE PUDO CONFIGURAR ni Take Profit ni Stop Loss. Tu posición está SIN PROTECCIÓN. Configura manualmente TP/SL en Bitget inmediatamente.`;
            severity = 'critical';
          } else if (notifType === 'sl_failed') {
            title = `⚠️ CRÍTICO: Sin Stop Loss - ${symbol}`;
            message = `Posición ${bitgetSide === 'buy' ? 'LONG' : 'SHORT'} abierta en ${symbol} pero NO SE PUDO CONFIGURAR el Stop Loss. Tu posición está sin protección contra pérdidas. Configura manualmente el SL en Bitget inmediatamente.`;
            severity = 'critical';
          } else if (notifType === 'tp_failed') {
            title = `⚠️ Sin Take Profit - ${symbol}`;
            message = `Posición ${bitgetSide === 'buy' ? 'LONG' : 'SHORT'} abierta en ${symbol} pero NO SE PUDO CONFIGURAR el Take Profit. El Stop Loss está activo. Considera configurar manualmente el TP en Bitget.`;
            severity = 'warning';
          }
          
          await NotificationModel.create(
            userId,
            notifType as any,
            title,
            message,
            severity,
            {
              symbol,
              side: bitgetSide,
              size: actualPositionSize,
              entryPrice: alert.entryPrice,
              stopLoss: alert.stopLoss,
              takeProfit: alert.takeProfit,
              orderId: result?.orderId,
              tradeId,
              error: tpslError
            }
          );
        }
      } catch (notifError: any) {
        console.error(`[TradeService] ❌ Error al crear notificación: ${notifError.message}`);
        // No fallar la operación si la notificación falla
      }

      // Obtener precio de fill y notional real para que la simulación en webhook-logs coincida con Bitget/Bybit
      let fillEntryPrice: number | undefined;
      let fillNotional: number | undefined;
      try {
        const getPositionsForFill = () =>
          exchange === 'bybit'
            ? this.bybitService.getPositions(decryptedCredentials, symbol, 'linear')
            : this.bitgetService.getPositions(decryptedCredentials, symbol, productType);
        const positions = await getPositionsForFill();
        const pos = positions?.find((p: any) =>
          (p.symbol || '').toUpperCase() === symbol.toUpperCase() && (p.holdSide || p.side) === holdSide && parseFloat(p.total || p.available || p.size || '0') > 0
        );
        if (pos) {
          const avgPrice = pos.averageOpenPrice ?? pos.openPriceAvg ?? pos.openAvgPrice ?? pos.avgPrice;
          const size = parseFloat(pos.total || pos.available || pos.size || '0');
          if (avgPrice != null && Number.isFinite(size) && size > 0) {
            const price = typeof avgPrice === 'string' ? parseFloat(avgPrice) : Number(avgPrice);
            if (Number.isFinite(price) && price > 0) {
              fillEntryPrice = price;
              fillNotional = size * price;
            }
          }
        }
      } catch (fillErr: any) {
        console.warn(`[TradeService] ⚠️ No se pudo obtener fill para sim: ${fillErr.message}`);
      }

      return {
        success: true,
        orderId: result?.orderId || existingPosition?.positionId || 'existing',
        fillEntryPrice,
        fillNotional,
      };
    } catch (error: any) {
      // Registrar el error en la base de datos para monitoreo
      console.error(`[TradeService] ❌ Error al ejecutar trade en Bitget para usuario ${userId}:`, error.message);
      
      try {
        const tradeId = alert.trade_id ? (typeof alert.trade_id === 'string' ? parseInt(alert.trade_id) : alert.trade_id) : null;
        // Siempre usar 'ENTRY' como alert_type cuando se está procesando un ENTRY
        // (executeTradeForUser solo se llama desde processStrategyAlert para ENTRY)
        await OrderErrorModel.create(
          userId,
          strategyId,
          alert.symbol,
          alert.side,
          'ENTRY', // Siempre ENTRY porque executeTradeForUser solo se llama para procesar ENTRY
          error.message || 'Unknown error',
          tradeId,
          error.response?.data || null,
          alert
        );
        console.log(`[TradeService] 📝 Error registrado en order_errors para monitoreo`);
      } catch (logError: any) {
        console.error(`[TradeService] ⚠️ No se pudo registrar el error en BD:`, logError.message);
      }
      
      return {
        success: false,
        error: error.message || 'Failed to execute trade',
      };
    }
  }

  async processStrategyAlert(
    strategyId: number,
    alert: TradingViewAlert
  ): Promise<{ processed: number; successful: number; failed: number; fillEntryPrice?: number; fillNotional?: number }> {
    console.log(`\n[TradeService] 📊 Procesando alerta ENTRY para estrategia ${strategyId}`);
    console.log(`[TradeService] Symbol: ${alert.symbol}, Side: ${alert.side}, Entry Price: ${alert.entryPrice}`);
    
    // Buscar todos los usuarios suscritos a la estrategia con copia habilitada
    const subscriptions = await SubscriptionModel.findByStrategyId(
      strategyId,
      true // solo habilitadas (is_enabled = true)
    );

    console.log(`[TradeService] ✅ Encontradas ${subscriptions.length} suscripciones activas para la estrategia ${strategyId}`);

    if (subscriptions.length === 0) {
      console.log(`[TradeService] ⚠️ No hay usuarios con suscripción activa para la estrategia ${strategyId}`);
      return {
        processed: 0,
        successful: 0,
        failed: 0,
      };
    }

    let successful = 0;
    let failed = 0;
    let fillEntryPrice: number | undefined;
    let fillNotional: number | undefined;

    // Procesar cada suscripción
    for (const subscription of subscriptions) {
      console.log(`[TradeService] 🔄 Procesando trade para usuario ${subscription.user_id}...`);
      const result = await this.executeTradeForUser(
        subscription.user_id,
        strategyId,
        alert
      );

      if (result.success) {
        console.log(`[TradeService] ✅ Trade ejecutado exitosamente para usuario ${subscription.user_id}. Order ID: ${result.orderId}`);
        successful++;
        if (result.fillEntryPrice != null && result.fillNotional != null && fillEntryPrice == null) {
          fillEntryPrice = result.fillEntryPrice;
          fillNotional = result.fillNotional;
        }
      } else {
        console.error(`[TradeService] ❌ Error al ejecutar trade para usuario ${subscription.user_id}: ${result.error}`);
        failed++;
      }
    }

    console.log(`[TradeService] 📈 Resumen: ${successful} exitosos, ${failed} fallidos de ${subscriptions.length} procesados\n`);

    return {
      processed: subscriptions.length,
      successful,
      failed,
      fillEntryPrice,
      fillNotional,
    };
  }

  async processBreakevenAlert(
    strategyId: number,
    alert: TradingViewAlert
  ): Promise<{ processed: number; successful: number; failed: number }> {
    // NUEVO FLUJO (alineado con /admin/test-orders):
    // Los TPs parciales (50% BE + 50% final) ya se colocaron como triggers normal_plan al abrir la posición.
    // Cuando llega la señal BREAKEVEN, solo hay que MOVER EL SL al precio de entrada.
    // NO cerrar 50%, NO cancelar TPs — los triggers parciales ya manejan eso automáticamente.

    const subscriptions = await SubscriptionModel.findByStrategyId(
      strategyId,
      true // solo habilitadas
    );

    let successful = 0;
    let failed = 0;

    for (const subscription of subscriptions) {
      try {
        if (!alert.symbol) {
          console.warn(`[BREAKEVEN] Symbol no proporcionado para usuario ${subscription.user_id}`);
          failed++;
          continue;
        }

        // Normalizar símbolo (remover .P si existe)
        const dbSymbol = alert.symbol.replace(/\.P$/, '');
        const symbol = dbSymbol;
        const productType = alert.productType || 'USDT-FUTURES';
        const marginCoin = alert.marginCoin || 'USDT';

        // Verificar si existe un ENTRY previo
        let hasEntry = false;
        if (alert.trade_id) {
          hasEntry = await TradeModel.hasEntryForTradeId(subscription.user_id, strategyId, alert.trade_id, dbSymbol);
          if (!hasEntry) {
            hasEntry = await TradeModel.hasEntryForTradeId(subscription.user_id, strategyId, alert.trade_id);
          }
        }
        if (!hasEntry) {
          hasEntry = await TradeModel.hasEntryForSymbol(subscription.user_id, strategyId, dbSymbol);
        }

        if (!hasEntry) {
          console.warn(`[BREAKEVEN] No se encontró ENTRY previo para usuario ${subscription.user_id}, strategy ${strategyId}, symbol ${dbSymbol}, trade_id ${alert.trade_id || 'N/A'}. Ignorada.`);
          failed++;
          continue;
        }

        // Buscar el trade en DB (por trade_id si viene, si no por último ENTRY del símbolo)
        let tradeFinal: any = null;
        if (alert.trade_id) {
          tradeFinal = await TradeModel.findByTradeIdAndUser(subscription.user_id, strategyId, alert.trade_id, dbSymbol)
            || await TradeModel.findByTradeIdAndUser(subscription.user_id, strategyId, alert.trade_id);
        }
        if (!tradeFinal) {
          tradeFinal = await TradeModel.findLastEntryByUserStrategySymbol(subscription.user_id, strategyId, dbSymbol);
        }

        if (!tradeFinal) {
          console.warn(`[BREAKEVEN] Trade no encontrado para usuario ${subscription.user_id}, trade_id ${alert.trade_id || 'N/A'}, symbol ${dbSymbol}`);
          failed++;
          continue;
        }

        const exchange: ExchangeType = subscription.exchange || 'bitget';
        if (!subscription.credential_id) {
          console.warn(`[BREAKEVEN] Usuario ${subscription.user_id} no tiene credencial asignada`);
          failed++;
          continue;
        }
        let decryptedCredentials: any;
        if (exchange === 'bybit') {
          const credentials = await BybitCredentialsModel.findById(subscription.credential_id, subscription.user_id);
          if (!credentials) {
            console.warn(`[BREAKEVEN] Credencial Bybit ${subscription.credential_id} no encontrada para usuario ${subscription.user_id}`);
            failed++;
            continue;
          }
          decryptedCredentials = BybitService.getDecryptedCredentials({ api_key: credentials.api_key, api_secret: credentials.api_secret });
        } else {
          const credentials = await CredentialsModel.findById(subscription.credential_id, subscription.user_id);
          if (!credentials) {
            console.warn(`[BREAKEVEN] Credencial Bitget ${subscription.credential_id} no encontrada para usuario ${subscription.user_id}`);
            failed++;
            continue;
          }
          decryptedCredentials = BitgetService.getDecryptedCredentials({
            api_key: credentials.api_key,
            api_secret: credentials.api_secret,
            passphrase: credentials.passphrase,
          });
        }

        let contractInfo: any;
        try {
          contractInfo =
            exchange === 'bybit'
              ? await this.bybitService.getContractInfo(symbol, 'linear')
              : await this.bitgetService.getContractInfo(symbol, productType);
        } catch (error: any) {
          console.warn(`[BREAKEVEN] ⚠️ No se pudo obtener info del contrato: ${error.message}. Usando defaults.`);
          contractInfo = { minTradeNum: '0.01', sizeMultiplier: '0.01', minTradeUSDT: '5', volumePlace: '2', pricePlace: '1' };
        }

        const logContext = {
          userId: subscription.user_id,
          strategyId: strategyId,
          orderId: tradeFinal.bitget_order_id || undefined,
        };

        const positions =
          exchange === 'bybit'
            ? await this.bybitService.getPositions(decryptedCredentials, symbol, 'linear')
            : await this.bitgetService.getPositions(decryptedCredentials, symbol, productType);
        const holdSide = tradeFinal.side === 'buy' ? 'long' : 'short';
        const currentPosition = Array.isArray(positions)
          ? positions.find((p: any) => p.holdSide === holdSide && parseFloat(p.total || p.available || '0') > 0)
          : null;

        if (!currentPosition) {
          console.warn(`[BREAKEVEN] ⚠️ No se encontró posición ${holdSide} abierta para ${symbol}. La posición fue cerrada por TP/SL.`);
          // Actualizar DB de todas formas
          try {
            const entryPrice = tradeFinal.entry_price ? parseFloat(tradeFinal.entry_price.toString()) : null;
            if (entryPrice) await TradeModel.updateStopLoss(tradeFinal.id, entryPrice);
          } catch (_) {}
          successful++; // No es un error, la posición ya no existe
          continue;
        }

        // Determinar precio de entrada: preferir el de Bitget (averageOpenPrice), luego el de DB
        const entryPriceFromBitget = currentPosition.averageOpenPrice ? parseFloat(currentPosition.averageOpenPrice) : null;
        const entryPriceFromDB = tradeFinal.entry_price ? parseFloat(tradeFinal.entry_price.toString()) : null;
        const newStopLossPrice = entryPriceFromBitget || entryPriceFromDB;

        if (!newStopLossPrice || newStopLossPrice <= 0) {
          console.warn(`[BREAKEVEN] ⚠️ No se pudo determinar precio de entrada para ${symbol}. Bitget: ${entryPriceFromBitget}, DB: ${entryPriceFromDB}`);
          failed++;
          continue;
        }

        const positionSize = currentPosition.total || currentPosition.available || currentPosition.size || '0';
        console.log(`[BREAKEVEN] 🔄 Moviendo SL a precio de entrada (${newStopLossPrice}) para ${symbol} ${holdSide} | Posición: ${positionSize} contratos`);

        // Mismo flujo que el botón "Mover SL a BE" de /admin/test-orders:
        // Solo cancela el SL viejo (pos_loss) y coloca nuevo SL al precio de entrada.
        // NO toca los TPs (ya están como triggers normal_plan desde el ENTRY).
        const beResult =
          exchange === 'bybit'
            ? await this.bybitService.moveStopLossToBreakeven(
                decryptedCredentials,
                symbol,
                tradeFinal.side,
                newStopLossPrice,
                positionSize,
                productType,
                marginCoin,
                contractInfo,
                logContext
              )
            : await this.bitgetService.moveStopLossToBreakeven(
                decryptedCredentials,
                symbol,
                tradeFinal.side,
                newStopLossPrice,
                positionSize,
                productType,
                marginCoin,
                contractInfo,
                logContext
              );

        if (beResult.success) {
          console.log(`[BREAKEVEN] ✅ SL movido a precio de entrada (${newStopLossPrice}) para usuario ${subscription.user_id}`);
          // Actualizar SL en DB
          try {
            await TradeModel.updateStopLoss(tradeFinal.id, newStopLossPrice);
            console.log(`[BREAKEVEN] ✅ Stop loss actualizado en DB a ${newStopLossPrice}`);
          } catch (dbError: any) {
            console.error(`[BREAKEVEN] ❌ Error al actualizar DB: ${dbError.message}`);
          }
        } else {
          const errors = beResult.steps.filter((s: any) => !s.success).map((s: any) => s.error).join(', ');
          console.error(`[BREAKEVEN] ❌ Error moviendo SL para usuario ${subscription.user_id}: ${errors}`);
        }

        successful++;
      } catch (error: any) {
        console.error(`Error procesando BREAKEVEN para usuario ${subscription.user_id}:`, error);
        failed++;
      }
    }

    return {
      processed: subscriptions.length,
      successful,
      failed,
    };
  }

  async processInfoAlert(
    strategyId: number,
    alert: TradingViewAlert
  ): Promise<{ processed: number; successful: number; failed: number }> {
    // Solo registrar como informativo (STOP_LOSS, TAKE_PROFIT)
    // Verificar que exista un ENTRY previo antes de registrar
    
    if (!alert.symbol) {
      console.warn(`[${alert.alertType}] Symbol no proporcionado. La alerta será ignorada.`);
      return {
        processed: 0,
        successful: 0,
        failed: 0,
      };
    }

    // Buscar todos los usuarios suscritos a la estrategia con copia habilitada
    const subscriptions = await SubscriptionModel.findByStrategyId(
      strategyId,
      true // solo habilitadas
    );

    let processed = 0;
    let successful = 0;
    let failed = 0;

    // Procesar cada suscripción
    for (const subscription of subscriptions) {
      try {
        // Verificar si existe un ENTRY previo para este trade_id + símbolo (preferido)
        const dbSymbolSLTP = alert.symbol ? alert.symbol.replace(/\.P$/, '') : alert.symbol;
        let hasEntry = false;
        if (alert.trade_id) {
          hasEntry = await TradeModel.hasEntryForTradeId(
            subscription.user_id,
            strategyId,
            alert.trade_id,
            dbSymbolSLTP
          );
          // Fallback sin símbolo por compatibilidad
          if (!hasEntry) {
            hasEntry = await TradeModel.hasEntryForTradeId(
              subscription.user_id,
              strategyId,
              alert.trade_id
            );
          }
        }
        
        // Si no se encontró por trade_id, verificar por símbolo
        if (!hasEntry) {
          hasEntry = await TradeModel.hasEntryForSymbol(
            subscription.user_id,
            strategyId,
            dbSymbolSLTP
          );
        }

        if (!hasEntry) {
          console.warn(`[${alert.alertType}] No se encontró ENTRY previo para usuario ${subscription.user_id}, strategy ${strategyId}, symbol ${dbSymbolSLTP}, trade_id ${alert.trade_id || 'N/A'}. La alerta será ignorada.`);
          failed++;
          processed++;
          continue;
        }

        // Si existe ENTRY, registrar la alerta informativa (solo loguear por ahora)
        console.log(`[${alert.alertType}] Alerta informativa registrada para usuario ${subscription.user_id}, strategy ${strategyId}, trade_id ${alert.trade_id || 'N/A'}`);
        successful++;
        processed++;
      } catch (error: any) {
        console.error(`[${alert.alertType}] Error procesando alerta informativa para usuario ${subscription.user_id}:`, error);
        failed++;
        processed++;
      }
    }

    return {
      processed,
      successful,
      failed,
    };
  }

  async processCloseAlert(
    strategyId: number,
    alert: TradingViewAlert
  ): Promise<{ processed: number; successful: number; failed: number }> {
    if (!alert.symbol) {
      console.warn(`[CLOSE] Symbol no proporcionado. La alerta será ignorada.`);
      return { processed: 0, successful: 0, failed: 0 };
    }

    const subscriptions = await SubscriptionModel.findByStrategyId(strategyId, true);
    let processed = 0;
    let successful = 0;
    let failed = 0;

    for (const subscription of subscriptions) {
      try {
        const dbSymbol = alert.symbol.replace(/\.P$/, '');
        const symbol = dbSymbol;
        const productType = alert.productType || 'USDT-FUTURES';
        const marginMode = alert.marginMode || 'isolated';

        // Buscar el trade
        let tradeFinal: any = null;
        if (alert.trade_id) {
          tradeFinal = await TradeModel.findByTradeIdAndUser(subscription.user_id, strategyId, alert.trade_id, dbSymbol)
            || await TradeModel.findByTradeIdAndUser(subscription.user_id, strategyId, alert.trade_id);
        }
        if (!tradeFinal) {
          tradeFinal = await TradeModel.findLastEntryByUserStrategySymbol(subscription.user_id, strategyId, dbSymbol);
        }

        if (!tradeFinal) {
          console.warn(`[CLOSE] No se encontró ENTRY previo para usuario ${subscription.user_id}, strategy ${strategyId}, symbol ${dbSymbol}`);
          failed++;
          processed++;
          continue;
        }

        const exchange: ExchangeType = subscription.exchange || 'bitget';
        if (!subscription.credential_id) {
          console.warn(`[CLOSE] Usuario ${subscription.user_id} no tiene credencial asignada`);
          failed++;
          processed++;
          continue;
        }
        let decryptedCredentials: any;
        if (exchange === 'bybit') {
          const credentials = await BybitCredentialsModel.findById(subscription.credential_id, subscription.user_id);
          if (!credentials) {
            console.warn(`[CLOSE] Credencial Bybit no encontrada para usuario ${subscription.user_id}`);
            failed++;
            processed++;
            continue;
          }
          decryptedCredentials = BybitService.getDecryptedCredentials({ api_key: credentials.api_key, api_secret: credentials.api_secret });
        } else {
          const credentials = await CredentialsModel.findById(subscription.credential_id, subscription.user_id);
          if (!credentials) {
            console.warn(`[CLOSE] Credencial Bitget no encontrada para usuario ${subscription.user_id}`);
            failed++;
            processed++;
            continue;
          }
          decryptedCredentials = BitgetService.getDecryptedCredentials({
            api_key: credentials.api_key,
            api_secret: credentials.api_secret,
            passphrase: credentials.passphrase,
          });
        }

        const side = tradeFinal.side as 'buy' | 'sell';
        console.log(`[CLOSE] 🔄 Cerrando posición y cancelando triggers para usuario ${subscription.user_id}, symbol ${symbol} (${exchange})...`);

        const closeResult =
          exchange === 'bybit'
            ? await this.bybitService.closePositionAndCancelTriggers(
                decryptedCredentials,
                { symbol, side, productType, marginMode },
                { userId: subscription.user_id, strategyId, orderId: tradeFinal.bitget_order_id || undefined }
              )
            : await this.bitgetService.closePositionAndCancelTriggers(
                decryptedCredentials,
                { symbol, side, productType, marginMode },
                { userId: subscription.user_id, strategyId, orderId: tradeFinal.bitget_order_id || undefined }
              );

        if (closeResult.success) {
          console.log(`[CLOSE] ✅ Posición cerrada exitosamente para usuario ${subscription.user_id}`);
          successful++;
        } else {
          console.error(`[CLOSE] ❌ Error cerrando posición para usuario ${subscription.user_id}:`, closeResult.error);
          failed++;
        }
        processed++;
      } catch (error: any) {
        console.error(`[CLOSE] ❌ Error procesando alerta CLOSE para usuario ${subscription.user_id}:`, error);
        failed++;
        processed++;
      }
    }

    return { processed, successful, failed };
  }
}


