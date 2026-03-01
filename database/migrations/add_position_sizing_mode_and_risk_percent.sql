-- Add position_sizing_mode and risk_percent to user_strategy_subscriptions
-- position_sizing_mode: 'fixed_usdt' = current behavior (position_size in USDT), 'risk_percent' = size from % of account balance per trade
-- risk_percent: only used when position_sizing_mode = 'risk_percent' (e.g. 1.00 = 1%)

ALTER TABLE user_strategy_subscriptions
ADD COLUMN position_sizing_mode VARCHAR(20) NOT NULL DEFAULT 'fixed_usdt'
COMMENT 'fixed_usdt or risk_percent'
AFTER position_size;

ALTER TABLE user_strategy_subscriptions
ADD COLUMN risk_percent DECIMAL(5,2) NULL
COMMENT 'Percent of account to risk per trade when position_sizing_mode=risk_percent (e.g. 1.00 = 1%%)'
AFTER position_sizing_mode;
