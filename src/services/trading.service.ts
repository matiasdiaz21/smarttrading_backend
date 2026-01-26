import { BitgetService } from './bitget.service';
import { CredentialsModel } from '../models/Credentials';
import { SubscriptionModel } from '../models/Subscription';
import { TradeModel } from '../models/Trade';
import { UserModel } from '../models/User';
import { PaymentSubscriptionModel } from '../models/PaymentSubscription';
import { TradingViewAlert } from '../types';
import { decrypt } from '../utils/encryption';

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

      // Obtener credenciales activas del usuario
      const credentials = await CredentialsModel.findActiveByUserId(userId);
      if (!credentials) {
        console.error(`[TradeService] ❌ Usuario ${userId} no tiene credenciales de Bitget activas`);
        return { success: false, error: 'User does not have active Bitget credentials' };
      }
      console.log(`[TradeService] ✅ Usuario ${userId} tiene credenciales de Bitget activas`);

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
      // Si se proporciona un tamaño, usarlo; sino, calcular basándose en minTradeUSDT
      let requestedSize = alert.size;
      
      if (!requestedSize && entryPrice) {
        // Calcular el tamaño mínimo basado en minTradeUSDT y el precio de entrada
        const minUSDT = parseFloat(contractInfo.minTradeUSDT);
        const price = parseFloat(entryPrice.toString());
        
        // Tamaño mínimo = minTradeUSDT / precio
        // Añadir un pequeño margen (5%) para asegurar que se cumpla el mínimo
        requestedSize = ((minUSDT * 1.05) / price).toString();
        console.log(`[TradeService] 📊 Calculando tamaño basado en minTradeUSDT: ${minUSDT} USDT / ${price} = ${requestedSize} contratos`);
      } else if (!requestedSize) {
        requestedSize = contractInfo.minTradeNum;
      }
      
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
          const adjustedSize = ((minUSDT * 1.05) / parseFloat(entryPrice.toString())).toString();
          calculatedSize = this.bitgetService.calculateOrderSize(
            adjustedSize,
            contractInfo.minTradeNum,
            contractInfo.sizeMultiplier
          );
          console.log(`[TradeService] ✅ Tamaño ajustado: ${calculatedSize} contratos, Valor notional ajustado: ${(parseFloat(calculatedSize) * parseFloat(entryPrice.toString())).toFixed(2)} USDT`);
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
          holdSide
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
          }
        }
      } catch (checkError: any) {
        console.warn(`[TradeService] ⚠️ No se pudo verificar posiciones existentes: ${checkError.message}. Se intentará abrir la posición.`);
      }
      
      let result: any = null;
      
      if (shouldOpenPosition) {
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
          clientOid: `ST_${userId}_${strategyId}_${alert.trade_id || Date.now()}`,
        };

        try {
          // Ejecutar orden en Bitget
          console.log(`[TradeService] 🚀 Ejecutando orden en Bitget para usuario ${userId}...`);
          console.log(`[TradeService] 📋 Datos de la orden:`, JSON.stringify(orderData, null, 2));
          
          result = await this.bitgetService.placeOrder(
            decryptedCredentials,
            orderData
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
      if (alert.stopLoss && alert.takeProfit) {
        try {
          console.log(`[TradeService] 📊 Configurando órdenes TP/SL avanzadas para ${symbol}...`);
          console.log(`[TradeService]   Stop Loss: ${alert.stopLoss}`);
          console.log(`[TradeService]   Breakeven: ${alert.breakeven || 'N/A'}`);
          console.log(`[TradeService]   Take Profit: ${alert.takeProfit}`);
          console.log(`[TradeService]   Tamaño de posición: ${actualPositionSize}`);
          
          // Si hay breakeven, usar el método avanzado que configura múltiples órdenes
          if (alert.breakeven && alert.breakeven > 0) {
            console.log(`[TradeService] 🎯 Configurando estrategia con breakeven (TP 50% en breakeven, TP 50% en takeProfit)`);
            
            await this.bitgetService.setAdvancedPositionTPSL(
              decryptedCredentials,
              symbol,
              bitgetSide,
              alert.stopLoss,
              alert.breakeven,
              alert.takeProfit,
              actualPositionSize,
              productType,
              alert.marginCoin || 'USDT'
            );
          } else {
            // Si no hay breakeven, usar el método básico (TP 100% en takeProfit)
            console.log(`[TradeService] 🎯 Configurando estrategia básica (TP 100% en takeProfit, sin breakeven)`);
            
            await this.bitgetService.setPositionTPSL(
              decryptedCredentials,
              symbol,
              bitgetSide,
              alert.stopLoss,
              alert.takeProfit,
              productType,
              alert.marginCoin || 'USDT'
            );
          }
          
          console.log(`[TradeService] ✅ Todas las órdenes TP/SL configuradas exitosamente en Bitget`);
        } catch (tpslError: any) {
          console.error(`[TradeService] ⚠️ Error al configurar TP/SL: ${tpslError.message}`);
          // No fallar la operación si el TP/SL falla, la orden ya fue ejecutada
          // Pero registrar el error para debugging
          console.error(`[TradeService] Stack trace:`, tpslError.stack);
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

      return { success: true, orderId: result?.orderId || existingPosition?.positionId || 'existing' };
    } catch (error: any) {
      // NO registrar trades fallidos - solo se registran los que se ejecutan exitosamente en Bitget
      console.error(`[TradeService] ❌ Error al ejecutar trade en Bitget para usuario ${userId}:`, error.message);
      
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

        // Obtener credenciales activas del usuario
        const credentials = await CredentialsModel.findActiveByUserId(subscription.user_id);
        if (!credentials) {
          console.warn(`Usuario ${subscription.user_id} no tiene credenciales activas`);
          failed++;
          continue;
        }

        // Desencriptar credenciales
        const decryptedCredentials = BitgetService.getDecryptedCredentials({
          api_key: credentials.api_key,
          api_secret: credentials.api_secret,
          passphrase: credentials.passphrase,
        });

        // BREAKEVEN: Cerrar 50% de la posición y mover stop loss al precio de entrada
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

        // 1. Cerrar 50% de la posición al precio de breakeven
        try {
          // Obtener la posición actual para saber el tamaño
          const positions = await this.bitgetService.getPositions(
            decryptedCredentials,
            symbol,
            productType
          );

          if (positions && positions.length > 0) {
            const position = positions[0];
            const currentSize = parseFloat(position.total || position.available || '0');
            
            if (currentSize > 0) {
              // Calcular 50% del tamaño de la posición
              const halfSize = (currentSize / 2).toString();
              const holdSide = position.holdSide || (trade.side === 'buy' ? 'long' : 'short');
              
              // Determinar el side de cierre (opuesto al de apertura)
              const closeSide: 'buy' | 'sell' = trade.side === 'buy' ? 'sell' : 'buy';

              console.log(`[BREAKEVEN] Cerrando 50% de la posición: ${halfSize} contratos de ${currentSize} total`);

              // Colocar orden de cierre del 50%
              await this.bitgetService.placeOrder(
                decryptedCredentials,
                {
                  symbol: symbol,
                  productType: productType,
                  marginMode: 'isolated',
                  marginCoin: marginCoin,
                  size: halfSize,
                  side: closeSide,
                  tradeSide: 'close',
                  orderType: 'market',
                  clientOid: `ST_BREAKEVEN_${subscription.user_id}_${strategyId}_${alert.trade_id}_${Date.now()}`,
                }
              );

              console.log(`[BREAKEVEN] ✅ 50% de la posición cerrada exitosamente`);
            } else {
              console.warn(`[BREAKEVEN] ⚠️ No se encontró tamaño de posición válido para cerrar`);
            }
          } else {
            console.warn(`[BREAKEVEN] ⚠️ No se encontró posición abierta para ${symbol}`);
          }
        } catch (closeError: any) {
          console.error(`[BREAKEVEN] ❌ Error al cerrar 50% de la posición: ${closeError.message}`);
          // Continuar con el movimiento del stop loss aunque falle el cierre
        }

        // 2. Mover stop loss al precio de entrada (breakeven)
        try {
          const newStopLoss = alert.entryPrice || breakevenPrice;
          
          console.log(`[BREAKEVEN] Moviendo stop loss a precio de entrada: ${newStopLoss}`);
          
          await this.bitgetService.modifyPositionStopLoss(
            decryptedCredentials,
            symbol,
            newStopLoss,
            productType,
            marginCoin,
            trade.take_profit ? parseFloat(trade.take_profit.toString()) : undefined
          );

          console.log(`[BREAKEVEN] ✅ Stop loss movido a breakeven exitosamente`);

          // Actualizar stop loss en base de datos
          await TradeModel.updateStopLoss(trade.id, newStopLoss);
        } catch (slError: any) {
          console.error(`[BREAKEVEN] ❌ Error al mover stop loss: ${slError.message}`);
          // No fallar si solo el stop loss falla
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

