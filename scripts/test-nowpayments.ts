/**
 * Script para validar la conexión con NOWPayments
 * 
 * Uso:
 *   tsx scripts/test-nowpayments.ts
 * 
 * Este script:
 * - Carga las credenciales de la base de datos
 * - Prueba la conexión con NOWPayments
 * - Valida que la API key sea correcta
 * - Muestra información útil para depurar
 */

import dotenv from 'dotenv';
import axios from 'axios';
import { NOWPaymentsCredentialsModel } from '../src/models/NOWPaymentsCredentials';
import { config } from '../src/config';

dotenv.config();

async function testNOWPaymentsConnection() {
  console.log('🔍 Validando conexión con NOWPayments...\n');

  // 1. Cargar credenciales de la base de datos
  console.log('📋 Paso 1: Cargando credenciales desde la base de datos...');
  let email = '';
  let password = '';
  let apiUrl = 'https://api.nowpayments.io/v1';
  let source = '';

  try {
    const credentials = await NOWPaymentsCredentialsModel.findActive();
    if (credentials && credentials.email && credentials.password) {
      email = credentials.email;
      password = credentials.password;
      apiUrl = credentials.api_url || 'https://api.nowpayments.io/v1';
      source = 'Base de datos';
      console.log('✓ Credenciales cargadas desde la base de datos');
      console.log(`   API URL: ${apiUrl}`);
      console.log(`   Email: ${email}`);
      console.log(`   Password: ${'*'.repeat(password.length)}\n`);
    } else {
      throw new Error('No hay credenciales activas en la base de datos');
    }
  } catch (error: any) {
    console.log('⚠️  No se pudieron cargar credenciales de BD:', error.message);
    console.error('❌ ERROR: Se requieren email y password configurados en la base de datos');
    console.error('   Por favor configura las credenciales en el panel de administración\n');
    process.exit(1);
  }

  // 2. Autenticarse con NOWPayments para obtener el token
  console.log('📋 Paso 2: Autenticándose con NOWPayments...');
  let token = '';
  try {
    const authUrl = `${apiUrl}/auth`;
    console.log(`   URL: ${authUrl}`);
    console.log(`   Método: POST`);
    console.log(`   Email: ${email}\n`);

    const authData = {
      email: email.trim(),
      password: password.trim(),
    };

    console.log(`   Body:`, JSON.stringify({ ...authData, password: '***' }, null, 2));

    const response = await axios.post(
      authUrl,
      authData, // Axios automáticamente serializa a JSON
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    token = response.data.token || response.data.access_token || response.data.accessToken;
    if (!token) {
      throw new Error('No se recibió token en la respuesta de autenticación');
    }

    console.log('✅ Autenticación exitosa con NOWPayments!');
    console.log(`   Status Code: ${response.status}`);
    console.log(`   Token obtenido: ${token.substring(0, 20)}...`);
    console.log(`   Token (longitud): ${token.length} caracteres\n`);
  } catch (error: any) {
    console.error('❌ ERROR al autenticarse con NOWPayments:');
    if (error.response) {
      console.error(`   Status Code: ${error.response.status}`);
      console.error(`   Response:`, JSON.stringify(error.response.data, null, 2));
      
      if (error.response.status === 401 || error.response.status === 403) {
        console.error('\n⚠️  Las credenciales parecen ser inválidas');
        console.error('   Verifica que:');
        console.error('   1. El email y password sean correctos');
        console.error('   2. La cuenta de NOWPayments esté activa');
        console.error('   3. El wallet de payout esté configurado');
      }
    } else if (error.request) {
      console.error('   No se recibió respuesta del servidor');
      console.error('   Verifica tu conexión a internet y que la URL sea correcta');
    } else {
      console.error(`   Error: ${error.message}`);
    }
    process.exit(1);
  }

  // 3. Probar endpoint de status de la API
  console.log('📋 Paso 3: Probando conexión con NOWPayments API...');
  try {
    const statusUrl = `${apiUrl}/status`;
    console.log(`   URL: ${statusUrl}`);
    console.log(`   Método: GET`);
    console.log(`   Autenticación: Bearer token\n`);

    const response = await axios.get(statusUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    console.log('✅ Conexión exitosa con NOWPayments API!');
    console.log(`   Status Code: ${response.status}`);
    console.log(`   Response:`, JSON.stringify(response.data, null, 2));
    console.log('\n✓ El token es válido y la conexión funciona correctamente\n');
  } catch (error: any) {
    console.error('❌ ERROR al conectar con NOWPayments API:');
    if (error.response) {
      console.error(`   Status Code: ${error.response.status}`);
      console.error(`   Response:`, JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(`   Error: ${error.message}`);
    }
    process.exit(1);
  }

  // 4. Probar crear un invoice de prueba con token
  console.log('📋 Paso 4: Probando creación de invoice de prueba...');
  try {
    const invoiceUrl = `${apiUrl}/invoice`;
    const testInvoiceData = {
      price_amount: 1,
      price_currency: 'usd',
      pay_currency: 'usdt',
      order_id: `TEST_${Date.now()}`,
      order_description: 'Test invoice',
    };

    console.log(`   URL: ${invoiceUrl}`);
    console.log(`   Método: POST`);
    console.log(`   Body:`, JSON.stringify(testInvoiceData, null, 2));
    console.log(`   Autenticación: Bearer token\n`);

    const invoiceResponse = await axios.post(invoiceUrl, testInvoiceData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    console.log('✅ Invoice de prueba creado exitosamente!');
    console.log(`   Invoice ID: ${invoiceResponse.data.invoice_id}`);
    console.log(`   Status: ${invoiceResponse.data.status}`);
    console.log(`   Invoice URL: ${invoiceResponse.data.invoice_url || 'N/A'}`);
    console.log('\n✓ La API key tiene permisos para crear invoices\n');
    
    // Probar el widget con este invoice_id
    console.log('📋 Paso 6: Información del widget embebido...');
    console.log(`   Widget URL: https://nowpayments.io/embeds/payment-widget?iid=${invoiceResponse.data.invoice_id}`);
    console.log(`   Iframe code:`);
    console.log(`   <iframe src="https://nowpayments.io/embeds/payment-widget?iid=${invoiceResponse.data.invoice_id}" width="410" height="696" frameborder="0" scrolling="no" style="overflow-y: hidden;"></iframe>\n`);
  } catch (error: any) {
    console.error('❌ ERROR al crear invoice de prueba:');
    if (error.response) {
      console.error(`   Status Code: ${error.response.status}`);
      console.error(`   Response:`, JSON.stringify(error.response.data, null, 2));
      
      if (error.response.status === 403 || error.response.data?.code === 'INVALID_API_KEY') {
        console.error('\n⚠️  PROBLEMA DETECTADO: API key inválida para crear invoices');
        console.error('   Análisis:');
        console.error(`   - El token funciona para /status (Paso 3: ✅)`);
        console.error(`   - El token NO funciona para /invoice (Paso 4: ❌)`);
        console.error('\n   Esto indica que:');
        console.error('   1. La autenticación es exitosa (token válido)');
        console.error('   2. PERO la cuenta no tiene permisos para crear invoices');
        console.error('   3. O la cuenta de NOWPayments necesita configuración adicional');
        console.error('\n   Soluciones según la documentación de NOWPayments:');
        console.error('   1. Verifica en el dashboard de NOWPayments que:');
        console.error('      - Tu cuenta esté completamente verificada');
        console.error('      - Tu wallet de payout esté configurado');
        console.error('      - La cuenta tenga permisos para crear invoices');
        console.error('   2. Si no puedes configurar permisos en el dashboard:');
        console.error('      - Contacta a soporte de NOWPayments');
        console.error('      - Verifica que tu cuenta esté en modo "Production" y no "Sandbox"');
        console.error('\n   ⚠️  REQUISITO CRÍTICO SEGÚN LA DOCUMENTACIÓN:');
        console.error('   Según https://documenter.getpostman.com/view/7907941/2s93JusNJt#authentication');
        console.error('   Para usar la API de NOWPayments necesitas:');
        console.error('   1. ✅ Sign up at nowpayments.io (COMPLETADO)');
        console.error('   2. ❌ Specify your payout wallet (¡ESTO FALTA!)');
        console.error('   3. ✅ Autenticación con email/password (COMPLETADO)');
        console.error('\n   El wallet de payout es OBLIGATORIO antes de crear invoices/payments.');
        console.error('   Sin él, no se pueden procesar transacciones.\n');
        console.error('   Referencia: https://documenter.getpostman.com/view/7907941/2s93JusNJt\n');
      }
    } else {
      console.error(`   Error: ${error.message}`);
    }
  }

  // 6. Resumen
  console.log('═══════════════════════════════════════════════════════');
  console.log('📊 RESUMEN DE VALIDACIÓN');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`✓ Fuente de credenciales: ${source}`);
  console.log(`✓ API URL: ${apiUrl}`);
  console.log(`✓ Email: ${email}`);
  console.log(`✓ Token obtenido: ✅ Exitoso`);
  console.log(`✓ Conexión con API (/status): ✅ Exitosa`);
  console.log(`✓ Creación de Invoice: ${'Ver resultado arriba'}`);
  console.log('\n📝 NOTA IMPORTANTE:');
  console.log('   Según la documentación de NOWPayments:');
  console.log('   - La autenticación se hace con email/password en /auth');
  console.log('   - El token obtenido se usa en el header Authorization: Bearer {token}');
  console.log('   - El widget embebido usa: iid=invoice_id');
  console.log('   - Si /status funciona pero /invoice no, es un problema de permisos');
  console.log('   - Verifica en el dashboard de NOWPayments que el wallet de payout esté configurado');
  console.log('═══════════════════════════════════════════════════════\n');
}

// Ejecutar el script
testNOWPaymentsConnection()
  .then(() => {
    console.log('✅ Validación completada');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  });

