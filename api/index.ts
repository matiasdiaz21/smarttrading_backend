import type { VercelRequest, VercelResponse } from '@vercel/node';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { apiLimiter } from '../src/middleware/rateLimit';

// Suprimir warning de deprecación de url.parse() que viene de dependencias
// Este warning viene de librerías como mysql2 o axios que aún usan url.parse()
// No podemos controlarlo directamente, así que lo suprimimos
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('url.parse()')) {
    // Suprimir solo el warning de url.parse() que viene de dependencias
    return;
  }
  // Mostrar otros warnings normalmente
  console.warn(warning.name, warning.message);
});

// Cargar variables de entorno (solo en desarrollo local)
// En Vercel, las variables se inyectan automáticamente
dotenv.config();

// Logging de variables de entorno para diagnóstico
console.log('🔍 Variables de entorno detectadas:');
console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'no definido'}`);
console.log(`   VERCEL: ${process.env.VERCEL || 'no definido'}`);
console.log(`   DB_HOST: ${process.env.DB_HOST ? '✅ configurado' : '❌ NO configurado'}`);
console.log(`   DB_USER: ${process.env.DB_USER ? '✅ configurado' : '❌ NO configurado'}`);
console.log(`   DB_PASSWORD: ${process.env.DB_PASSWORD ? '✅ configurado' : '❌ NO configurado'}`);
console.log(`   DB_NAME: ${process.env.DB_NAME ? '✅ configurado' : '❌ NO configurado'}`);
import { AuthController } from '../src/controllers/auth.controller';
import { StrategyController } from '../src/controllers/strategy.controller';
import { CredentialsController } from '../src/controllers/credentials.controller';
import { BybitCredentialsController } from '../src/controllers/bybitCredentials.controller';
import { UserController } from '../src/controllers/user.controller';
import { WebhookController } from '../src/controllers/webhook.controller';
import { PaymentController } from '../src/controllers/payment.controller';
import { PaymentPlanController } from '../src/controllers/paymentPlan.controller';
import { NOWPaymentsCredentialsController } from '../src/controllers/nowpaymentsCredentials.controller';
import { NOWPaymentsController } from '../src/controllers/nowpayments.controller';
import { AdminController } from '../src/controllers/admin.controller';
import { StatsController } from '../src/controllers/stats.controller';
import { SettingsController } from '../src/controllers/settings.controller';
import { AiController } from '../src/controllers/ai.controller';

import { NotificationsController } from '../src/controllers/notifications.controller';
import { MassTradeController } from '../src/controllers/massTrade.controller';
import { TradingTestController } from '../src/controllers/tradingTest.controller';
import { authenticate, requireAdmin } from '../src/middleware/auth';
import { authLimiter, webhookLimiter } from '../src/middleware/rateLimit';

const app = express();

// Configurar trust proxy para funcionar detrás de proxies (Vercel, nginx, etc.)
// Esto es necesario para que express-rate-limit funcione correctamente
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Aplicar rate limiting solo a rutas de API (excluir health check)
app.use('/api', (req: Request, res: Response, next: any) => {
  // Excluir health check del rate limiting
  if (req.path === '/health') {
    return next();
  }
  return apiLimiter(req, res, next);
});

// Root route
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'SyncTrade Backend API',
    version: '1.0.0',
    status: 'online',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      publicStats: '/api/public/stats',
      auth: '/api/auth',
      api: '/api',
      envCheck: '/api/env-check',
    },
  });
});

// Endpoint de diagnóstico de variables de entorno (solo para debugging)
app.get('/api/env-check', (req: Request, res: Response) => {
  // Obtener todas las variables de entorno relacionadas con DB
  const allEnvVars = Object.keys(process.env).filter(key => 
    key.startsWith('DB_') || 
    key === 'NODE_ENV' || 
    key === 'VERCEL' ||
    key === 'JWT_SECRET' ||
    key === 'ENCRYPTION_KEY'
  );

  const envVars: Record<string, any> = {
    NODE_ENV: process.env.NODE_ENV || 'no definido',
    VERCEL: process.env.VERCEL || 'no definido',
    VERCEL_ENV: process.env.VERCEL_ENV || 'no definido',
  };

  // Agregar todas las variables DB_ encontradas
  allEnvVars.forEach(key => {
    if (key.startsWith('DB_')) {
      const value = process.env[key];
      envVars[key] = value ? `✅ configurado (${value.length} caracteres)` : '❌ NO configurado';
    } else if (key === 'JWT_SECRET' || key === 'ENCRYPTION_KEY') {
      const value = process.env[key];
      envVars[key] = value ? `✅ configurado (${value.length} caracteres)` : '❌ NO configurado';
    }
  });

  const requiredVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);

  // Información adicional para diagnóstico
  const diagnosticInfo = {
    totalEnvVars: Object.keys(process.env).length,
    dbRelatedVars: allEnvVars.filter(k => k.startsWith('DB_')),
    vercelEnv: process.env.VERCEL_ENV,
    isProduction: process.env.NODE_ENV === 'production',
  };

  res.json({
    message: 'Diagnóstico de Variables de Entorno',
    environment: envVars,
    missing: missingVars.length > 0 ? missingVars : 'Ninguna',
    diagnostic: diagnosticInfo,
    instructions: missingVars.length > 0 
      ? {
          step1: 'Ve a Vercel Dashboard > Tu proyecto > Settings > Environment Variables',
          step2: 'Verifica que las variables estén configuradas para "Production" (no solo Preview o Development)',
          step3: 'Asegúrate de que los valores no tengan espacios al inicio o final',
          step4: 'Haz clic en "Save" después de cada variable',
          step5: 'Ve a Deployments y haz clic en "Redeploy" en el último deployment',
          step6: 'Espera a que termine el deployment y verifica nuevamente',
        }
      : 'Todas las variables están configuradas',
  });
});

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public stats route (sin autenticación)
app.get('/api/public/stats', StatsController.getPublicStats);

// Settings (público: solo free_trial para el frontend)
app.get('/api/settings', SettingsController.getPublic);


// Auth routes
app.post('/api/auth/register', authLimiter, AuthController.register);
app.post('/api/auth/login', authLimiter, AuthController.login);
app.get('/api/auth/me', authenticate, AuthController.me);

// Strategy routes
app.get('/api/strategies', authenticate, StrategyController.list);
app.get('/api/strategies/:id', authenticate, StrategyController.getById);
app.post('/api/strategies', authenticate, requireAdmin, StrategyController.create);
app.put('/api/strategies/:id', authenticate, requireAdmin, StrategyController.update);
app.delete('/api/strategies/:id', authenticate, requireAdmin, StrategyController.delete);

// Credentials routes
app.get('/api/bitget/credentials', authenticate, CredentialsController.list);
app.post('/api/bitget/credentials', authenticate, CredentialsController.create);
app.put('/api/bitget/credentials/:id', authenticate, CredentialsController.update);
app.delete('/api/bitget/credentials/:id', authenticate, CredentialsController.delete);
app.post('/api/bitget/credentials/:id/validate', authenticate, CredentialsController.validate);

app.get('/api/bybit/credentials', authenticate, BybitCredentialsController.list);
app.post('/api/bybit/credentials', authenticate, BybitCredentialsController.create);
app.put('/api/bybit/credentials/:id', authenticate, BybitCredentialsController.update);
app.delete('/api/bybit/credentials/:id', authenticate, BybitCredentialsController.delete);
app.post('/api/bybit/credentials/:id/validate', authenticate, BybitCredentialsController.validate);

// User routes
app.get('/api/user/strategies', authenticate, UserController.getStrategies);
app.post('/api/user/strategies/:id/subscribe', authenticate, UserController.subscribeToStrategy);
app.put('/api/user/strategies/:id/toggle', authenticate, UserController.toggleStrategy);
app.put('/api/user/strategies/:id/leverage', authenticate, UserController.updateLeverage);
app.put('/api/user/strategies/:id/position-size', authenticate, UserController.updatePositionSize);
app.put('/api/user/strategies/:id/excluded-symbols', authenticate, UserController.updateExcludedSymbols);
app.put('/api/user/strategies/:id/partial-tp', authenticate, UserController.updatePartialTp);
app.put('/api/user/strategies/:id/credential', authenticate, UserController.updateStrategyCredential);
app.get('/api/user/positions', authenticate, UserController.getPositions);
app.get('/api/user/trades/closed', authenticate, UserController.getClosedTrades);
app.get('/api/user/subscription', authenticate, UserController.getSubscriptionStatus);
app.get('/api/user/pending-payment', authenticate, UserController.getPendingPayment);
app.post('/api/user/trading-terms/accept', authenticate, UserController.acceptTradingTerms);
app.get('/api/user/trading-terms/status', authenticate, UserController.getTradingTermsStatus);

// Notifications routes
app.get('/api/notifications', authenticate, NotificationsController.getNotifications);
app.get('/api/notifications/unread-count', authenticate, NotificationsController.getUnreadCount);
app.post('/api/notifications/:id/read', authenticate, NotificationsController.markAsRead);
app.post('/api/notifications/read-all', authenticate, NotificationsController.markAllAsRead);

// Mass Trade routes
app.get('/api/mass-trade/configs', authenticate, MassTradeController.listConfigs);
app.get('/api/mass-trade/configs/:id', authenticate, MassTradeController.getConfig);
app.post('/api/mass-trade/configs', authenticate, MassTradeController.createConfig);
app.put('/api/mass-trade/configs/:id', authenticate, MassTradeController.updateConfig);
app.delete('/api/mass-trade/configs/:id', authenticate, MassTradeController.deleteConfig);
app.post('/api/mass-trade/configs/:id/execute', authenticate, MassTradeController.execute);
app.post('/api/mass-trade/configs/:id/close-all', authenticate, MassTradeController.closeAll);
app.get('/api/mass-trade/executions', authenticate, MassTradeController.getExecutions);

// Webhook routes (público, pero con verificación HMAC)
app.get('/api/webhooks/tradingview/test', WebhookController.test); // Endpoint de prueba
app.post('/api/webhooks/tradingview', webhookLimiter, WebhookController.tradingView);

// Payment routes
app.post('/api/payments/create', authenticate, PaymentController.createPayment);
app.post('/api/payments/webhook', PaymentController.webhook);
app.get('/api/payments/:payment_id', authenticate, PaymentController.getPaymentStatus);
app.post('/api/payments/:payment_id/cancel', authenticate, PaymentController.cancelPayment);

// Payment Plan routes
app.get('/api/payment-plans', authenticate, PaymentPlanController.list);
app.get('/api/payment-plans/active', PaymentPlanController.getActive);
app.get('/api/payment-plans/:id', authenticate, PaymentPlanController.getById);
app.post('/api/payment-plans', authenticate, requireAdmin, PaymentPlanController.create);
app.put('/api/payment-plans/:id', authenticate, requireAdmin, PaymentPlanController.update);
app.delete('/api/payment-plans/:id', authenticate, requireAdmin, PaymentPlanController.delete);

// NOWPayments Credentials routes
app.get('/api/admin/nowpayments-credentials', authenticate, requireAdmin, NOWPaymentsCredentialsController.get);
app.get('/api/admin/nowpayments-credentials/active', authenticate, requireAdmin, NOWPaymentsCredentialsController.getActive);
app.get('/api/admin/nowpayments-credentials/:id', authenticate, requireAdmin, NOWPaymentsCredentialsController.getById);
app.post('/api/admin/nowpayments-credentials', authenticate, requireAdmin, NOWPaymentsCredentialsController.create);
app.put('/api/admin/nowpayments-credentials/:id', authenticate, requireAdmin, NOWPaymentsCredentialsController.update);
app.delete('/api/admin/nowpayments-credentials/:id', authenticate, requireAdmin, NOWPaymentsCredentialsController.delete);
app.post('/api/admin/nowpayments-credentials/:id/test', authenticate, requireAdmin, NOWPaymentsCredentialsController.testConnection);

// NOWPayments routes
app.get('/api/admin/nowpayments/payments', authenticate, requireAdmin, NOWPaymentsController.getPayments);
app.get('/api/admin/nowpayments/currencies', authenticate, requireAdmin, NOWPaymentsController.getCurrencies);

// Admin routes
app.get('/api/admin/users', authenticate, requireAdmin, AdminController.getUsers);
app.get('/api/admin/webhook-logs', authenticate, requireAdmin, AdminController.getWebhookLogs);
app.get('/api/admin/webhook-logs/symbols', authenticate, requireAdmin, AdminController.getWebhookLogSymbols);
app.delete('/api/admin/webhook-logs/symbol-group', authenticate, requireAdmin, AdminController.deleteWebhookLogSymbolGroup);
app.delete('/api/admin/webhook-logs/group', authenticate, requireAdmin, AdminController.deleteWebhookLogGroup);
app.delete('/api/admin/webhook-logs/:id', authenticate, requireAdmin, AdminController.deleteWebhookLog);
app.get('/api/admin/order-errors', authenticate, requireAdmin, AdminController.getOrderErrors);
app.get('/api/admin/bitget/fee-rate', authenticate, requireAdmin, AdminController.getBitgetFeeRate);
// Endpoint público para logs de operaciones Bitget
app.get('/api/admin/bitget-operation-logs', AdminController.getBitgetOperationLogs);
app.post('/api/admin/bitget-operation-logs/:id/review', AdminController.markLogAsReviewed);
app.post('/api/admin/bitget-operation-logs/:id/unreview', AdminController.markLogAsUnreviewed);
app.get('/api/admin/stats', authenticate, requireAdmin, AdminController.getStats);
app.get('/api/admin/settings', authenticate, requireAdmin, SettingsController.getAdmin);
app.put('/api/admin/settings', authenticate, requireAdmin, SettingsController.updateAdmin);
app.put('/api/admin/settings/stats-strategies', authenticate, requireAdmin, SettingsController.updateStatsStrategies);

// AI Trading routes (user)
app.get('/api/ai/config', authenticate, AiController.getPublicConfig);
app.get('/api/ai/predictions', authenticate, AiController.getPredictions);
app.get('/api/ai/predictions/:id', authenticate, AiController.getPredictionById);
app.get('/api/ai/stats', authenticate, AiController.getStats);
app.get('/api/ai/assets', authenticate, AiController.getAssets);

// AI Trading routes (admin)
app.get('/api/admin/ai/config', authenticate, requireAdmin, AiController.getConfig);
  app.put('/api/admin/ai/config', authenticate, requireAdmin, AiController.updateConfig);
  app.get('/api/admin/ai/groq-models', authenticate, requireAdmin, AiController.getGroqModels);
  app.post('/api/admin/ai/analyze', authenticate, requireAdmin, AiController.triggerAnalysis);
  app.get('/api/admin/ai/assets', authenticate, requireAdmin, AiController.getAdminAssets);
  app.post('/api/admin/ai/assets', authenticate, requireAdmin, AiController.addAsset);
  app.put('/api/admin/ai/assets/:id', authenticate, requireAdmin, AiController.updateAsset);
  app.put('/api/admin/ai/assets/:id/toggle', authenticate, requireAdmin, AiController.toggleAsset);
  app.delete('/api/admin/ai/assets/:id', authenticate, requireAdmin, AiController.deleteAsset);
app.delete('/api/admin/ai/predictions/:id', authenticate, requireAdmin, AiController.deletePrediction);
app.put('/api/admin/ai/predictions/:id/resolve', authenticate, requireAdmin, AiController.resolvePrediction);
app.post('/api/admin/ai/check-results', authenticate, requireAdmin, AiController.forceCheckResults);

// Trading Test routes (admin)
app.get('/api/admin/trading/credentials', authenticate, requireAdmin, TradingTestController.getCredentials);
app.get('/api/admin/trading/positions', authenticate, requireAdmin, TradingTestController.getPositions);
app.get('/api/admin/trading/pending-triggers', authenticate, requireAdmin, TradingTestController.getPendingTriggers);
app.get('/api/admin/trading/ticker', authenticate, requireAdmin, TradingTestController.getTicker);
app.get('/api/admin/trading/symbols-config', authenticate, requireAdmin, TradingTestController.getSymbolsConfig);
app.post('/api/admin/trading/test-open', authenticate, requireAdmin, TradingTestController.testOpenPosition);
app.post('/api/admin/trading/test-breakeven', authenticate, requireAdmin, TradingTestController.testBreakeven);
app.post('/api/admin/trading/test-close', authenticate, requireAdmin, TradingTestController.testClosePosition);
app.post('/api/admin/trading/cancel-triggers', authenticate, requireAdmin, TradingTestController.cancelTriggers);

// Error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req: Request, res: Response) => {
  console.log(`404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Route not found', path: req.path, method: req.method });
});

// Vercel serverless function handler
export default function handler(req: VercelRequest, res: VercelResponse) {
  // Agregar logging extensivo para debugging
  const timestamp = new Date().toISOString();
  const url = req.url || '/';
  const method = req.method || 'GET';
  
  // Extraer path de la URL (remover query string)
  const path = url.split('?')[0];
  
  // Logging que aparecerá en Vercel
  console.log(`\n========== REQUEST RECIBIDO ==========`);
  console.log(`[${timestamp}] ${method} ${url}`);
  console.log(`[${timestamp}] Original URL: ${req.url}`);
  console.log(`[${timestamp}] Path: ${path}`);
  console.log(`[${timestamp}] Query:`, JSON.stringify(req.query));
  console.log(`[${timestamp}] Headers:`, {
    'content-type': req.headers['content-type'],
    'user-agent': req.headers['user-agent']?.substring(0, 50),
  });
  console.log(`========================================\n`);
  
  // Ejecutar la app de Express
  return app(req, res);
}

