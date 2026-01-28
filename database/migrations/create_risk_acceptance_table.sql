-- Migración: Crear tabla de aceptación de riesgo para copy trading
-- Fecha: 2026-01-28

CREATE TABLE IF NOT EXISTS risk_acceptance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    strategy_id INT NOT NULL,
    accepted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45) NULL,
    user_agent TEXT NULL,
    acceptance_text TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_strategy (user_id, strategy_id),
    INDEX idx_user_id (user_id),
    INDEX idx_strategy_id (strategy_id),
    INDEX idx_accepted_at (accepted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Comentarios:
-- Esta tabla registra la aceptación explícita del usuario sobre los riesgos
-- de pérdida de fondos al activar el copy trading de una estrategia.
-- La combinación user_id + strategy_id es única para evitar duplicados.
-- Se registra IP y User-Agent para auditoría legal.
