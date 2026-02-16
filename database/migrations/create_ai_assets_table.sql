-- Tabla de activos habilitados para análisis de IA
CREATE TABLE IF NOT EXISTS ai_assets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL COMMENT 'Ej: BTCUSDT, ETHUSDT',
  display_name VARCHAR(50) DEFAULT NULL COMMENT 'Nombre para mostrar, ej: Bitcoin',
  is_enabled TINYINT(1) DEFAULT 1,
  product_type VARCHAR(30) DEFAULT 'USDT-FUTURES',
  added_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_symbol (symbol),
  INDEX idx_enabled (is_enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
