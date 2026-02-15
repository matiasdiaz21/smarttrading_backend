-- Cada estrategia (suscripción) está atada a una credencial de Bitget.
-- Una credencial puede compartirse entre estrategias siempre que sus símbolos no se solapen.
-- La validación de conflictos se hace a nivel de aplicación (por símbolos, no por estrategia).

ALTER TABLE user_strategy_subscriptions
  ADD COLUMN credential_id INT NULL AFTER position_size,
  ADD CONSTRAINT fk_subscription_credential
    FOREIGN KEY (credential_id) REFERENCES user_bitget_credentials(id) ON DELETE SET NULL;
