-- Migration: Add position_lots table and update positions table
-- Run this to add lot-based position tracking

-- Create position_lots table
CREATE TABLE IF NOT EXISTS position_lots (
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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_position_lots_symbol ON position_lots(symbol);
CREATE INDEX IF NOT EXISTS idx_position_lots_type ON position_lots(lot_type);

-- Update positions table with new columns
ALTER TABLE positions
ADD COLUMN IF NOT EXISTS investment_type VARCHAR(20),
ADD COLUMN IF NOT EXISTS total_lots INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS long_term_lots INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS swing_lots INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS thesis TEXT,
ADD COLUMN IF NOT EXISTS days_to_long_term INTEGER,
ADD COLUMN IF NOT EXISTS next_earnings_date DATE,
ADD COLUMN IF NOT EXISTS trim_history JSONB;

-- Verify tables were created
SELECT 'position_lots table created successfully' AS status;
SELECT 'positions table updated successfully' AS status;
