-- Add use_partial_tp column to user_strategy_subscriptions
-- When enabled (default: true), orders will use partial take profit:
--   50% TP at breakeven price, 50% TP at final take profit price
-- When disabled, 100% TP at the final take profit price

ALTER TABLE user_strategy_subscriptions
ADD COLUMN use_partial_tp BOOLEAN NOT NULL DEFAULT true;
