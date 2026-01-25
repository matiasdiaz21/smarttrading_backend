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
      const { StrategyModel } = await import('../models/Strategy');
      const strategy = await StrategyModel.findById(strategyId);
      const leverage = strategySubscription.leverage !== null && strategySubscription.leverage !== undefined
        ? strategySubscription.leverage
        : (strategy?.leverage || 10);
      console.log(`[TradeService] 📊 Apalancamiento configurado: ${leverage}x (${strategySubscription.leverage !== null ? 'personalizado' : 'por defecto'})`);

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

      // Calcular el tamaño correcto de la orden
      const requestedSize = alert.size || contractInfo.minTradeNum;
      const calculatedSize = this.bitgetService.calculateOrderSize(
        requestedSize,
        contractInfo.minTradeNum,
        contractInfo.sizeMultiplier
      );

      console.log(`[TradeService] 📏 Tamaño solicitado: ${requestedSize}, Tamaño calculado: ${calculatedSize}`);
      
      // Configurar el apalancamiento antes de ejecutar la orden
      try {
        const holdSide = alert.side === 'LONG' || alert.side === 'buy' ? 'long' : 'short';
        await this.bitgetService.setLeverage(
          decryptedCredentials,
          symbol,
          leverage,
          productType,
          alert.marginCoin || 'USDT',
          holdSide
        );
        console.log(`[TradeService] ✅ Apalancamiento configurado a ${leverage}x para ${symbol}`);
      } catch (leverageError: any) {
        console.warn(`[TradeService] ⚠️ No se pudo configurar el apalancamiento: ${leverageError.message}. Continuando con la orden...`);
        // Continuar con la orden aunque falle la configuración de leverage (puede que ya esté configurado)
      }
      
      // Convertir side de LONG/SHORT a buy/sell para Bitget
      const bitgetSide: 'buy' | 'sell' = alert.side === 'LONG' || alert.side === 'buy' ? 'buy' : 'sell';
      
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

      // Ejecutar orden en Bitget
      console.log(`[TradeService] 🚀 Ejecutando orden en Bitget para usuario ${userId}...`);
      console.log(`[TradeService] 📋 Datos de la orden:`, JSON.stringify(orderData, null, 2));
      
      const result = await this.bitgetService.placeOrder(
        decryptedCredentials,
        orderData
      );

      console.log(`[TradeService] ✅ Orden ejecutada en Bitget. Order ID: ${result.orderId}, Client OID: ${result.clientOid}`);

      // Registrar trade en base de datos con toda la información
      // Convertir side a buy/sell para la base de datos
      const dbSide: 'buy' | 'sell' = alert.side === 'LONG' || alert.side === 'buy' ? 'buy' : 'sell';
      
      const tradeId = await TradeModel.create(
        userId,
        strategyId,
        result.orderId,
        alert.symbol,
        dbSide,
        alert.orderType || 'market',
        orderData.size,
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

      return { success: true, orderId: result.orderId };
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

        // Modificar stop loss a precio de entrada (breakeven)
        // El entryPrice en la alerta de BREAKEVEN es el nuevo stop loss (precio de entrada)
        const newStopLoss = alert.entryPrice || alert.stopLoss;
        if (!newStopLoss) {
          console.warn(`No se proporcionó entryPrice para BREAKEVEN en trade_id ${alert.trade_id}`);
          failed++;
          continue;
        }

        // Modificar stop loss en Bitget
        // Remover .P del símbolo si existe (Bitget no acepta .P en el símbolo)
        const symbol = alert.symbol ? alert.symbol.replace(/\.P$/, '') : alert.symbol;
        
        // Usar entryPrice como nuevo stop loss (breakeven = precio de entrada)
        // Si hay takeProfit en el trade original, mantenerlo
        await this.bitgetService.modifyPositionStopLoss(
          decryptedCredentials,
          symbol,
          newStopLoss,
          alert.productType || 'USDT-FUTURES',
          alert.marginCoin || 'USDT',
          trade.take_profit ? parseFloat(trade.take_profit.toString()) : undefined
        );

        // Actualizar stop loss en base de datos
        await TradeModel.updateStopLoss(trade.id, newStopLoss);

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

