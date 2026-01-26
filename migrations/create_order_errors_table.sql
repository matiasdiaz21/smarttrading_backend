CREATE TABLE IF NOT EXISTS order_errors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  strategy_id INT NOT NULL,
  symbol VARCHAR(50) NOT NULL,
  side VARCHAR(10) NOT NULL,
  alert_type VARCHAR(20) NOT NULL,
  trade_id INT NULL,
  error_message TEXT NOT NULL,
  bitget_response JSON NULL,
  alert_data JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_strategy_id (strategy_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
