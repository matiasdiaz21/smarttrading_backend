-- Configuración global: prueba gratuita para usuarios nuevos
CREATE TABLE IF NOT EXISTS app_settings (
  id INT PRIMARY KEY DEFAULT 1,
  free_trial_enabled BOOLEAN NOT NULL DEFAULT false,
  free_trial_days INT NOT NULL DEFAULT 7
);

INSERT INTO app_settings (id, free_trial_enabled, free_trial_days)
VALUES (1, false, 7)
ON DUPLICATE KEY UPDATE id = id;
