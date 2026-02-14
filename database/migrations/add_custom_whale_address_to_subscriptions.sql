-- Permite que el usuario se suscriba a una billetera whale por dirección (0x...) además de las registradas por admin
ALTER TABLE user_strategy_subscriptions
ADD COLUMN custom_whale_address VARCHAR(42) NULL
AFTER whale_wallet_id;
