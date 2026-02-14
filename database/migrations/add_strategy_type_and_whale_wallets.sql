-- Migración: strategy_type en strategies y tabla whale_wallets
-- Estrategia de indicadores de ballenas (Hyperliquid)

-- 1. Añadir strategy_type a strategies (tradingview | whale_copy)
ALTER TABLE strategies
ADD COLUMN strategy_type VARCHAR(32) NOT NULL DEFAULT 'tradingview'
AFTER leverage;

-- 2. Tabla de wallets a seguir por estrategia whale_copy
CREATE TABLE IF NOT EXISTS whale_wallets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    strategy_id INT NOT NULL,
    address VARCHAR(42) NOT NULL,
    label VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE,
    INDEX idx_strategy_id (strategy_id),
    UNIQUE KEY unique_strategy_address (strategy_id, address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
