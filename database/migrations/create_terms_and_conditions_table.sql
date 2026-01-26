-- Migración: Crear tabla de términos y condiciones
-- Fecha: 2026-01-26
-- Descripción: Permite almacenar y gestionar los términos y condiciones del sitio

CREATE TABLE IF NOT EXISTS terms_and_conditions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL DEFAULT 'Términos y Condiciones',
    content TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
    INDEX idx_active (is_active),
    INDEX idx_version (version),
    INDEX idx_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insertar términos y condiciones iniciales (si no existen)
INSERT INTO terms_and_conditions (title, content, version, is_active, created_by)
SELECT 
    'Términos y Condiciones de Uso',
    '## Términos y Condiciones de SyncTrade

### 1. Aceptación de los Términos
Al acceder y utilizar SyncTrade, usted acepta cumplir con estos términos y condiciones de uso.

### 2. Servicios Ofrecidos
SyncTrade proporciona una plataforma de copy trading automatizado que permite a los usuarios seguir estrategias de trading.

### 3. Riesgos del Trading
El trading de criptomonedas y activos financieros conlleva riesgos significativos. Usted reconoce que:
- Puede perder parte o la totalidad de su capital
- Los resultados pasados no garantizan resultados futuros
- El trading con apalancamiento aumenta los riesgos

### 4. Responsabilidades del Usuario
- Es responsable de mantener la seguridad de sus credenciales
- Debe cumplir con todas las leyes y regulaciones aplicables
- No debe utilizar el servicio para actividades ilegales

### 5. Limitación de Responsabilidad
SyncTrade no se hace responsable de las pérdidas financieras resultantes del uso del servicio.

### 6. Modificaciones
Nos reservamos el derecho de modificar estos términos en cualquier momento.',
    1,
    true,
    (SELECT id FROM users WHERE role = 'admin' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM terms_and_conditions WHERE is_active = true);
