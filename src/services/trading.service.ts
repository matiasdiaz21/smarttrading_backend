import { BitgetService } from './bitget.service';
import { CredentialsModel } from '../models/Credentials';
import { SubscriptionModel } from '../models/Subscription';
import { TradeModel } from '../models/Trade';
import { UserModel } from '../models/User';
import { PaymentSubscriptionModel } from '../models/PaymentSubscription';
import { NotificationModel } from '../models/Notification';
import { TradingViewAlert } from '../types';
import { decrypt } from '../utils/encryption';
import OrderErrorModel from '../models/orderError.model';

export class TradingService {
  private bitgetService: BitgetService;

  constructor() {
    this.bitgetService = new BitgetService();
  }

  async executeTradeForUser(
    userId: number,
    strategyId: number,
    alert: TradingViewAlert
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    try {
      console.log(`[TradeService] 🔍 Verificando condiciones para usuario ${userId}...`);
      
      // Verificar que el usuario exista
      const user = await UserModel.findById(userId);
      if (!user) {
        console.error(`[TradeService] ❌ Usuario ${userId} no encontrado`);
        return { success: false, error: 'User not found' };
      }

      // Verificar que el usuario tenga suscripción de pago activa (excepto para administradores)
      if (user.role !== 'admin') {
        const activeSubscription = await PaymentSubscriptionModel.findActiveByUserId(userId);
        if (!activeSubscription) {
          console.warn(`[TradeService] ⚠️ Usuario ${userId} no tiene suscripción de pago activa`);
          return { success: false, error: 'User does not have an active payment subscription' };
        }
        console.log(`[TradeService] ✅ Usuario ${userId} tiene suscripción de pago activa`);
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
      const { StrategyModel } = await import('../models/Strategy');
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

      // Obtener credencial asignada a esta estrategia (cada estrategia tiene una credencial 1:1)
      if (!strategySubscription.credential_id) {
        console.error(`[TradeService] ❌ La estrategia ${strategyId} no tiene credencial de Bitget asignada`);
        return { success: false, error: 'This strategy has no Bitget credential assigned. Assign one in your strategy settings.' };
      }
      const credentials = await CredentialsModel.findById(strategySubscription.credential_id, userId);
      if (!credentials) {
        console.error(`[TradeService] ❌ Credencial ${strategySubscription.credential_id} no encontrada o no pertenece al usuario`);
        return { success: false, error: 'Bitget credential not found or invalid' };
      }
      console.log(`[TradeService] ✅ Usando credencial ${strategySubscription.credential_id} para estrategia ${strategyId}`);

      // Desencriptar credenciales
      const decryptedCredentials = BitgetService.getDecryptedCredentials({
        api_key: credentials.api_key,
        api_secret: credentials.api_secret,
        passphrase: credentials.passphrase,
      });

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
      let contractInfo;
      try {
        contractInfo = await this.bitgetService.getContractInfo(symbol, productType);
        console.log(`[TradeService] 📊 Información del contrato para ${symbol}:`, contractInfo);
      } catch (error: any) {
        console.warn(`[TradeService] ⚠️ No se pudo obtener información del contrato: ${error.message}. Usando valores por defecto.`);
        // Valores por defecto si no se puede obtener la información
        contractInfo = {
          minTradeNum: '0.01',
          sizeMultiplier: '0.01',
          minTradeUSDT: '5',
          volumePlace: '2',
          pricePlace: '1',
        };
      }

      // Calcular el tamaño correcto de la orden basado en el valor mínimo en USDT
      // PRIORIDAD: 1. position_size personalizado del usuario, 2. alert.size, 3. minTradeUSDT calculado
      let requestedSize = alert.size;
      let positionSizeSource = 'alerta (alert.size)';
      
      // Verificar si el usuario tiene position_size personalizado configurado
      const userPositionSize = strategySubscription.position_size;
      if (userPositionSize !== null && userPositionSize !== undefined && userPositionSize > 0 && entryPrice) {
        // Usar position_size personalizado del usuario (en USDT)
        // Convertir USDT a contratos: position_size / precio
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
      
      let calculatedSize = this.bitgetService.calculateOrderSize(
        requestedSize,
        contractInfo.minTradeNum,
        contractInfo.sizeMultiplier
      );

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
          calculatedSize = this.bitgetService.calculateOrderSize(
            adjustedSize,
            contractInfo.minTradeNum,
            contractInfo.sizeMultiplier
          );
          console.log(`[TradeService] ✅ Tamaño ajustado: ${calculatedSize} contratos, Valor notional ajustado: ${(parseFloat(calculatedSize) * parseFloat(entryPrice.toString())).toFixed(2)} USDT`);
          console.log(`[TradeService] ⚠️ Nota: El position_size configurado era menor al mínimo requerido, se usó el mínimo`);
        }
      } else {
        console.log(`[TradeService] 📏 Tamaño solicitado: ${requestedSize}, Tamaño calculado: ${calculatedSize}`);
      }
      
      // Configurar el apalancamiento ANTES de ejecutar la orden
      // Esto es CRÍTICO: el leverage debe estar configurado antes de abrir la posición
      const holdSide = alert.side === 'LONG' || alert.side === 'buy' ? 'long' : 'short';
      
      try {
        console.log(`[TradeService] 🔧 Configurando leverage a ${leverage}x para ${symbol} antes de abrir posición...`);
        await this.bitgetService.setLeverage(
          decryptedCredentials,
          symbol,
          leverage,
          productType,
          alert.marginCoin || 'USDT',
          holdSide,
          {
            userId,
            strategyId,
          }
        );
        console.log(`[TradeService] ✅ Apalancamiento configurado exitosamente a ${leverage}x para ${symbol}`);
        
        // Pequeña pausa para asegurar que el leverage se haya aplicado antes de continuar
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (leverageError: any) {
        // NO continuar si falla la configuración del leverage - esto es crítico
        console.error(`[TradeService] ❌ ERROR CRÍTICO: No se pudo configurar el apalancamiento a ${leverage}x: ${leverageError.message}`);
        console.error(`[TradeService] Detalles del error:`, leverageError);
        throw new Error(`No se pudo configurar el apalancamiento a ${leverage}x: ${leverageError.message}. La operación se ha cancelado para evitar usar un leverage incorrecto.`);
      }
      
      // Verificar si ya existe una posición abierta para este símbolo
      let existingPosition = null;
      let actualPositionSize = calculatedSize;
      let shouldOpenPosition = true;
      
      try {
        console.log(`[TradeService] 🔍 Verificando si ya existe posición para ${symbol}...`);
        const positions = await this.bitgetService.getPositions(
          decryptedCredentials,
          symbol,
          productType
        );
        
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
            // Usar el positionId de la posición existente como orderId para los logs
            if (matchingPosition.positionId || matchingPosition.id) {
              result = { orderId: matchingPosition.positionId || matchingPosition.id };
            }
          }
        }
      } catch (checkError: any) {
        console.warn(`[TradeService] ⚠️ No se pudo verificar posiciones existentes: ${checkError.message}. Se intentará abrir la posición.`);
      }
      
      let result: any = null;
      
      if (shouldOpenPosition) {
        // Generar clientOid único usando timestamp de alta precisión y número aleatorio
        // Esto previene errores de "Duplicate clientOid" cuando TradingView envía la misma alerta múltiples veces
        const highPrecisionTimestamp = `${Date.now()}_${process.hrtime.bigint()}`;
        const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        const uniqueClientOid = `ST_${userId}_${strategyId}_${alert.trade_id || 'ENTRY'}_${highPrecisionTimestamp}_${randomSuffix}`;
        
        const orderData = {
          symbol: symbol,
          productType: productType,
          marginMode: alert.marginMode || 'isolated',
          marginCoin: alert.marginCoin || 'USDT',
          size: calculatedSize,
          price: entryPrice ? entryPrice.toString() : undefined,
          side: bitgetSide,
          tradeSide: alert.tradeSide || 'open',
          orderType: alert.orderType || 'market',
          force: alert.force || (alert.orderType === 'limit' ? 'gtc' : undefined),
          clientOid: uniqueClientOid,
        };

        try {
          // Ejecutar orden en Bitget
          console.log(`[TradeService] 🚀 Ejecutando orden en Bitget para usuario ${userId}...`);
          console.log(`[TradeService] 📋 Datos de la orden:`, JSON.stringify(orderData, null, 2));
          
          result = await this.bitgetService.placeOrder(
            decryptedCredentials,
            orderData,
            {
              userId,
              strategyId,
            }
          );

          console.log(`[TradeService] ✅ Orden ejecutada en Bitget. Order ID: ${result.orderId}, Client OID: ${result.clientOid}`);

          // Esperar un momento para que la posición se registre en Bitget
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Obtener el tamaño real de la posición después de abrirla
          try {
            const positions = await this.bitgetService.getPositions(
              decryptedCredentials,
              symbol,
              productType
            );
            
            if (positions && positions.length > 0) {
              const position = positions[0];
              actualPositionSize = position.total || position.available || position.size || calculatedSize;
              console.log(`[TradeService] 📊 Tamaño de posición obtenido: ${actualPositionSize} (solicitado: ${calculatedSize})`);
            } else {
              console.warn(`[TradeService] ⚠️ No se encontró posición abierta, usando tamaño calculado: ${calculatedSize}`);
            }
          } catch (positionError: any) {
            console.warn(`[TradeService] ⚠️ No se pudo obtener el tamaño de la posición: ${positionError.message}. Usando tamaño calculado: ${calculatedSize}`);
          }
        } catch (orderError: any) {
          console.error(`[TradeService] ❌ Error al ejecutar orden: ${orderError.message}`);
          
          // Si el error es por clientOid duplicado, verificar si la posición existe
          if (orderError.message && orderError.message.includes('Duplicate clientOid')) {
            console.log(`[TradeService] 🔍 Error de clientOid duplicado. Verificando si la posición ya existe...`);
            
            try {
              const positions = await this.bitgetService.getPositions(
                decryptedCredentials,
                symbol,
                productType
              );
              
              if (positions && positions.length > 0) {
                const matchingPosition = positions.find((p: any) => 
                  p.symbol === symbol && 
                  p.holdSide === holdSide
                );
                
                if (matchingPosition) {
                  existingPosition = matchingPosition;
                  actualPositionSize = matchingPosition.total || matchingPosition.available || calculatedSize;
                  console.log(`[TradeService] ✅ Posición encontrada con tamaño ${actualPositionSize}. Se configurarán TP/SL.`);
                  // Usar el positionId de la posición existente como orderId para los logs
                  if (matchingPosition.positionId || matchingPosition.id) {
                    result = { orderId: matchingPosition.positionId || matchingPosition.id };
                  }
                } else {
                  throw orderError;
                }
              } else {
                throw orderError;
              }
            } catch (recheckError: any) {
              console.error(`[TradeService] ❌ No se pudo verificar la posición después del error: ${recheckError.message}`);
              throw orderError;
            }
          } else {
            throw orderError;
          }
        }
      }

      // Configurar Stop Loss y Take Profit si están disponibles
      let tpslConfigured = false;
      let tpslError: any = null;
      
      if (alert.stopLoss && alert.takeProfit) {
        try {
          console.log(`[TradeService] 📊 Configurando órdenes TP/SL avanzadas para ${symbol}...`);
          console.log(`[TradeService]   Stop Loss: ${alert.stopLoss}`);
          console.log(`[TradeService]   Breakeven: ${alert.breakeven || 'N/A'}`);
          console.log(`[TradeService]   Take Profit: ${alert.takeProfit}`);
          console.log(`[TradeService]   Tamaño de posición: ${actualPositionSize}`);
          
          let tpslResults: any;
          
          // Si hay breakeven Y el usuario tiene habilitado el TP parcial, usar el método avanzado
          const usePartialTp = strategySubscription.use_partial_tp !== false; // Default true
          console.log(`[TradeService] 📊 Partial TP habilitado: ${usePartialTp}`);
          
          if (alert.breakeven && alert.breakeven > 0 && usePartialTp) {
            console.log(`[TradeService] 🎯 Configurando estrategia con breakeven (TP 50% en breakeven, TP 50% en takeProfit)`);
            
            tpslResults = await this.bitgetService.setAdvancedPositionTPSL(
              decryptedCredentials,
              symbol,
              bitgetSide,
              alert.stopLoss,
              alert.breakeven,
              alert.takeProfit,
              actualPositionSize,
              productType,
              alert.marginCoin || 'USDT',
              contractInfo,
              {
                userId,
                strategyId,
                orderId: result?.orderId,
              }
            );
          } else {
            // Si no hay breakeven, usar el método básico (TP 100% en takeProfit)
            console.log(`[TradeService] 🎯 Configurando estrategia básica (TP 100% en takeProfit, sin breakeven)`);
            
            tpslResults = await this.bitgetService.setPositionTPSL(
              decryptedCredentials,
              symbol,
              bitgetSide,
              alert.stopLoss,
              alert.takeProfit,
              productType,
              alert.marginCoin || 'USDT',
              actualPositionSize,
              contractInfo,
              {
                userId,
                strategyId,
                orderId: result?.orderId,
              }
            );
          }
          
          // Verificar si TP y SL se configuraron exitosamente
          const slSuccess = Array.isArray(tpslResults) ? tpslResults.some(r => r.type === 'stop_loss' && r.success) : false;
          const tpSuccess = Array.isArray(tpslResults) ? tpslResults.some(r => (r.type === 'take_profit' || r.type === 'take_profit_final') && r.success) : false;
          
          if (slSuccess && tpSuccess) {
            console.log(`[TradeService] ✅ Todas las órdenes TP/SL configuradas exitosamente en Bitget`);
            tpslConfigured = true;
          } else if (!slSuccess && !tpSuccess) {
            console.error(`[TradeService] ❌ CRÍTICO: Ni TP ni SL se pudieron configurar`);
            tpslError = { type: 'tp_sl_failed', slSuccess, tpSuccess, results: tpslResults };
          } else if (!slSuccess) {
            console.error(`[TradeService] ❌ CRÍTICO: Stop Loss no se pudo configurar`);
            tpslError = { type: 'sl_failed', slSuccess, tpSuccess, results: tpslResults };
          } else if (!tpSuccess) {
            console.error(`[TradeService] ⚠️ ADVERTENCIA: Take Profit no se pudo configurar`);
            tpslError = { type: 'tp_failed', slSuccess, tpSuccess, results: tpslResults };
          }
        } catch (error: any) {
          console.error(`[TradeService] ⚠️ Error al configurar TP/SL: ${error.message}`);
          console.error(`[TradeService] Stack trace:`, error.stack);
          tpslError = { type: 'tp_sl_failed', error: error.message };
        }
      } else {
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
        alert.alertType || 'ENTRY'
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

      return { success: true, orderId: result?.orderId || existingPosition?.positionId || 'existing' };
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
  ): Promise<{ processed: number; successful: number; failed: number }> {
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
    };
  }

