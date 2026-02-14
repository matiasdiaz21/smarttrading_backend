-- Cada estrategia (suscripción) está atada a una credencial de Bitget.
-- Una credencial no puede estar asignada a más de una estrategia a la vez (por usuario).
-- UNIQUE(user_id, credential_id): varias filas pueden tener credential_id NULL; no dos la misma credencial.

ALTER TABLE user_strategy_subscriptions
  ADD COLUMN credential_id INT NULL AFTER position_size,
  ADD CONSTRAINT fk_subscription_credential
    FOREIGN KEY (credential_id) REFERENCES user_bitget_credentials(id) ON DELETE SET NULL,
  ADD UNIQUE KEY unique_user_credential (user_id, credential_id);
