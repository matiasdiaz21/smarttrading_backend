-- Historial de ejecuciones del cron /api/cron/ai-auto-run
-- Para saber si hubo error o si realmente se ejecutó (solo el cronjob debe disparar la ejecución).

CREATE TABLE IF NOT EXISTS ai_cron_run_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ran_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'ran' COMMENT 'ran = se ejecutó análisis, skipped = no se ejecutó',
  success TINYINT(1) NULL COMMENT '1 = ok, 0 = error; solo cuando status=ran',
  analyzed INT NULL COMMENT 'activos analizados',
  predictions_count INT NULL,
  errors_count INT NULL,
  error_message TEXT NULL COMMENT 'mensaje de error si success=0',
  skip_reason VARCHAR(255) NULL COMMENT 'razón si status=skipped (unauthorized, disabled, interval)',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ran_at (ran_at DESC),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
