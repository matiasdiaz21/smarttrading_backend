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
      // Verificar que el usuario tenga suscripción activa
      const user = await UserModel.findById(userId);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      const activeSubscription = await PaymentSubscriptionModel.findActiveByUserId(userId);
      if (!activeSubscription) {
        return { success: false, error: 'User does not have an active subscription' };
      }

      // Obtener credenciales activas del usuario
      const credentials = await CredentialsModel.findActiveByUserId(userId);
      if (!credentials) {
        return { success: false, error: 'User does not have active Bitget credentials' };
      }

      // Desencriptar credenciales
      const decryptedCredentials = BitgetService.getDecryptedCredentials({
        api_key: credentials.api_key,
        api_secret: credentials.api_secret,
        passphrase: credentials.passphrase,
      });

      // Preparar datos de la orden
      const orderData = {
        symbol: alert.symbol,
        productType: alert.productType || 'USDT-FUTURES',
        marginMode: alert.marginMode || 'isolated',
        marginCoin: alert.marginCoin || 'USDT',
        size: alert.size || '0.01',
        price: alert.price,
        side: alert.side,
        tradeSide: alert.tradeSide || 'open',
        orderType: alert.orderType,
        force: alert.force || (alert.orderType === 'limit' ? 'gtc' : undefined),
        clientOid: `ST_${userId}_${strategyId}_${Date.now()}`,
      };

      // Ejecutar orden en Bitget
      const result = await this.bitgetService.placeOrder(
        decryptedCredentials,
        orderData
      );

      // Registrar trade en base de datos
      await TradeModel.create(
        userId,
        strategyId,
        result.orderId,
        alert.symbol,
        alert.side,
        alert.orderType,
        orderData.size,
        alert.price || null,
        'pending'
      );

      return { success: true, orderId: result.orderId };
    } catch (error: any) {
      // Registrar trade fallido
      try {
        await TradeModel.create(
          userId,
          strategyId,
          `FAILED_${Date.now()}`,
          alert.symbol,
          alert.side,
          alert.orderType,
          alert.size || '0.01',
          alert.price || null,
          'failed'
        );
      } catch (dbError) {
        // Ignorar error de DB si falla
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
    // Buscar todos los usuarios suscritos a la estrategia con copia habilitada
    const subscriptions = await SubscriptionModel.findByStrategyId(
      strategyId,
      true // solo habilitadas
    );

    let successful = 0;
    let failed = 0;

    // Procesar cada suscripción
    for (const subscription of subscriptions) {
      const result = await this.executeTradeForUser(
        subscription.user_id,
        strategyId,
        alert
      );

      if (result.success) {
        successful++;
      } else {
        failed++;
      }
    }

    return {
      processed: subscriptions.length,
      successful,
      failed,
    };
  }
}

