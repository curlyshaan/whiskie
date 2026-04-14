-- Migration: Add Opus-recommended stock profile improvements
-- Date: 2026-04-14

-- Add new essential fields
ALTER TABLE stock_profiles
ADD COLUMN IF NOT EXISTS industry_sector VARCHAR(100),
ADD COLUMN IF NOT EXISTS market_cap_category VARCHAR(20),
ADD COLUMN IF NOT EXISTS growth_stage VARCHAR(30),
ADD COLUMN IF NOT EXISTS management_quality VARCHAR(800),
ADD COLUMN IF NOT EXISTS valuation_framework VARCHAR(1000),
ADD COLUMN IF NOT EXISTS competitive_landscape VARCHAR(1000),
ADD COLUMN IF NOT EXISTS key_metrics_to_watch JSONB,
ADD COLUMN IF NOT EXISTS last_earnings_date DATE,
ADD COLUMN IF NOT EXISTS next_earnings_date DATE,
ADD COLUMN IF NOT EXISTS insider_ownership_pct NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS institutional_ownership_pct NUMERIC(5,2);

-- Add NOT NULL constraints to critical fields
ALTER TABLE stock_profiles
ALTER COLUMN business_model SET NOT NULL,
ALTER COLUMN moats SET NOT NULL,
ALTER COLUMN risks SET NOT NULL;

-- Add CHECK constraints for character limits (guidance for Opus)
ALTER TABLE stock_profiles
ADD CONSTRAINT check_business_model_length CHECK (LENGTH(business_model) <= 1500),
ADD CONSTRAINT check_moats_length CHECK (LENGTH(moats) <= 1200),
ADD CONSTRAINT check_competitive_advantages_length CHECK (LENGTH(competitive_advantages) <= 1000),
ADD CONSTRAINT check_risks_length CHECK (LENGTH(risks) <= 1500),
ADD CONSTRAINT check_catalysts_length CHECK (LENGTH(catalysts) <= 1200),
ADD CONSTRAINT check_management_quality_length CHECK (LENGTH(management_quality) <= 800),
ADD CONSTRAINT check_valuation_framework_length CHECK (LENGTH(valuation_framework) <= 1000),
ADD CONSTRAINT check_competitive_landscape_length CHECK (LENGTH(competitive_landscape) <= 1000);

-- Create enum-like constraints for categorical fields
ALTER TABLE stock_profiles
ADD CONSTRAINT check_market_cap_category CHECK (
  market_cap_category IN ('mega', 'large', 'mid', 'small')
),
ADD CONSTRAINT check_growth_stage CHECK (
  growth_stage IN ('hyper_growth', 'growth', 'mature', 'turnaround', 'declining')
);

-- Create indexes for new fields
CREATE INDEX IF NOT EXISTS idx_stock_profiles_industry_sector ON stock_profiles(industry_sector);
CREATE INDEX IF NOT EXISTS idx_stock_profiles_market_cap_category ON stock_profiles(market_cap_category);
CREATE INDEX IF NOT EXISTS idx_stock_profiles_growth_stage ON stock_profiles(growth_stage);
CREATE INDEX IF NOT EXISTS idx_stock_profiles_next_earnings ON stock_profiles(next_earnings_date);

-- Add comments for documentation
COMMENT ON COLUMN stock_profiles.industry_sector IS 'Standard taxonomy (e.g., Technology - Software, Healthcare - Biotech)';
COMMENT ON COLUMN stock_profiles.market_cap_category IS 'Size classification: mega (>200B), large (10-200B), mid (2-10B), small (<2B)';
COMMENT ON COLUMN stock_profiles.growth_stage IS 'Lifecycle stage: hyper_growth, growth, mature, turnaround, declining';
COMMENT ON COLUMN stock_profiles.management_quality IS 'Capital allocation track record, insider ownership, execution history (400-600 chars)';
COMMENT ON COLUMN stock_profiles.valuation_framework IS 'Primary valuation method, key multiples, normalized earnings (500-800 chars)';
COMMENT ON COLUMN stock_profiles.competitive_landscape IS 'Market share, top competitors, pricing dynamics (500-800 chars)';
COMMENT ON COLUMN stock_profiles.key_metrics_to_watch IS 'Stock-specific KPIs with thresholds: {"primary": ["revenue_growth"], "thresholds": {"revenue_growth": {"concern": 0.15, "target": 0.25}}}';
COMMENT ON COLUMN stock_profiles.last_earnings_date IS 'Most recent earnings report date';
COMMENT ON COLUMN stock_profiles.next_earnings_date IS 'Expected next earnings date';
COMMENT ON COLUMN stock_profiles.insider_ownership_pct IS 'Percentage of shares held by insiders';
COMMENT ON COLUMN stock_profiles.institutional_ownership_pct IS 'Percentage held by institutions';
