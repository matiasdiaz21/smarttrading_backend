# Configuración de NOWPayments - Requisitos

## Requisitos según la documentación oficial

Según la [documentación de autenticación de NOWPayments](https://documenter.getpostman.com/view/7907941/2s93JusNJt#authentication), para usar la API necesitas completar estos pasos **EN ORDEN**:

### 1. Registrarse en NOWPayments
- Crear cuenta en [nowpayments.io](https://nowpayments.io)

### 2. ⚠️ **ESPECIFICAR EL WALLET DE PAYOUT** (CRÍTICO)
- **Este es el paso que probablemente falta**
- Debes configurar tu wallet de payout en el dashboard de NOWPayments
- Sin esto, la API key no podrá crear invoices o payments
- El endpoint `/status` funciona porque solo requiere API key válida
- Los endpoints `/invoice` y `/payment` requieren wallet de payout configurado

### 3. Generar API Key
- Generar la API key en el dashboard
- Guardarla de forma segura (solo se muestra una vez)

### 4. Generar IPN Secret Key (Public Key)
- Generar el IPN Secret Key en Payment Settings
- Este es el "Public Key" que usamos para verificar webhooks
- También solo se muestra una vez al crearlo

## Por qué falla la creación de invoices

El error `403 Invalid api key` al crear invoices ocurre porque:

1. ✅ La API key es válida (funciona para `/status`)
2. ✅ El formato es correcto
3. ❌ **FALTA: El wallet de payout no está configurado**

## Solución

1. **Accede al dashboard de NOWPayments**
2. **Ve a la sección de "Payout Wallet" o "Wallet Settings"**
3. **Configura tu wallet de payout** (dirección donde recibirás los pagos)
4. **Verifica que el wallet esté activo y verificado**
5. **Vuelve a probar la creación de invoices**

## Verificación

Una vez configurado el wallet, ejecuta el script de test:

```bash
npm run test:nowpayments
```

Deberías ver:
- ✅ Paso 3: Conexión exitosa con `/status`
- ✅ Paso 5: Invoice creado exitosamente

## Referencias

- [Documentación de Autenticación](https://documenter.getpostman.com/view/7907941/2s93JusNJt#authentication)
- [Documentación de IPN](https://documenter.getpostman.com/view/7907941/2s93JusNJt#74c91a83-da39-4e39-b3db-1ed4c5c233f8)

