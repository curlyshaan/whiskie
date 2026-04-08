-- =====================================================
-- WHISKIE DATABASE RESET SCRIPT
-- =====================================================
-- WARNING: This will DELETE ALL DATA and recreate tables
-- Use with caution - this is irreversible
-- =====================================================

-- Drop all tables in reverse dependency order
DROP TABLE IF EXISTS stock_analysis_history CASCADE;
DROP TABLE IF EXISTS market_trend_patterns CASCADE;
DROP TABLE IF EXISTS learning_insights CASCADE;
DROP TABLE IF EXISTS position_lots CASCADE;
DROP TABLE IF EXISTS earnings_calendar CASCADE;
DROP TABLE IF EXISTS watchlist CASCADE;
DROP TABLE IF EXISTS pending_approvals CASCADE;
DROP TABLE IF EXISTS performance_metrics CASCADE;
DROP TABLE IF EXISTS alerts CASCADE;
DROP TABLE IF EXISTS ai_decisions CASCADE;
DROP TABLE IF EXISTS portfolio_snapshots CASCADE;
DROP TABLE IF EXISTS positions CASCADE;
DROP TABLE IF EXISTS trades CASCADE;
DROP TABLE IF EXISTS stock_universe CASCADE;

-- =====================================================
-- RECREATE ALL TABLES
-- =====================================================

