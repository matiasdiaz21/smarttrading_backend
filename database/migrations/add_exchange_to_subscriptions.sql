-- Indica si la credencial asociada (credential_id) es de Bitget o Bybit.
-- Para Bitget: credential_id -> user_bitget_credentials.id
-- Para Bybit: credential_id -> user_bybit_credentials.id (validación en aplicación).
ALTER TABLE user_strategy_subscriptions
  ADD COLUMN exchange VARCHAR(10) NOT NULL DEFAULT 'bitget' AFTER credential_id;
