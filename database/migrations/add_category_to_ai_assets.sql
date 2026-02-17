ALTER TABLE ai_assets
ADD COLUMN category ENUM('crypto', 'forex', 'commodities') NOT NULL DEFAULT 'crypto' AFTER product_type;

-- Update existing assets based on symbol patterns (one-time migration)
UPDATE ai_assets SET category = 'commodities' WHERE symbol REGEXP '^(XAU|XAG|WTI|BRENT|OIL|COPPER|NATURALGAS)';
UPDATE ai_assets SET category = 'forex' WHERE symbol REGEXP '^(EUR|GBP|USD|JPY|CHF|AUD|NZD|CAD)(USD|EUR|GBP|JPY|CHF|AUD|NZD|CAD)$';
