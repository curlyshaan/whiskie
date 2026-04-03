-- Migration: Add earnings_calendar table
-- Run this to add earnings tracking to existing database

-- Create earnings_calendar table
CREATE TABLE IF NOT EXISTS earnings_calendar (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL,
  earnings_date DATE NOT NULL,
  earnings_time VARCHAR(10),
  source VARCHAR(20) DEFAULT 'yahoo',
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(symbol, earnings_date)
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_earnings_symbol ON earnings_calendar(symbol);
CREATE INDEX IF NOT EXISTS idx_earnings_date ON earnings_calendar(earnings_date);

-- Verify table was created
SELECT 'earnings_calendar table created successfully' AS status;
