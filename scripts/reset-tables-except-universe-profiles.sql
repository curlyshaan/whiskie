-- Reset all tables except stock_universe and stock_profiles
-- This gives a fresh start while preserving curated stock data and research

-- Drop tables in correct order (respecting foreign key constraints)
DROP TABLE IF EXISTS pending_approvals CASCADE;
DROP TABLE IF EXISTS trade_approvals CASCADE;
DROP TABLE IF EXISTS position_lots CASCADE;
DROP TABLE IF EXISTS trades CASCADE;
DROP TABLE IF EXISTS positions CASCADE;
DROP TABLE IF EXISTS portfolio_snapshots CASCADE;
DROP TABLE IF EXISTS ai_decisions CASCADE;
DROP TABLE IF EXISTS alerts CASCADE;
DROP TABLE IF EXISTS performance_metrics CASCADE;
DROP TABLE IF EXISTS watchlist CASCADE;
DROP TABLE IF EXISTS value_watchlist CASCADE;
DROP TABLE IF EXISTS quality_watchlist CASCADE;
DROP TABLE IF EXISTS overvalued_watchlist CASCADE;
DROP TABLE IF EXISTS saturday_watchlist CASCADE;
DROP TABLE IF EXISTS earnings_calendar CASCADE;
DROP TABLE IF EXISTS analysis_history CASCADE;
DROP TABLE IF EXISTS sector_rotation_history CASCADE;

-- Keep: stock_universe, stock_profiles
-- These contain curated data and research that should persist

SELECT 'Tables reset complete. Preserved: stock_universe, stock_profiles' as status;
