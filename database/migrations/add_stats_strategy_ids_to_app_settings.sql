-- Add stats_strategy_ids column to app_settings
-- This stores a JSON array of strategy IDs used to calculate public landing page stats (winrate, operations)
ALTER TABLE app_settings ADD COLUMN stats_strategy_ids JSON DEFAULT NULL;
