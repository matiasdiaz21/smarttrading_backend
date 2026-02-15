export interface User {
  id: number;
  uuid: string | null;
  email: string;
  password_hash: string;
  role: 'admin' | 'user';
  subscription_status: 'active' | 'inactive' | 'expired';
  subscription_expires_at: Date | null;
  trading_terms_accepted_at: Date | null;
  created_at: Date;
}

export interface Strategy {
  id: number;
  name: string;
  description: string | null;
  warnings: string | null;
  tradingview_webhook_secret: string;
  is_active: boolean;
  leverage: number;
  /** Símbolos permitidos (ej. ["BTCUSDT","ETHUSDT"]). Null o vacío = todos permitidos. */
  allowed_symbols: string[] | null;
  created_by: number;
  created_at: Date;
}

export interface UserBitgetCredentials {
  id: number;
  user_id: number;
  api_key: string; // encriptado
  api_secret: string; // encriptado
  passphrase: string; // encriptado
  name: string | null; // nombre opcional (ej. "Cuenta principal")
  is_active: boolean;
  created_at: Date;
}

export interface UserStrategySubscription {
  id: number;
  user_id: number;
  strategy_id: number;
  is_enabled: boolean;
  leverage: number | null;
  position_size: number | null; // Tamaño de posición en USDT
  /** Símbolos que el usuario no quiere copiar en esta estrategia. */
  excluded_symbols: string[] | null;
  credential_id: number | null; // Credencial Bitget asignada (1:1 con estrategia)
  use_partial_tp: boolean; // Si true, usa TP parcial 50% en breakeven + 50% en TP final
  created_at: Date;
  updated_at: Date;
}

export interface Trade {
  id: number;
  user_id: number;
  strategy_id: number;
  bitget_order_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  order_type: 'limit' | 'market';
  size: string;
  price: string | null;
  status: 'pending' | 'filled' | 'cancelled' | 'failed';
  executed_at: Date;
  trade_id?: number | string | null;
  entry_price?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  breakeven?: number | null;
  alert_type?: string | null;
}

export interface WebhookLog {
  id: number;
  strategy_id: number;
  payload: string;
  signature: string | null;
  status: 'success' | 'failed' | 'invalid';
  processed_at: Date;
}

export interface Subscription {
  id: number;
  user_id: number;
  payment_plan_id: number | null;
  payment_id: string;
  order_id: string | null;
  payment_status: string | null;
  pay_address: string | null;
  pay_amount: number | null;
  pay_currency: string | null;
  purchase_id: string | null;
  amount_received: number | null;
  network: string | null;
  expiration_estimate_date: Date | null;
  nowpayments_created_at: Date | null;
  nowpayments_updated_at: Date | null;
  status: 'pending' | 'confirmed' | 'expired' | 'cancelled';
  amount: number;
  currency: string;
  expires_at: Date | null;
  created_at: Date;
}

export interface PaymentPlan {
  id: number;
  title: string;
  description: string | null;
  amount: number;
  currency: string;
  pay_currency: string | null;
  duration_days: number;
  features: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface JWTPayload {
  userId: number;
  email: string;
  role: 'admin' | 'user';
}

export interface TradingViewAlert {
  symbol: string;
  side: 'buy' | 'sell' | 'LONG' | 'SHORT';
  orderType: 'limit' | 'market';
  size?: string;
  price?: string;
  productType?: string;
  marginMode?: string;
  marginCoin?: string;
  alertType?: 'ENTRY' | 'BREAKEVEN' | 'STOP_LOSS' | 'TAKE_PROFIT';
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  breakeven?: number;
  trade_id?: number | string;
  strategy?: string;
  timeframe?: string;
  [key: string]: any;
}

export type NotificationType = 
  | 'trade_executed' 
  | 'trade_failed' 
  | 'tp_failed' 
  | 'sl_failed' 
  | 'tp_sl_failed' 
  | 'position_warning' 
  | 'system';

export type NotificationSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface Notification {
  id: number;
  user_id: number;
  type: NotificationType;
  title: string;
  message: string;
  severity: NotificationSeverity;
  is_read: boolean;
  metadata: any;
  created_at: Date;
  read_at: Date | null;
}

export interface MassTradeSymbolConfig {
  symbol: string;
  sl_percent?: number;
  tp_percent?: number;
}

export interface MassTradeConfig {
  id: number;
  user_id: number;
  name: string;
  credential_id: number;
  side: 'buy' | 'sell';
  leverage: number;
  stop_loss_percent: number;
  take_profit_percent: number | null;
  position_size_usdt: number;
  symbols: MassTradeSymbolConfig[];
  product_type: string;
  margin_coin: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface MassTradeExecution {
  id: number;
  config_id: number;
  user_id: number;
  side: 'buy' | 'sell';
  leverage: number;
  symbols_count: number;
  successful: number;
  failed: number;
  results: any;
  executed_at: Date;
}
