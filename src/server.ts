import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { apiLimiter } from './middleware/rateLimit';

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
import { AuthController } from './controllers/auth.controller';
import { StrategyController } from './controllers/strategy.controller';
import { CredentialsController } from './controllers/credentials.controller';
import { UserController } from './controllers/user.controller';
import { WebhookController } from './controllers/webhook.controller';
import { PaymentController } from './controllers/payment.controller';
import { PaymentPlanController } from './controllers/paymentPlan.controller';
import { NOWPaymentsCredentialsController } from './controllers/nowpaymentsCredentials.controller';
import { NOWPaymentsController } from './controllers/nowpayments.controller';
import { AdminController } from './controllers/admin.controller';
import { StatsController } from './controllers/stats.controller';
import { authenticate, requireAdmin } from './middleware/auth';
import { authLimiter, webhookLimiter } from './middleware/rateLimit';
import { config } from './config';

const app = express();

// Configurar trust proxy para funcionar detrás de proxies (Vercel, nginx, etc.)
// Esto es necesario para que express-rate-limit funcione correctamente
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Logging middleware para desarrollo
if (process.env.NODE_ENV === 'development') {
  app.use((req: Request, res: Response, next: any) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// Aplicar rate limiting solo a rutas de API (excluir health check)
app.use('/api', (req, res, next) => {
  // Excluir health check del rate limiting
  if (req.path === '/health') {
    return next();
  }
  return apiLimiter(req, res, next);
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
  res.status(404).json({ error: 'Route not found' });
});

// Start server
const PORT = config.app.port;
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
});

