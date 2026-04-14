-- Migration: Add pathway-specific exit strategy columns to positions table
-- Date: 2026-04-14

-- Add pathway column (deepValue, highGrowth, inflection, etc.)
ALTER TABLE positions
ADD COLUMN IF NOT EXISTS pathway VARCHAR(50);

-- Add intent column (value_dip, growth, momentum, etc.)
ALTER TABLE positions
ADD COLUMN IF NOT EXISTS intent VARCHAR(50);

-- Add peak_price column for tracking trailing stops
ALTER TABLE positions
ADD COLUMN IF NOT EXISTS peak_price DECIMAL(10, 2);

-- Add trailing_stop_activated flag
ALTER TABLE positions
ADD COLUMN IF NOT EXISTS trailing_stop_activated BOOLEAN DEFAULT FALSE;

-- Add trailing_stop_distance for tracking trail amount
ALTER TABLE positions
ADD COLUMN IF NOT EXISTS trailing_stop_distance DECIMAL(5, 4);

-- Add last_trim_date to track when we last trimmed position
ALTER TABLE positions
ADD COLUMN IF NOT EXISTS last_trim_date TIMESTAMP;

-- Add trim_history to track all trims (JSON array)
ALTER TABLE positions
ADD COLUMN IF NOT EXISTS trim_history JSONB DEFAULT '[]'::jsonb;

-- Create index on pathway for faster queries
CREATE INDEX IF NOT EXISTS idx_positions_pathway ON positions(pathway);

-- Create index on trailing_stop_activated for monitoring queries
CREATE INDEX IF NOT EXISTS idx_positions_trailing_stop ON positions(trailing_stop_activated);

COMMENT ON COLUMN positions.pathway IS 'Investment pathway from Saturday screening (deepValue, highGrowth, etc.)';
COMMENT ON COLUMN positions.intent IS 'Current trade intent (value_dip, growth, momentum, etc.)';
COMMENT ON COLUMN positions.peak_price IS 'Highest price reached for trailing stop calculation';
COMMENT ON COLUMN positions.trailing_stop_activated IS 'Whether trailing stop has been activated';
COMMENT ON COLUMN positions.trailing_stop_distance IS 'Trail distance as decimal (e.g., 0.25 = 25%)';
COMMENT ON COLUMN positions.last_trim_date IS 'Last time position was trimmed';
COMMENT ON COLUMN positions.trim_history IS 'Array of trim events with date, quantity, price, reason';
