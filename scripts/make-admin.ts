/**
 * Script para actualizar el rol de un usuario a administrador
 * 
 * Uso:
 *   tsx scripts/make-admin.ts <email>
 * 
 * Ejemplo:
 *   tsx scripts/make-admin.ts admin@example.com
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function makeAdmin(email: string) {
  let connection;

  try {
    // Conectar a la base de datos
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'smarttrading',
    });

    console.log(`🔍 Buscando usuario: ${email}...`);

    // Verificar si el usuario existe
    const [users] = await connection.execute(
      'SELECT id, email, role FROM users WHERE email = ?',
      [email]
    ) as any[];

    if (users.length === 0) {
      console.error(`❌ Usuario con email "${email}" no encontrado.`);
      process.exit(1);
    }

    const user = users[0];
    console.log(`📋 Usuario encontrado:`);
    console.log(`   ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Rol actual: ${user.role}`);

    if (user.role === 'admin') {
      console.log(`✅ El usuario ya es administrador.`);
      process.exit(0);
    }

    // Actualizar el rol a admin
    await connection.execute(
      'UPDATE users SET role = ? WHERE email = ?',
      ['admin', email]
    );

    console.log(`✅ Usuario actualizado a administrador exitosamente.`);
    console.log(`\n⚠️  IMPORTANTE: El usuario debe cerrar sesión y volver a iniciar sesión para que los cambios surtan efecto.`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Obtener el email de los argumentos de línea de comandos
const email = process.argv[2];

if (!email) {
  console.error('❌ Error: Debes proporcionar un email.');
  console.log('\nUso: tsx scripts/make-admin.ts <email>');
  console.log('Ejemplo: tsx scripts/make-admin.ts admin@example.com');
  process.exit(1);
}

makeAdmin(email);

