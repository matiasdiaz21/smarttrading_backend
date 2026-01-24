import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

// Cargar variables de entorno desde .env (solo en desarrollo local)
// En Vercel, las variables se inyectan automáticamente desde Environment Variables
dotenv.config();

// Determinar si estamos en producción (Vercel)
const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL;

// Obtener valores de las variables de entorno
// En desarrollo local: usar valores por defecto si no están configuradas
// En producción (Vercel): las variables DEBEN estar configuradas en Environment Variables
const dbConfig = {
  host: process.env.DB_HOST || (isProduction ? undefined : 'localhost'),
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || (isProduction ? undefined : 'root'),
  password: process.env.DB_PASSWORD || (isProduction ? undefined : ''),
  database: process.env.DB_NAME || (isProduction ? undefined : 'smarttrading'),
};

// Validar que las variables críticas estén configuradas SOLO en producción
if (isProduction) {
  const requiredVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    const errorMessage = `
❌ ERROR: Variables de entorno de base de datos faltantes:
${missingVars.map(v => `   - ${v}`).join('\n')}

⚠️ SOLUCIÓN:
1. Ve a Vercel Dashboard > Tu proyecto > Settings > Environment Variables
2. Agrega las siguientes variables:
${missingVars.map(v => `   - ${v}=tu-valor`).join('\n')}
3. Selecciona "Production", "Preview" y "Development"
4. Haz clic en "Save"
5. Ve a Deployments y haz clic en "Redeploy" en el último deployment

Las variables deben estar en Vercel Environment Variables, NO solo en GitHub Secrets.
    `;
    console.error(errorMessage);
    throw new Error(`Variables de entorno faltantes: ${missingVars.join(', ')}. Ver logs para más detalles.`);
  }
}

// Logging para diagnóstico (sin mostrar contraseña)
console.log('📊 Configuración de Base de Datos:');
console.log(`   Entorno: ${isProduction ? 'Producción (Vercel)' : 'Desarrollo Local'}`);
console.log(`   Host: ${dbConfig.host}`);
console.log(`   Port: ${dbConfig.port}`);
console.log(`   User: ${dbConfig.user}`);
console.log(`   Database: ${dbConfig.database}`);
console.log(`   Password: ${dbConfig.password ? '***configurada***' : '❌ NO configurada'}`);

if (isProduction) {
  console.log('✅ Todas las variables de entorno de base de datos están configuradas');
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
