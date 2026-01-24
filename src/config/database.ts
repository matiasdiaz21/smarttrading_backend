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
  const missingVars = requiredVars.filter(varName => {
    const value = process.env[varName];
    // Verificar que la variable existe y no está vacía
    return !value || value.trim() === '';
  });

  if (missingVars.length > 0) {
    // Logging detallado para diagnóstico
    console.error('\n❌ ERROR: Variables de entorno de base de datos faltantes o vacías:');
    missingVars.forEach(v => {
      const value = process.env[v];
      console.error(`   - ${v}: ${value ? `vacía (longitud: ${value.length})` : 'no existe'}`);
    });
    
    // Mostrar todas las variables DB_ que existen
    const existingDbVars = Object.keys(process.env).filter(k => k.startsWith('DB_'));
    console.error('\n📋 Variables DB_ encontradas en process.env:');
    if (existingDbVars.length > 0) {
      existingDbVars.forEach(k => {
        const val = process.env[k];
        console.error(`   - ${k}: ${val ? `existe (${val.length} chars)` : 'vacía'}`);
      });
    } else {
      console.error('   - Ninguna variable DB_ encontrada');
    }
    
    console.error('\n⚠️ SOLUCIÓN:');
    console.error('1. Ve a Vercel Dashboard > Tu proyecto > Settings > Environment Variables');
    console.error('2. Verifica que las variables estén configuradas para "Production" (no solo Preview o Development)');
    console.error('3. Asegúrate de que los valores no tengan espacios al inicio o final');
    console.error('4. Haz clic en "Save" después de cada variable');
    console.error('5. Ve a Deployments y haz clic en "Redeploy" en el último deployment');
    console.error('6. Espera a que termine el deployment completamente');
    console.error('\n💡 Tip: Usa el endpoint /api/env-check para ver un diagnóstico detallado\n');
    
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
