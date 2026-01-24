import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

// Cargar variables de entorno desde .env (solo en desarrollo local)
// En Vercel, las variables se inyectan automáticamente desde Environment Variables
dotenv.config();

// Validar que las variables críticas estén configuradas en producción
if (process.env.NODE_ENV === 'production') {
  const requiredVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Variables de entorno faltantes en producción:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    console.error('⚠️ Configura estas variables en Vercel Dashboard > Settings > Environment Variables');
  }
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'smarttrading',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

export default pool;

