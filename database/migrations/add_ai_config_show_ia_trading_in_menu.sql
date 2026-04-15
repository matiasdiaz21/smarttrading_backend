-- Visibilidad de "IA Trading" en el menú lateral del portal (usuarios).
-- Desactivar durante backtesting; la ruta sigue accesible para admins o por URL directa según política del frontend.
ALTER TABLE ai_config
ADD COLUMN show_ia_trading_in_menu TINYINT(1) NOT NULL DEFAULT 1
  COMMENT '1 = mostrar enlace IA Trading en menú usuario'
  AFTER is_enabled;
