-- Identificador lógico del trade (Pine alertData.id / webhook trade_id). Varias filas pueden compartir el mismo valor (una por llamada HTTP).
ALTER TABLE bitget_operation_logs
  ADD COLUMN trade_id VARCHAR(64) NULL DEFAULT NULL COMMENT 'Pine/webhook trade id; not unique per row' AFTER strategy_id,
  ADD KEY idx_trade_id (trade_id),
  ADD KEY idx_user_trade_id (user_id, trade_id);
