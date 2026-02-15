-- Tabla para guardar configuraciones de trades masivos
CREATE TABLE IF NOT EXISTS mass_trade_configs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  credential_id INT NOT NULL,
  side ENUM('buy', 'sell') NOT NULL DEFAULT 'buy',
  leverage INT NOT NULL DEFAULT 10,
  stop_loss_percent DECIMAL(5,2) NOT NULL DEFAULT 2.00,
  position_size_usdt DECIMAL(12,2) NOT NULL DEFAULT 10.00,
  symbols JSON NOT NULL,
  product_type VARCHAR(50) NOT NULL DEFAULT 'USDT-FUTURES',
  margin_coin VARCHAR(20) NOT NULL DEFAULT 'USDT',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (credential_id) REFERENCES user_bitget_credentials(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabla para registrar ejecuciones de trades masivos
CREATE TABLE IF NOT EXISTS mass_trade_executions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  config_id INT NOT NULL,
  user_id INT NOT NULL,
  side ENUM('buy', 'sell') NOT NULL,
  leverage INT NOT NULL,
  symbols_count INT NOT NULL DEFAULT 0,
  successful INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  results JSON,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (config_id) REFERENCES mass_trade_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