-- Trades table - log every trade executed
CREATE TABLE trades (
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

-- Positions table - current holdings
CREATE TABLE positions (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) UNIQUE NOT NULL,
  quantity INTEGER NOT NULL,
  cost_basis DECIMAL(10, 2) NOT NULL,
  current_price DECIMAL(10, 2),
  sector VARCHAR(50),
  stock_type VARCHAR(30),
  entry_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  trimmed_1 BOOLEAN DEFAULT FALSE,
  trimmed_2 BOOLEAN DEFAULT FALSE,
  trimmed_3 BOOLEAN DEFAULT FALSE,
  stop_loss DECIMAL(10, 2),
  take_profit DECIMAL(10, 2),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Portfolio snapshots - daily portfolio value
CREATE TABLE portfolio_snapshots (
  id SERIAL PRIMARY KEY,
  total_value DECIMAL(12, 2) NOT NULL,
  cash DECIMAL(12, 2) NOT NULL,
  positions_value DECIMAL(12, 2) NOT NULL,
  daily_change DECIMAL(8, 4),
  total_return DECIMAL(8, 4),
  sp500_return DECIMAL(8, 4),
  snapshot_date DATE UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AI decisions - log all AI analysis and reasoning
CREATE TABLE ai_decisions (
  id SERIAL PRIMARY KEY,
  decision_type VARCHAR(50) NOT NULL,
  symbol VARCHAR(10),
  recommendation TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  model_used VARCHAR(50),
  confidence VARCHAR(20),
  executed BOOLEAN DEFAULT FALSE,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  cost_estimate DECIMAL(10, 4),
  duration_seconds INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Alerts - track all alerts sent
CREATE TABLE alerts (
  id SERIAL PRIMARY KEY,
  alert_type VARCHAR(50) NOT NULL,
  symbol VARCHAR(10),
  message TEXT NOT NULL,
  severity VARCHAR(20),
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Performance metrics - track key metrics
CREATE TABLE performance_metrics (
  id SERIAL PRIMARY KEY,
  metric_name VARCHAR(50) NOT NULL,
  metric_value DECIMAL(12, 4) NOT NULL,
  period VARCHAR(20),
  calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pending approvals - track trade recommendations awaiting user approval
CREATE TABLE pending_approvals (
  id SERIAL PRIMARY KEY,
  analysis_id INTEGER REFERENCES ai_decisions(id),
  symbol VARCHAR(10) NOT NULL,
  action VARCHAR(10) NOT NULL,
  quantity INTEGER NOT NULL,
  entry_price DECIMAL(10, 2) NOT NULL,
  stop_loss DECIMAL(10, 2),
  take_profit DECIMAL(10, 2),
  reasoning TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  approved_at TIMESTAMP,
  rejected_at TIMESTAMP
);

-- Watchlist - track stocks to monitor with target entry prices
CREATE TABLE watchlist (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) UNIQUE NOT NULL,
  sub_industry VARCHAR(100),
  current_price DECIMAL(10, 2),
  target_entry_price DECIMAL(10, 2),
  target_exit_price DECIMAL(10, 2),
  why_watching TEXT,
  why_not_buying_now TEXT,
  status VARCHAR(20) DEFAULT 'watching',
  added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_reviewed TIMESTAMP,
  price_when_added DECIMAL(10, 2),
  highest_price DECIMAL(10, 2),
  lowest_price DECIMAL(10, 2)
);

-- Earnings calendar - track earnings dates for all stocks
CREATE TABLE earnings_calendar (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL,
  earnings_date DATE NOT NULL,
  earnings_time VARCHAR(10),
  source VARCHAR(20) DEFAULT 'yahoo',
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(symbol, earnings_date)
);

CREATE INDEX idx_earnings_symbol ON earnings_calendar(symbol);
CREATE INDEX idx_earnings_date ON earnings_calendar(earnings_date);

-- Position lots - track individual lots (long-term vs swing)
CREATE TABLE position_lots (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL,
  lot_type VARCHAR(20) NOT NULL,
  quantity INTEGER NOT NULL,
  cost_basis DECIMAL(10, 2) NOT NULL,
  current_price DECIMAL(10, 2),
  entry_date DATE NOT NULL,
  stop_loss DECIMAL(10, 2),
  take_profit DECIMAL(10, 2),
  oco_order_id VARCHAR(50),
  thesis TEXT,
  trim_level INTEGER DEFAULT 0,
  days_held INTEGER DEFAULT 0,
  days_to_long_term INTEGER,
  trailing_stop_active BOOLEAN DEFAULT FALSE,
  last_reviewed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_position_lots_symbol ON position_lots(symbol);

-- Stock analysis history - track all analyses for trend learning
CREATE TABLE stock_analysis_history (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL,
  analysis_date DATE NOT NULL,
  analysis_type VARCHAR(20) NOT NULL,
  price_at_analysis DECIMAL(10, 2),
  thesis TEXT,
  recommendation VARCHAR(20),
  confidence VARCHAR(20),
  key_factors JSONB,
  outcome VARCHAR(20),
  outcome_notes TEXT,
  days_to_outcome INTEGER,
  price_change_pct DECIMAL(8, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(symbol, analysis_date, analysis_type)
);

CREATE INDEX idx_stock_analysis_symbol ON stock_analysis_history(symbol);
CREATE INDEX idx_stock_analysis_date ON stock_analysis_history(analysis_date);

-- Market trend patterns - track market-level patterns
CREATE TABLE market_trend_patterns (
  id SERIAL PRIMARY KEY,
  pattern_date DATE NOT NULL,
  pattern_type VARCHAR(50) NOT NULL,
  pattern_description TEXT,
  affected_sectors JSONB,
  key_indicators JSONB,
  opus_insight TEXT,
  action_taken TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_market_trends_date ON market_trend_patterns(pattern_date);

-- Learning insights - Opus's meta-learnings
CREATE TABLE learning_insights (
  id SERIAL PRIMARY KEY,
  insight_date DATE NOT NULL,
  insight_type VARCHAR(50) NOT NULL,
  insight_text TEXT NOT NULL,
  confidence VARCHAR(20),
  supporting_evidence JSONB,
  applied BOOLEAN DEFAULT FALSE,
  applied_date DATE,
  effectiveness VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_learning_insights_applied ON learning_insights(applied);

-- Stock universe - tradeable stocks
CREATE TABLE stock_universe (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) UNIQUE NOT NULL,
  company_name VARCHAR(200),
  sector VARCHAR(100),
  sub_industry VARCHAR(100),
  market_cap_category VARCHAR(20),
  is_active BOOLEAN DEFAULT TRUE,
  added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_stock_universe_sector ON stock_universe(sector);
CREATE INDEX idx_stock_universe_sub_industry ON stock_universe(sub_industry);

-- =====================================================
-- RESET COMPLETE
-- =====================================================
-- All tables have been dropped and recreated
-- Database is now in a clean state
-- =====================================================
