-- Permite dar nombre a cada credencial de Bitget (ej. "Cuenta principal", "Futuros 2").

ALTER TABLE user_bitget_credentials
  ADD COLUMN name VARCHAR(255) NULL AFTER passphrase;
