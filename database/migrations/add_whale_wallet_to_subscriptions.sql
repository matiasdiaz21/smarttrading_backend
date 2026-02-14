-- Suscripción a una sola whale por usuario (indicadores ballenas)
ALTER TABLE user_strategy_subscriptions
ADD COLUMN whale_wallet_id INT NULL
AFTER position_size,
ADD CONSTRAINT fk_whale_wallet FOREIGN KEY (whale_wallet_id) REFERENCES whale_wallets(id) ON DELETE SET NULL;
