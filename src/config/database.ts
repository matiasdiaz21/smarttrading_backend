import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

// Cargar variables de entorno desde .env (solo en desarrollo local)
// En Vercel, las variables se inyectan automáticamente desde Environment Variables
dotenv.config();

// Obtener valores de las variables de entorno
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'smarttrading',
};

// Logging para diagnóstico (sin mostrar contraseña)
console.log('📊 Configuración de Base de Datos:');
console.log(`   Host: ${dbConfig.host}`);
console.log(`   Port: ${dbConfig.port}`);
console.log(`   User: ${dbConfig.user}`);
console.log(`   Database: ${dbConfig.database}`);
console.log(`   Password: ${dbConfig.password ? '***configurada***' : '❌ NO configurada'}`);

// Validar que las variables críticas estén configuradas en producción
if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
  const requiredVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Variables de entorno faltantes:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    console.error('⚠️ Configura estas variables en Vercel Dashboard > Settings > Environment Variables');
    console.error('⚠️ Después de configurar, haz clic en "Redeploy" en el último deployment');
  } else {
    console.log('✅ Todas las variables de entorno de base de datos están configuradas');
  }
}

const pool = mysql.createPool({
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

export default pool;

