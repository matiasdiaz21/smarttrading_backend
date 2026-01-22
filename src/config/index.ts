import dotenv from 'dotenv';

dotenv.config();

export const config = {
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY || 'your-32-character-encryption-key!!',
    algorithm: 'aes-256-cbc',
  },
  bitget: {
    apiBaseUrl: process.env.BITGET_API_BASE_URL || 'https://api.bitget.com',
  },
  nowpayments: {
    apiKey: process.env.NOWPAYMENTS_API_KEY || '',
    apiUrl: process.env.NOWPAYMENTS_API_URL || 'https://api.nowpayments.io/v1',
    webhookSecret: process.env.NOWPAYMENTS_WEBHOOK_SECRET || '',
  },
  app: {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3000,
  },
};

