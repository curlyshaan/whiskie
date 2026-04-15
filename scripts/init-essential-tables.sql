-- Initialize essential tables after reset
-- Preserves: stock_universe, stock_profiles
-- Creates: earnings_calendar, etf_watchlist, saturday_watchlist, and other core tables

-- Earnings calendar - track earnings dates for all stocks
CREATE TABLE IF NOT EXISTS earnings_calendar (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL,
  earnings_date DATE NOT NULL,
  earnings_time VARCHAR(10),
  source VARCHAR(20) DEFAULT 'yahoo',
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(symbol, earnings_date)
);

CREATE INDEX IF NOT EXISTS idx_earnings_symbol ON earnings_calendar(symbol);
CREATE INDEX IF NOT EXISTS idx_earnings_date ON earnings_calendar(earnings_date);

-- ETF watchlist - track ETFs separately from stock screening
CREATE TABLE IF NOT EXISTS etf_watchlist (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) UNIQUE NOT NULL,
  name VARCHAR(100),
  category VARCHAR(50),
  aum DECIMAL(15, 2),
  expense_ratio DECIMAL(5, 4),
  why_watching TEXT,
  status VARCHAR(20) DEFAULT 'watching',
  added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_reviewed TIMESTAMP
);

-- Saturday watchlist - fundamental screening results
CREATE TABLE IF NOT EXISTS saturday_watchlist (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL,
  intent VARCHAR(10) NOT NULL,
  pathway VARCHAR(30) NOT NULL,
  sector VARCHAR(50),
  industry VARCHAR(100),
  score INTEGER NOT NULL,
  metrics JSONB,
  reasons TEXT,
  price DECIMAL(10, 2),
  status VARCHAR(20) DEFAULT 'pending',
  added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_date TIMESTAMP,
  UNIQUE(symbol, pathway)
);

CREATE INDEX IF NOT EXISTS idx_saturday_watchlist_status ON saturday_watchlist(status);
CREATE INDEX IF NOT EXISTS idx_saturday_watchlist_intent ON saturday_watchlist(intent);
CREATE INDEX IF NOT EXISTS idx_saturday_watchlist_pathway ON saturday_watchlist(pathway);

-- Trade approvals - human-in-the-loop trade execution
CREATE TABLE IF NOT EXISTS trade_approvals (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL,
  intent VARCHAR(10) NOT NULL,
  quantity INTEGER NOT NULL,
  entry_price DECIMAL(10, 2) NOT NULL,
  stop_loss DECIMAL(10, 2),
  take_profit DECIMAL(10, 2),
  reasoning TEXT,
  pathway VARCHAR(30),
  score INTEGER,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  approved_at TIMESTAMP,
  rejected_at TIMESTAMP,
  rejection_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_trade_approvals_status ON trade_approvals(status);
CREATE INDEX IF NOT EXISTS idx_trade_approvals_symbol ON trade_approvals(symbol);

-- Trades - execution history
CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL,
  action VARCHAR(10) NOT NULL,
  quantity INTEGER NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  total_value DECIMAL(12, 2) NOT NULL,
  order_id VARCHAR(50),
  status VARCHAR(20) NOT NULL,
  reasoning TEXT,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Positions - current holdings
CREATE TABLE IF NOT EXISTS positions (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) UNIQUE NOT NULL,
  quantity INTEGER NOT NULL,
  cost_basis DECIMAL(10, 2) NOT NULL,
  current_price DECIMAL(10, 2),
  sector VARCHAR(50),
  stock_type VARCHAR(30),
  position_type VARCHAR(10) DEFAULT 'long',
  entry_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  stop_loss DECIMAL(10, 2),
  take_profit DECIMAL(10, 2),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Portfolio snapshots - daily portfolio value
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id SERIAL PRIMARY KEY,
  total_value DECIMAL(12, 2) NOT NULL,
  cash DECIMAL(12, 2) NOT NULL,
  positions_value DECIMAL(12, 2) NOT NULL,
  daily_change DECIMAL(8, 4),
  total_return DECIMAL(8, 4),
  snapshot_date DATE UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AI decisions - log all AI analysis
CREATE TABLE IF NOT EXISTS ai_decisions (
  id SERIAL PRIMARY KEY,
  decision_type VARCHAR(50) NOT NULL,
  symbol VARCHAR(10),
  recommendation TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  model_used VARCHAR(50),
  confidence VARCHAR(20),
  executed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Alerts - track all alerts sent
CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  alert_type VARCHAR(50) NOT NULL,
  symbol VARCHAR(10),
  message TEXT NOT NULL,
  severity VARCHAR(20),
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

SELECT 'Essential tables initialized successfully' as status;
