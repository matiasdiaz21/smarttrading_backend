# Guía de Configuración Inicial

## Requisitos Previos

- Node.js 20+
- MySQL 8.0+
- Cuenta en Bitget (para obtener API credentials)
- Cuenta en NOWPayments (para procesar pagos)
- Cuentas en Vercel y GitHub

## Instalación Backend

1. Navega al directorio del backend:
```bash
cd smarttrading_backend
```

2. Instala las dependencias:
```bash
npm install
```

3. Copia el archivo de ejemplo de variables de entorno:
```bash
cp .env.example .env
```

4. Configura las variables de entorno en `.env`:
   - Configuración de base de datos MySQL
   - JWT_SECRET (genera uno seguro)
   - ENCRYPTION_KEY (32 caracteres)
   - BITGET_API_BASE_URL (opcional, por defecto: https://api.bitget.com)

**Nota:** Las credenciales de NOWPayments se configuran desde el panel de administración después de crear el usuario admin, no desde variables de entorno.

5. Crea la base de datos y ejecuta el schema:
```bash
mysql -u root -p < database/schema.sql
```

6. Crea un usuario admin (ver DEPLOYMENT.md)

7. Para desarrollo local:
```bash
npm run dev
```

## Instalación Frontend

1. Navega al directorio del frontend:
```bash
cd smarttrading_frontend
```

2. Instala las dependencias:
```bash
npm install
```

3. Copia el archivo de ejemplo:
```bash
cp .env.example .env.local
```

4. Configura `NEXT_PUBLIC_API_URL` apuntando a tu backend

5. Para desarrollo local:
```bash
npm run dev
```

## Próximos Pasos

1. Configura los repositorios en GitHub
2. Conecta los repositorios a Vercel
3. Configura las variables de entorno en Vercel (ver DEPLOYMENT.md)
4. Configura GitHub Actions secrets
5. Crea estrategias desde el panel de admin (`/admin/strategies`)
6. Configura credenciales de NOWPayments desde el panel de admin (`/admin/nowpayments-credentials`)
7. Configura credenciales de Bitget para cada usuario desde `/credentials`
8. Configura webhooks de TradingView (ver DEPLOYMENT.md)
9. Los usuarios deben suscribirse a estrategias desde `/strategies` y activar la copia de trades

