import type { VercelRequest, VercelResponse } from '@vercel/node';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { apiLimiter } from '../src/middleware/rateLimit';

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
import { UserController } from '../src/controllers/user.controller';
import { WebhookController } from '../src/controllers/webhook.controller';
import { PaymentController } from '../src/controllers/payment.controller';
import { PaymentPlanController } from '../src/controllers/paymentPlan.controller';
import { NOWPaymentsCredentialsController } from '../src/controllers/nowpaymentsCredentials.controller';
import { NOWPaymentsController } from '../src/controllers/nowpayments.controller';
import { AdminController } from '../src/controllers/admin.controller';
import { StatsController } from '../src/controllers/stats.controller';
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
    name: 'Smart Trading Backend API',
    version: '1.0.0',
    status: 'online',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      publicStats: '/api/public/stats',
      auth: '/api/auth',
      api: '/api',
    },
  });
});

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public stats route (sin autenticación)
app.get('/api/public/stats', StatsController.getPublicStats);

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

// User routes
app.get('/api/user/strategies', authenticate, UserController.getStrategies);
app.post('/api/user/strategies/:id/subscribe', authenticate, UserController.subscribeToStrategy);
app.put('/api/user/strategies/:id/toggle', authenticate, UserController.toggleStrategy);
app.get('/api/user/trades', authenticate, UserController.getTrades);
app.get('/api/user/subscription', authenticate, UserController.getSubscriptionStatus);
app.get('/api/user/pending-payment', authenticate, UserController.getPendingPayment);

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
app.get('/api/admin/stats', authenticate, requireAdmin, AdminController.getStats);

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
  const url = req.url || req.path || '/';
  const method = req.method || 'GET';
  
  // Logging que aparecerá en Vercel
  console.log(`\n========== REQUEST RECIBIDO ==========`);
  console.log(`[${timestamp}] ${method} ${url}`);
  console.log(`[${timestamp}] Original URL: ${req.url}`);
  console.log(`[${timestamp}] Path: ${req.path}`);
  console.log(`[${timestamp}] Query:`, JSON.stringify(req.query));
  console.log(`[${timestamp}] Headers:`, {
    'content-type': req.headers['content-type'],
    'user-agent': req.headers['user-agent']?.substring(0, 50),
  });
  console.log(`========================================\n`);
  
  // Ejecutar la app de Express
  return app(req, res);
}

