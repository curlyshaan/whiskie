-- Stock Universe Table
-- Stores all stocks that Whiskie analyzes with metadata

CREATE TABLE IF NOT EXISTS stock_universe (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) UNIQUE NOT NULL,
  sector VARCHAR(100),
  sub_industry VARCHAR(100),
  market_cap_tier VARCHAR(20), -- 'large-cap', 'mid-cap'
  shortable BOOLEAN DEFAULT FALSE, -- ETB status from Tradier
  last_etb_check TIMESTAMP,
  added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  removed_date TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active' -- 'active', 'removed', 'delisted'
);

CREATE INDEX IF NOT EXISTS idx_stock_universe_symbol ON stock_universe(symbol);
CREATE INDEX IF NOT EXISTS idx_stock_universe_sector ON stock_universe(sector);
CREATE INDEX IF NOT EXISTS idx_stock_universe_sub_industry ON stock_universe(sub_industry);
CREATE INDEX IF NOT EXISTS idx_stock_universe_status ON stock_universe(status);
CREATE INDEX IF NOT EXISTS idx_stock_universe_shortable ON stock_universe(shortable);
