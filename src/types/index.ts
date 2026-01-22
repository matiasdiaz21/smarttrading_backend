export interface User {
  id: number;
  email: string;
  password_hash: string;
  role: 'admin' | 'user';
  subscription_status: 'active' | 'inactive' | 'expired';
  subscription_expires_at: Date | null;
  created_at: Date;
}

export interface Strategy {
  id: number;
  name: string;
  description: string | null;
  tradingview_webhook_secret: string;
  is_active: boolean;
  created_by: number;
  created_at: Date;
}

export interface UserBitgetCredentials {
  id: number;
  user_id: number;
  api_key: string; // encriptado
  api_secret: string; // encriptado
  passphrase: string; // encriptado
  is_active: boolean;
  created_at: Date;
}

export interface UserStrategySubscription {
  id: number;
  user_id: number;
  strategy_id: number;
  is_enabled: boolean;
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
  payment_id: string;
  status: 'pending' | 'confirmed' | 'expired' | 'cancelled';
  amount: number;
  currency: string;
  expires_at: Date | null;
  created_at: Date;
}

export interface JWTPayload {
  userId: number;
  email: string;
  role: 'admin' | 'user';
}

export interface TradingViewAlert {
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market';
  size?: string;
  price?: string;
  productType?: string;
  marginMode?: string;
  marginCoin?: string;
  [key: string]: any;
}

