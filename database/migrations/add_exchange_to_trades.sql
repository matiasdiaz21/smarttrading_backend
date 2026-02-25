-- Indica en qué exchange se ejecutó el trade. bitget_order_id guarda el orderId del exchange (Bitget o Bybit).
ALTER TABLE trades
  ADD COLUMN exchange VARCHAR(10) NOT NULL DEFAULT 'bitget' AFTER strategy_id;
