-- Credenciales de Bybit por usuario (API Key + Secret; Bybit no usa passphrase).
CREATE TABLE IF NOT EXISTS user_bybit_credentials (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    api_key TEXT NOT NULL,
    api_secret TEXT NOT NULL,
    name VARCHAR(255) NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
