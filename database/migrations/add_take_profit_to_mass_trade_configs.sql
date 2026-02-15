-- Agregar take_profit_percent global a mass_trade_configs
ALTER TABLE mass_trade_configs
  ADD COLUMN take_profit_percent DECIMAL(5,2) DEFAULT NULL AFTER stop_loss_percent;
