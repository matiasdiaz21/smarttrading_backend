-- Tabla de modelos Groq disponibles para configurar en AI
CREATE TABLE IF NOT EXISTS groq_models (
  id INT PRIMARY KEY AUTO_INCREMENT,
  model_id VARCHAR(120) NOT NULL COMMENT 'ID del modelo en la API Groq (ej. llama-3.3-70b-versatile)',
  name VARCHAR(200) NOT NULL COMMENT 'Nombre para mostrar en la UI',
  is_active TINYINT(1) DEFAULT 1,
  sort_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_model_id (model_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed: modelos Groq conocidos (producción y preview)
INSERT IGNORE INTO groq_models (model_id, name, is_active, sort_order) VALUES
('llama-3.3-70b-versatile', 'Llama 3.3 70B Versatile (Production)', 1, 10),
('llama-3.1-8b-instant', 'Llama 3.1 8B Instant (Production)', 1, 20),
('llama-3.1-70b-versatile', 'Llama 3.1 70B Versatile', 1, 30),
('llama-3.1-405b-reasoning', 'Llama 3.1 405B Reasoning (Preview)', 1, 40),
('meta-llama/llama-4-scout-17b-16e-instruct', 'Llama 4 Scout 17B (Preview)', 1, 50),
('meta-llama/llama-4-maverick-17b-128e-instruct', 'Llama 4 Maverick 17B (Preview)', 1, 60),
('qwen/qwen3-32b', 'Qwen 3 32B (Preview)', 1, 70),
('openai/gpt-oss-120b', 'GPT OSS 120B (Production)', 1, 80),
('openai/gpt-oss-20b', 'GPT OSS 20B (Production)', 1, 90),
('whisper-large-v3', 'Whisper Large V3 (Audio)', 1, 100),
('whisper-large-v3-turbo', 'Whisper Large V3 Turbo (Audio)', 1, 110);
