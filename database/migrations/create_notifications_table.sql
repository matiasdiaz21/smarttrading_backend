-- Migración: Crear tabla de notificaciones para el usuario
-- Fecha: 2026-01-28

CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type ENUM('trade_executed', 'trade_failed', 'tp_failed', 'sl_failed', 'tp_sl_failed', 'position_warning', 'system') NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    severity ENUM('info', 'warning', 'error', 'critical') NOT NULL DEFAULT 'info',
    is_read BOOLEAN NOT NULL DEFAULT false,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_is_read (is_read),
    INDEX idx_created_at (created_at),
    INDEX idx_type (type),
    INDEX idx_severity (severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Comentarios sobre los tipos de notificaciones:
-- trade_executed: Trade ejecutado exitosamente con TP/SL configurados
-- trade_failed: Trade falló al ejecutarse
-- tp_failed: Trade ejecutado pero Take Profit no se pudo configurar (CRÍTICO)
-- sl_failed: Trade ejecutado pero Stop Loss no se pudo configurar (CRÍTICO)
-- tp_sl_failed: Trade ejecutado pero ni TP ni SL se pudieron configurar (CRÍTICO)
-- position_warning: Advertencias sobre posiciones abiertas
-- system: Notificaciones del sistema