  async processBreakevenAlert(
    strategyId: number,
    alert: TradingViewAlert
  ): Promise<{ processed: number; successful: number; failed: number }> {
    // Buscar todos los usuarios suscritos a la estrategia con copia habilitada
    const subscriptions = await SubscriptionModel.findByStrategyId(
      strategyId,
      true // solo habilitadas
    );

    let successful = 0;
    let failed = 0;

    // Procesar cada suscripción
    for (const subscription of subscriptions) {
      try {
        // Verificar que exista un ENTRY previo para este símbolo
        if (!alert.symbol) {
          console.warn(`[BREAKEVEN] Symbol no proporcionado para usuario ${subscription.user_id}`);
          failed++;
          continue;
        }

        // Verificar si existe un ENTRY previo para este trade_id (preferido) o símbolo
        let hasEntry = false;
        if (alert.trade_id) {
          hasEntry = await TradeModel.hasEntryForTradeId(
            subscription.user_id,
            strategyId,
            alert.trade_id
          );
        }
        
        // Si no se encontró por trade_id, verificar por símbolo
        if (!hasEntry) {
          hasEntry = await TradeModel.hasEntryForSymbol(
            subscription.user_id,
            strategyId,
            alert.symbol
          );
        }

        if (!hasEntry) {
          console.warn(`[BREAKEVEN] No se encontró ENTRY previo para usuario ${subscription.user_id}, strategy ${strategyId}, symbol ${alert.symbol}, trade_id ${alert.trade_id || 'N/A'}. La alerta BREAKEVEN será ignorada.`);
          failed++;
          continue;
        }

        // Buscar el trade abierto correspondiente a este trade_id
        const trade = await TradeModel.findByTradeIdAndUser(
          subscription.user_id,
          strategyId,
          alert.trade_id!
        );

        if (!trade) {
          console.warn(`[BREAKEVEN] Trade no encontrado para usuario ${subscription.user_id}, strategy ${strategyId}, trade_id ${alert.trade_id}`);
          failed++;
          continue;
        }

        // Obtener credencial asignada a esta estrategia
        if (!subscription.credential_id) {
          console.warn(`[BREAKEVEN] Usuario ${subscription.user_id} estrategia ${strategyId} no tiene credencial asignada`);
          failed++;
          continue;
        }
        const credentials = await CredentialsModel.findById(subscription.credential_id, subscription.user_id);
        if (!credentials) {
          console.warn(`[BREAKEVEN] Credencial ${subscription.credential_id} no encontrada para usuario ${subscription.user_id}`);
          failed++;
          continue;
        }

        // Desencriptar credenciales
        const decryptedCredentials = BitgetService.getDecryptedCredentials({
          api_key: credentials.api_key,
          api_secret: credentials.api_secret,
          passphrase: credentials.passphrase,
        });

        // BREAKEVEN: Cancelar triggers viejos, cerrar 50%, crear nuevos SL+TP para el 50% restante
        const breakevenPrice = alert.breakeven || alert.entryPrice;
        if (!breakevenPrice) {
          console.warn(`[BREAKEVEN] No se proporcionó breakeven/entryPrice para trade_id ${alert.trade_id}`);
          failed++;
          continue;
        }

        // Remover .P del símbolo si existe (Bitget no acepta .P en el símbolo)
        const symbol = alert.symbol ? alert.symbol.replace(/\.P$/, '') : alert.symbol;
        const productType = alert.productType || 'USDT-FUTURES';
        const marginCoin = alert.marginCoin || 'USDT';

        console.log(`[BREAKEVEN] Procesando breakeven para usuario ${subscription.user_id}, symbol ${symbol}, trade_id ${alert.trade_id}`);
        console.log(`[BREAKEVEN] Precio de breakeven: ${breakevenPrice}`);

        // Obtener información del contrato para validar el tamaño mínimo
        let contractInfo;
        try {
          contractInfo = await this.bitgetService.getContractInfo(symbol, productType);
          console.log(`[BREAKEVEN] 📊 Información del contrato para ${symbol}:`, contractInfo);
        } catch (error: any) {
          console.warn(`[BREAKEVEN] ⚠️ No se pudo obtener información del contrato: ${error.message}. Usando valores por defecto.`);
          contractInfo = {
            minTradeNum: '0.01',
            sizeMultiplier: '0.01',
            minTradeUSDT: '5',
            volumePlace: '2',
            pricePlace: '1',
          };
        }

        const logContext = {
          userId: subscription.user_id,
          strategyId: strategyId,
          orderId: trade.bitget_order_id || undefined,
        };

        // PASO 1: Cancelar TODAS las órdenes trigger existentes (SL 100% + TP 100% originales)
        try {
          console.log(`[BREAKEVEN] 🗑️ Paso 1: Cancelando órdenes trigger existentes para ${symbol}...`);
          const cancelResult = await this.bitgetService.cancelAllTriggerOrders(
            decryptedCredentials,
            symbol,
            productType,
            marginCoin,
            logContext
          );
          console.log(`[BREAKEVEN] ✅ Triggers cancelados: ${cancelResult.cancelled} exitosas, ${cancelResult.failed} fallidas`);
        } catch (cancelError: any) {
          console.error(`[BREAKEVEN] ❌ Error al cancelar triggers existentes: ${cancelError.message}`);
          // Continuar de todas formas - los nuevos triggers reemplazarán los viejos si Bitget lo permite
        }

        // PASO 2: Cerrar 50% de la posición a mercado
        let remainingSize = 0;
        try {
          console.log(`[BREAKEVEN] 📊 Paso 2: Cerrando 50% de la posición...`);
          const positions = await this.bitgetService.getPositions(
            decryptedCredentials,
            symbol,
            productType
          );

          if (positions && positions.length > 0) {
            const position = positions[0];
            const currentSize = parseFloat(position.total || position.available || '0');
            
            if (currentSize > 0) {
              // Calcular 50% con Math.floor para no exceder la mitad
              const minTradeNum = parseFloat(contractInfo.minTradeNum);
              const sizeMultiplier = parseFloat(contractInfo.sizeMultiplier);
              let halfSize = Math.floor((currentSize / 2) / sizeMultiplier) * sizeMultiplier;
              
              // Validar que el tamaño sea mayor o igual al mínimo
              if (halfSize < minTradeNum) {
                console.warn(`[BREAKEVEN] ⚠️ El 50% calculado (${halfSize}) es menor que el mínimo (${minTradeNum}). No se puede cerrar parcialmente.`);
                console.warn(`[BREAKEVEN] ⚠️ Se omitirá el cierre parcial y se crearán nuevos SL+TP para la posición completa.`);
                remainingSize = currentSize;
              } else {
                // Aplicar precisión según volumePlace
                const volumePlace = contractInfo?.volumePlace ? parseInt(contractInfo.volumePlace) : 2;
                const halfSizeStr = halfSize.toFixed(volumePlace).replace(/\.?0+$/, '');
                
                const holdSide = position.holdSide || (trade.side === 'buy' ? 'long' : 'short');
                const closeSide: 'buy' | 'sell' = trade.side === 'buy' ? 'sell' : 'buy';

                console.log(`[BREAKEVEN] Cerrando 50%: ${halfSizeStr} contratos de ${currentSize} total`);

                const timestamp = Date.now();
                const baseId = `${timestamp}${Math.floor(Math.random() * 1000)}`;
                const beRandom = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
                const beClientOid = `ST_BE_${symbol.substring(0, 8)}_${baseId}_${beRandom}`.substring(0, 64);
                
                await this.bitgetService.placeOrder(
                  decryptedCredentials,
                  {
                    symbol: symbol,
                    productType: productType,
                    marginMode: 'isolated',
                    marginCoin: marginCoin,
                    size: halfSizeStr,
                    side: closeSide,
                    tradeSide: 'close',
                    orderType: 'market',
                    clientOid: beClientOid,
                  },
                  logContext
                );

                // Calcular tamaño restante (posición original - lo que cerramos)
                remainingSize = currentSize - halfSize;
                console.log(`[BREAKEVEN] ✅ 50% cerrado (${halfSizeStr}). Posición restante: ${remainingSize}`);
              }
            } else {
              console.warn(`[BREAKEVEN] ⚠️ No se encontró tamaño de posición válido para cerrar`);
            }
          } else {
            console.warn(`[BREAKEVEN] ⚠️ No se encontró posición abierta para ${symbol}`);
          }
        } catch (closeError: any) {
          console.error(`[BREAKEVEN] ❌ Error al cerrar 50% de la posición: ${closeError.message}`);
          // Continuar para intentar crear nuevos SL+TP
        }

        // PASO 3: Crear nuevos SL (al precio de entrada) + TP (al precio final) para el 50% restante
        try {
          // Usar el precio de entrada ORIGINAL guardado en la tabla trades
          const originalEntryPrice = trade.entry_price ? parseFloat(trade.entry_price.toString()) : null;
          const newStopLoss = originalEntryPrice || alert.entryPrice || breakevenPrice;
          const pricePlace = contractInfo?.pricePlace ? parseInt(contractInfo.pricePlace) : 4;
          const formattedStopLoss = parseFloat(newStopLoss.toFixed(pricePlace));
          
          console.log(`[BREAKEVEN] 📊 Paso 3: Creando nuevos SL+TP para posición restante...`);
          console.log(`[BREAKEVEN]   Precio de entrada original: ${originalEntryPrice}`);
          console.log(`[BREAKEVEN]   Nuevo SL: ${formattedStopLoss} (movido a breakeven/entrada)`);

          if (remainingSize > 0) {
            // Obtener tamaño restante como string con precisión correcta
            const volumePlace = contractInfo?.volumePlace ? parseInt(contractInfo.volumePlace) : 2;
            const remainingSizeStr = remainingSize.toFixed(volumePlace).replace(/\.?0+$/, '');

            // Determinar holdSide y side para las nuevas órdenes
            const bitgetSide: 'buy' | 'sell' = trade.side === 'buy' ? 'buy' : 'sell';

            // Crear nuevos SL + TP usando setPositionTPSL (para el 50% restante)
            const takeProfitPrice = trade.take_profit ? parseFloat(trade.take_profit.toString()) : (alert.takeProfit || 0);
            
            if (takeProfitPrice > 0) {
              console.log(`[BREAKEVEN]   Nuevo TP: ${takeProfitPrice} para ${remainingSizeStr} contratos`);

              const tpslResults = await this.bitgetService.setPositionTPSL(
                decryptedCredentials,
                symbol,
                bitgetSide,
                formattedStopLoss,
                takeProfitPrice,
                productType,
                marginCoin,
                remainingSizeStr,
                contractInfo,
                logContext
              );

              const slSuccess = Array.isArray(tpslResults) ? tpslResults.some((r: any) => r.type === 'stop_loss' && r.success) : false;
              const tpSuccess = Array.isArray(tpslResults) ? tpslResults.some((r: any) => r.type === 'take_profit' && r.success) : false;
              console.log(`[BREAKEVEN] ✅ Nuevos SL+TP creados: SL=${slSuccess ? 'OK' : 'FAIL'}, TP=${tpSuccess ? 'OK' : 'FAIL'}`);
            } else {
              // Solo crear SL si no hay TP disponible
              console.log(`[BREAKEVEN] ⚠️ No hay TP disponible, solo se creará SL`);
              await this.bitgetService.modifyPositionStopLoss(
                decryptedCredentials,
                symbol,
                formattedStopLoss,
                productType,
                marginCoin,
                undefined,
                contractInfo,
                logContext
              );
              console.log(`[BREAKEVEN] ✅ Nuevo SL creado en ${formattedStopLoss}`);
            }
          } else {
            // Si no pudimos cerrar 50% (posición muy pequeña), al menos mover el SL
            console.log(`[BREAKEVEN] ⚠️ Sin posición restante calculada, moviendo SL con modifyPositionStopLoss`);
            let formattedTakeProfit: number | undefined;
            if (trade.take_profit) {
              formattedTakeProfit = parseFloat(parseFloat(trade.take_profit.toString()).toFixed(pricePlace));
            }
            await this.bitgetService.modifyPositionStopLoss(
              decryptedCredentials,
              symbol,
              formattedStopLoss,
              productType,
              marginCoin,
              formattedTakeProfit,
              contractInfo,
              logContext
            );
            console.log(`[BREAKEVEN] ✅ SL movido a breakeven`);
          }

          // Actualizar stop loss en base de datos
          await TradeModel.updateStopLoss(trade.id, newStopLoss);
          console.log(`[BREAKEVEN] ✅ Stop loss actualizado en DB a ${newStopLoss}`);
        } catch (slError: any) {
          console.error(`[BREAKEVEN] ❌ Error al crear nuevos SL+TP: ${slError.message}`);
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
        // Verificar si existe un ENTRY previo para este trade_id (preferido) o símbolo
        let hasEntry = false;
        if (alert.trade_id) {
          hasEntry = await TradeModel.hasEntryForTradeId(
            subscription.user_id,
            strategyId,
            alert.trade_id
          );
        }
        
        // Si no se encontró por trade_id, verificar por símbolo
        if (!hasEntry) {
          hasEntry = await TradeModel.hasEntryForSymbol(
            subscription.user_id,
            strategyId,
            alert.symbol
          );
        }

        if (!hasEntry) {
          console.warn(`[${alert.alertType}] No se encontró ENTRY previo para usuario ${subscription.user_id}, strategy ${strategyId}, symbol ${alert.symbol}, trade_id ${alert.trade_id || 'N/A'}. La alerta será ignorada.`);
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
}

