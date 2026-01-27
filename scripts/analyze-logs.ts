/**
 * Script para analizar logs de operaciones Bitget
 * Uso: npx ts-node scripts/analyze-logs.ts FETUSDT
 */

import BitgetOperationLogModel from '../src/models/BitgetOperationLog';

async function analyzeLogs(symbol?: string) {
  try {
    console.log(`\n🔍 Analizando logs${symbol ? ` para ${symbol}` : ' (todos los símbolos)'}...\n`);
    
    // Obtener todos los logs (sin filtrar por revisado)
    const allLogs = await BitgetOperationLogModel.getAll(200);
    
    // Filtrar solo errores
    const errorLogs = allLogs.filter(log => 
      !log.success || log.response_status !== 200
    );
    
    // Si se especifica un símbolo, filtrar por él
    const filteredLogs = symbol 
      ? errorLogs.filter(log => log.symbol === symbol)
      : errorLogs;
    
    if (filteredLogs.length === 0) {
      console.log(`✅ No se encontraron errores${symbol ? ` para ${symbol}` : ''}`);
      return;
    }
    
    console.log(`❌ Se encontraron ${filteredLogs.length} errores:\n`);
    
    // Agrupar por símbolo
    const bySymbol: Record<string, typeof filteredLogs> = {};
    filteredLogs.forEach(log => {
      if (!bySymbol[log.symbol]) {
        bySymbol[log.symbol] = [];
      }
      bySymbol[log.symbol].push(log);
    });
    
    // Mostrar resumen por símbolo
    console.log('📊 Resumen por símbolo:');
    Object.keys(bySymbol).sort().forEach(sym => {
      console.log(`  ${sym}: ${bySymbol[sym].length} error(es)`);
    });
    
    console.log('\n📋 Detalles de errores:\n');
    
    // Mostrar detalles de cada error
    filteredLogs.forEach((log, index) => {
      console.log(`${index + 1}. [${log.symbol}] ${log.operation_type}`);
      console.log(`   Fecha: ${new Date(log.created_at).toLocaleString('es-ES')}`);
      console.log(`   Usuario: ${log.user_email}`);
      console.log(`   Estrategia: ${log.strategy_name || 'N/A'}`);
      console.log(`   Estado HTTP: ${log.response_status || 'N/A'}`);
      console.log(`   Success: ${log.success}`);
      console.log(`   Revisado: ${log.is_reviewed ? '✅' : '❌'}`);
      
      if (log.error_message) {
        console.log(`   Error: ${log.error_message}`);
      }
      
      if (log.response_data && log.response_data.msg) {
        console.log(`   Mensaje Bitget: ${log.response_data.msg}`);
        if (log.response_data.code) {
          console.log(`   Código: ${log.response_data.code}`);
        }
      }
      
      console.log(`   Endpoint: ${log.http_method} ${log.endpoint}`);
      console.log('');
    });
    
    // Análisis específico para FET y THETA
    if (symbol === 'FETUSDT' || symbol === 'THETAUSDT' || !symbol) {
      const fetLogs = filteredLogs.filter(log => log.symbol === 'FETUSDT');
      const thetaLogs = filteredLogs.filter(log => log.symbol === 'THETAUSDT');
      
      if (fetLogs.length > 0) {
        console.log('\n🔴 FETUSDT - Análisis detallado:');
        fetLogs.forEach(log => {
          console.log(`\n  Error #${log.id}:`);
          console.log(`    Operación: ${log.operation_type}`);
          console.log(`    Fecha: ${new Date(log.created_at).toLocaleString('es-ES')}`);
          if (log.error_message) {
            console.log(`    Error: ${log.error_message}`);
          }
          if (log.response_data?.msg) {
            console.log(`    Bitget: ${log.response_data.msg}`);
          }
          if (log.request_payload) {
            const payload = log.request_payload;
            if (payload.holdSide) {
              console.log(`    Hold Side: ${payload.holdSide}`);
            }
            if (payload.stopSurplusTriggerPrice) {
              console.log(`    TP Price: ${payload.stopSurplusTriggerPrice}`);
            }
            if (payload.stopLossTriggerPrice) {
              console.log(`    SL Price: ${payload.stopLossTriggerPrice}`);
            }
          }
        });
      }
      
      if (thetaLogs.length > 0) {
        console.log('\n🔴 THETAUSDT - Análisis detallado:');
        thetaLogs.forEach(log => {
          console.log(`\n  Error #${log.id}:`);
          console.log(`    Operación: ${log.operation_type}`);
          console.log(`    Fecha: ${new Date(log.created_at).toLocaleString('es-ES')}`);
          if (log.error_message) {
            console.log(`    Error: ${log.error_message}`);
          }
          if (log.response_data?.msg) {
            console.log(`    Bitget: ${log.response_data.msg}`);
          }
          if (log.request_payload) {
            const payload = log.request_payload;
            if (payload.holdSide) {
              console.log(`    Hold Side: ${payload.holdSide}`);
            }
            if (payload.stopSurplusTriggerPrice) {
              console.log(`    TP Price: ${payload.stopSurplusTriggerPrice}`);
            }
            if (payload.stopLossTriggerPrice) {
              console.log(`    SL Price: ${payload.stopLossTriggerPrice}`);
            }
          }
        });
      }
    }
    
  } catch (error: any) {
    console.error('❌ Error al analizar logs:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Ejecutar el script
const symbol = process.argv[2];
analyzeLogs(symbol).then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
