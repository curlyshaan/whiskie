-- Trend Learning Tables
-- Stores historical analysis and patterns for learning

-- Stock-specific analysis history
CREATE TABLE IF NOT EXISTS stock_analysis_history (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL,
  analysis_date DATE NOT NULL,
  analysis_type VARCHAR(50) NOT NULL, -- 'daily', 'weekly', 'earnings', 'news_event'
  price_at_analysis DECIMAL(10, 2),
  thesis TEXT,
  recommendation VARCHAR(20), -- 'buy', 'sell', 'hold', 'watch'
  confidence VARCHAR(20), -- 'high', 'medium', 'low'
  key_factors JSONB, -- Array of factors that drove the decision
  outcome VARCHAR(20), -- 'correct', 'incorrect', 'pending', 'partial'
  outcome_notes TEXT,
  days_to_outcome INTEGER,
  price_change_pct DECIMAL(8, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(symbol, analysis_date, analysis_type)
);

CREATE INDEX IF NOT EXISTS idx_stock_analysis_symbol ON stock_analysis_history(symbol);
CREATE INDEX IF NOT EXISTS idx_stock_analysis_date ON stock_analysis_history(analysis_date);
CREATE INDEX IF NOT EXISTS idx_stock_analysis_outcome ON stock_analysis_history(outcome);

-- Market-level trend patterns
CREATE TABLE IF NOT EXISTS market_trend_patterns (
  id SERIAL PRIMARY KEY,
  pattern_date DATE NOT NULL,
  pattern_type VARCHAR(50) NOT NULL, -- 'sector_rotation', 'volatility_regime', 'correlation_shift'
  pattern_description TEXT,
  affected_sectors JSONB, -- Array of sectors
  key_indicators JSONB, -- VIX, sector ETF performance, etc.
  opus_insight TEXT, -- What Opus learned from this pattern
  action_taken TEXT, -- What we did in response
  outcome VARCHAR(20), -- 'successful', 'unsuccessful', 'pending'
  outcome_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_market_trend_date ON market_trend_patterns(pattern_date);
CREATE INDEX IF NOT EXISTS idx_market_trend_type ON market_trend_patterns(pattern_type);

-- Learning insights (Opus's meta-learnings)
CREATE TABLE IF NOT EXISTS learning_insights (
  id SERIAL PRIMARY KEY,
  insight_date DATE NOT NULL,
  insight_type VARCHAR(50) NOT NULL, -- 'stock_pattern', 'market_pattern', 'strategy_adjustment'
  insight_text TEXT NOT NULL,
  confidence VARCHAR(20), -- 'high', 'medium', 'low'
  supporting_evidence JSONB, -- References to stock_analysis_history or market_trend_patterns
  applied BOOLEAN DEFAULT FALSE,
  applied_date DATE,
  effectiveness VARCHAR(20), -- 'effective', 'ineffective', 'pending'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_learning_insights_date ON learning_insights(insight_date);
CREATE INDEX IF NOT EXISTS idx_learning_insights_type ON learning_insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_learning_insights_applied ON learning_insights(applied);
