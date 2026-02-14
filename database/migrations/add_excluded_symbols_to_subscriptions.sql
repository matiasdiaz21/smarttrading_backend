-- Símbolos que el usuario excluye de copiar por estrategia.
-- Si la estrategia permite [BTCUSDT, ETHUSDT, SOLUSDT] y el usuario tiene [ETHUSDT] aquí,
-- solo se copiarán BTCUSDT y SOLUSDT para ese usuario.

ALTER TABLE user_strategy_subscriptions
ADD COLUMN excluded_symbols JSON NULL
COMMENT 'Símbolos que el usuario no quiere copiar en esta estrategia.'
AFTER position_size;
