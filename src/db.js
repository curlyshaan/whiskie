import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

/**
 * Database connection pool
 */
const DATABASE_CONNECT_TIMEOUT_MS = Number(process.env.DB_CONNECTION_TIMEOUT_MS || 15000);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // Maximum number of connections in pool
  idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
  connectionTimeoutMillis: DATABASE_CONNECT_TIMEOUT_MS,
});

// Handle unexpected pool errors
pool.on('error', (err) => {
  console.error('💥 Unexpected database pool error:', err);
  // Note: email import would create circular dependency, so just log
});

/**
 * Initialize database schema
 */
export async function initDatabase() {
  console.log(`📊 Initializing database schema... (timeout ${DATABASE_CONNECT_TIMEOUT_MS}ms)`);
  const client = await pool.connect();

  try {

    // Trades table - log every trade executed
    await client.query(`
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
    `);

    // Positions table - current holdings (supports long and short)
    await client.query(`
      CREATE TABLE IF NOT EXISTS positions (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) UNIQUE NOT NULL,
        quantity INTEGER NOT NULL,
        cost_basis DECIMAL(10, 2) NOT NULL,
        current_price DECIMAL(10, 2),
        sector VARCHAR(50),
        industry VARCHAR(100),
        stock_type VARCHAR(30),
        position_type VARCHAR(10) DEFAULT 'long',
        entry_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        trimmed_1 BOOLEAN DEFAULT FALSE,
        trimmed_2 BOOLEAN DEFAULT FALSE,
        trimmed_3 BOOLEAN DEFAULT FALSE,
        stop_loss DECIMAL(10, 2),
        take_profit DECIMAL(10, 2),
        pathway VARCHAR(50),
        intent VARCHAR(50),
        peak_price DECIMAL(10, 2),
        trailing_stop_activated BOOLEAN DEFAULT FALSE,
        trailing_stop_distance DECIMAL(8, 4),
        strategy_type VARCHAR(50),
        thesis_state VARCHAR(20),
        holding_posture VARCHAR(30),
        holding_period VARCHAR(50),
        confidence VARCHAR(20),
        growth_potential VARCHAR(50),
        stop_type VARCHAR(20),
        stop_reason TEXT,
        target_type VARCHAR(20),
        has_fixed_target BOOLEAN,
        trailing_stop_pct DECIMAL(5, 2),
        rebalance_threshold_pct DECIMAL(5, 2),
        max_holding_days INTEGER,
        fundamental_stop_conditions JSONB,
        catalysts JSONB,
        news_links JSONB,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Portfolio snapshots - daily portfolio value
    await client.query(`
      CREATE TABLE IF NOT EXISTS portfolio_snapshots (
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
    `);

    // AI decisions - log all AI analysis and reasoning
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_decisions (
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
    `);

    await client.query(`
      ALTER TABLE ai_decisions
      ADD COLUMN IF NOT EXISTS run_id VARCHAR(64),
      ADD COLUMN IF NOT EXISTS workflow_type VARCHAR(50),
      ADD COLUMN IF NOT EXISTS phase VARCHAR(30),
      ADD COLUMN IF NOT EXISTS decision_scope VARCHAR(50),
      ADD COLUMN IF NOT EXISTS symbol_count INTEGER,
      ADD COLUMN IF NOT EXISTS symbols_snapshot JSONB,
      ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(50),
      ADD COLUMN IF NOT EXISTS run_profile VARCHAR(30);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_decisions_run_id ON ai_decisions(run_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_decisions_workflow_type ON ai_decisions(workflow_type);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_decisions_phase ON ai_decisions(phase);
    `);

    // Alerts - track all alerts sent
    await client.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
        alert_type VARCHAR(50) NOT NULL,
        symbol VARCHAR(10),
        message TEXT NOT NULL,
        severity VARCHAR(20),
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Performance metrics - track key metrics
    await client.query(`
      CREATE TABLE IF NOT EXISTS performance_metrics (
        id SERIAL PRIMARY KEY,
        metric_name VARCHAR(50) NOT NULL,
        metric_value DECIMAL(12, 4) NOT NULL,
        period VARCHAR(20),
        calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Pending approvals - track trade recommendations awaiting user approval
    await client.query(`
      CREATE TABLE IF NOT EXISTS pending_approvals (
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
    `);

    // Watchlist - track stocks to monitor with target entry prices
    await client.query(`
      CREATE TABLE IF NOT EXISTS watchlist (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) UNIQUE NOT NULL,
        asset_class VARCHAR(50),
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
    `);

    // Earnings calendar - track earnings dates for all 400 stocks
    await client.query(`
      CREATE TABLE IF NOT EXISTS earnings_calendar (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        earnings_date DATE NOT NULL,
        earnings_time VARCHAR(10),
        source VARCHAR(20) DEFAULT 'yahoo',
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(symbol, earnings_date)
      );
    `);

    await client.query(`
      ALTER TABLE earnings_calendar
      ADD COLUMN IF NOT EXISTS source_primary VARCHAR(20) DEFAULT 'fmp',
      ADD COLUMN IF NOT EXISTS session_normalized VARCHAR(20) DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS timing_raw TEXT,
      ADD COLUMN IF NOT EXISTS timing_source VARCHAR(20) DEFAULT 'fmp',
      ADD COLUMN IF NOT EXISTS source_priority INTEGER DEFAULT 100,
      ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS manual_override BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS notes TEXT;
    `);

    await client.query(`
      UPDATE earnings_calendar
      SET source_primary = COALESCE(source_primary, source, 'fmp'),
          timing_raw = COALESCE(timing_raw, earnings_time),
          timing_source = COALESCE(timing_source, source, 'fmp'),
          source_priority = COALESCE(source_priority, CASE
            WHEN COALESCE(source, 'fmp') = 'manual' THEN 300
            WHEN COALESCE(source, 'fmp') = 'yahoo' THEN 200
            ELSE 100
          END),
          session_normalized = COALESCE(session_normalized, CASE
            WHEN LOWER(COALESCE(earnings_time, '')) = 'bmo' THEN 'pre_market'
            WHEN LOWER(COALESCE(earnings_time, '')) = 'amc' THEN 'post_market'
            ELSE 'unknown'
          END),
          last_verified_at = COALESCE(last_verified_at, last_updated, CURRENT_TIMESTAMP),
          manual_override = COALESCE(manual_override, FALSE)
      WHERE source_primary IS NULL
         OR timing_raw IS NULL
         OR timing_source IS NULL
         OR source_priority IS NULL
         OR session_normalized IS NULL
         OR last_verified_at IS NULL
         OR manual_override IS NULL;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_earnings_symbol ON earnings_calendar(symbol);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_earnings_date ON earnings_calendar(earnings_date);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_earnings_session_normalized ON earnings_calendar(session_normalized);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_earnings_last_verified_at ON earnings_calendar(last_verified_at);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS earnings_reminders (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        earnings_date DATE NOT NULL,
        earnings_time_raw TEXT,
        earnings_session VARCHAR(20) DEFAULT 'unknown',
        earnings_session_source VARCHAR(20) DEFAULT 'unknown',
        catalyst_summary TEXT,
        notes TEXT,
        scheduled_send_at TIMESTAMP,
        email_enabled BOOLEAN DEFAULT TRUE,
        email_sent_at TIMESTAMP,
        predictor_run_at TIMESTAMP,
        predictor_snapshot_price DECIMAL(12, 4),
        predicted_direction VARCHAR(10),
        predicted_confidence VARCHAR(20),
        prediction_reasoning TEXT,
        prediction_key_risk TEXT,
        prediction_catalyst_summary TEXT,
        actual_reaction_direction VARCHAR(10),
        actual_reaction_pct DECIMAL(8, 4),
        grade_result VARCHAR(20),
        graded_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      ALTER TABLE earnings_reminders
      ADD COLUMN IF NOT EXISTS prediction_key_risk TEXT;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_earnings_reminders_symbol
      ON earnings_reminders(symbol);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_earnings_reminders_status
      ON earnings_reminders(status);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_earnings_reminders_scheduled_send_at
      ON earnings_reminders(scheduled_send_at);
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_earnings_reminders_active_symbol_unique
      ON earnings_reminders(symbol)
      WHERE status = 'active';
    `);

    // Position lots - track individual lots (long-term vs swing, long vs short)
    await client.query(`
      CREATE TABLE IF NOT EXISTS position_lots (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        lot_type VARCHAR(20) NOT NULL,
        position_type VARCHAR(10) DEFAULT 'long',
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
        original_intent VARCHAR(50),
        current_intent VARCHAR(50),
        pathway VARCHAR(50),
        strategy_type VARCHAR(50),
        thesis_state VARCHAR(20),
        holding_posture VARCHAR(30),
        holding_period VARCHAR(50),
        confidence VARCHAR(20),
        growth_potential VARCHAR(50),
        stop_type VARCHAR(20),
        target_type VARCHAR(20),
        trailing_stop_pct DECIMAL(5, 2),
        rebalance_threshold_pct DECIMAL(5, 2),
        max_holding_days INTEGER,
        fundamental_stop_conditions JSONB,
        catalysts JSONB,
        news_links JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_position_lots_symbol ON position_lots(symbol);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_position_lots_type ON position_lots(lot_type);
    `);

    // Add intent columns to position_lots (if they don't exist)
    await client.query(`
      ALTER TABLE position_lots
      ADD COLUMN IF NOT EXISTS original_intent VARCHAR(50),
      ADD COLUMN IF NOT EXISTS current_intent VARCHAR(50);
    `);

    // Migrate existing lots: copy lot_type to intent columns if null
    await client.query(`
      UPDATE position_lots
      SET original_intent = lot_type,
          current_intent = lot_type
      WHERE original_intent IS NULL;
    `);

    // Add position_type column to positions and position_lots (for short support)
    await client.query(`
      ALTER TABLE positions
      ADD COLUMN IF NOT EXISTS position_type VARCHAR(10) DEFAULT 'long';
    `);

    await client.query(`
      ALTER TABLE position_lots
      ADD COLUMN IF NOT EXISTS position_type VARCHAR(10) DEFAULT 'long';
    `);

    // Update positions table with new columns (if they don't exist)
    await client.query(`
      ALTER TABLE positions
      ADD COLUMN IF NOT EXISTS investment_type VARCHAR(20),
      ADD COLUMN IF NOT EXISTS total_lots INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS long_term_lots INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS swing_lots INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS thesis TEXT,
      ADD COLUMN IF NOT EXISTS current_intent VARCHAR(50),
      ADD COLUMN IF NOT EXISTS last_reviewed TIMESTAMP,
      ADD COLUMN IF NOT EXISTS days_to_long_term INTEGER,
      ADD COLUMN IF NOT EXISTS next_earnings_date DATE,
      ADD COLUMN IF NOT EXISTS trim_history JSONB,
      ADD COLUMN IF NOT EXISTS oco_order_id VARCHAR(50),
      ADD COLUMN IF NOT EXISTS order_modification_history JSONB,
      ADD COLUMN IF NOT EXISTS asset_class VARCHAR(50),
      ADD COLUMN IF NOT EXISTS industry VARCHAR(100),
      ADD COLUMN IF NOT EXISTS pathway VARCHAR(50),
      ADD COLUMN IF NOT EXISTS intent VARCHAR(50),
      ADD COLUMN IF NOT EXISTS peak_price DECIMAL(10, 2),
      ADD COLUMN IF NOT EXISTS trailing_stop_activated BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS trailing_stop_distance DECIMAL(8, 4),
      ADD COLUMN IF NOT EXISTS strategy_type VARCHAR(50),
      ADD COLUMN IF NOT EXISTS thesis_state VARCHAR(20),
      ADD COLUMN IF NOT EXISTS holding_posture VARCHAR(30),
      ADD COLUMN IF NOT EXISTS holding_period VARCHAR(50),
      ADD COLUMN IF NOT EXISTS confidence VARCHAR(20),
      ADD COLUMN IF NOT EXISTS growth_potential VARCHAR(50),
      ADD COLUMN IF NOT EXISTS stop_type VARCHAR(20),
      ADD COLUMN IF NOT EXISTS stop_reason TEXT,
      ADD COLUMN IF NOT EXISTS target_type VARCHAR(20),
      ADD COLUMN IF NOT EXISTS has_fixed_target BOOLEAN,
      ADD COLUMN IF NOT EXISTS trailing_stop_pct DECIMAL(5, 2),
      ADD COLUMN IF NOT EXISTS rebalance_threshold_pct DECIMAL(5, 2),
      ADD COLUMN IF NOT EXISTS max_holding_days INTEGER,
      ADD COLUMN IF NOT EXISTS fundamental_stop_conditions JSONB,
      ADD COLUMN IF NOT EXISTS catalysts JSONB,
      ADD COLUMN IF NOT EXISTS news_links JSONB;
    `);

    await client.query(`
      ALTER TABLE position_lots
      ADD COLUMN IF NOT EXISTS pathway VARCHAR(50),
      ADD COLUMN IF NOT EXISTS strategy_type VARCHAR(50),
      ADD COLUMN IF NOT EXISTS thesis_state VARCHAR(20),
      ADD COLUMN IF NOT EXISTS holding_posture VARCHAR(30),
      ADD COLUMN IF NOT EXISTS holding_period VARCHAR(50),
      ADD COLUMN IF NOT EXISTS confidence VARCHAR(20),
      ADD COLUMN IF NOT EXISTS growth_potential VARCHAR(50),
      ADD COLUMN IF NOT EXISTS stop_type VARCHAR(20),
      ADD COLUMN IF NOT EXISTS target_type VARCHAR(20),
      ADD COLUMN IF NOT EXISTS trailing_stop_pct DECIMAL(5, 2),
      ADD COLUMN IF NOT EXISTS rebalance_threshold_pct DECIMAL(5, 2),
      ADD COLUMN IF NOT EXISTS max_holding_days INTEGER,
      ADD COLUMN IF NOT EXISTS fundamental_stop_conditions JSONB,
      ADD COLUMN IF NOT EXISTS catalysts JSONB,
      ADD COLUMN IF NOT EXISTS news_links JSONB;
    `);

    // Stock universe table - all stocks Whiskie analyzes (FMP-aligned)
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_universe (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) UNIQUE NOT NULL,
        company_name VARCHAR(200),
        sector VARCHAR(100),
        industry VARCHAR(100),
        market_cap BIGINT,
        market_cap_tier VARCHAR(20),
        price DECIMAL(10, 2),
        avg_daily_volume BIGINT,
        exchange VARCHAR(20),
        country VARCHAR(10),
        is_etf BOOLEAN DEFAULT FALSE,
        is_actively_trading BOOLEAN DEFAULT TRUE,
        shortable BOOLEAN DEFAULT FALSE,
        last_etb_check TIMESTAMP,
        bid_ask_spread DECIMAL(5, 4),
        is_growth_candidate BOOLEAN DEFAULT FALSE,
        universe_bucket VARCHAR(30) DEFAULT 'core',
        added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        removed_date TIMESTAMP,
        status VARCHAR(20) DEFAULT 'active'
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_universe_symbol ON stock_universe(symbol);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_universe_sector ON stock_universe(sector);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_universe_industry ON stock_universe(industry);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_universe_status ON stock_universe(status);
    `);

    await client.query(`
      ALTER TABLE stock_universe
      ADD COLUMN IF NOT EXISTS is_growth_candidate BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS universe_bucket VARCHAR(30) DEFAULT 'core';
    `);

    await client.query(`
      ALTER TABLE stock_universe
      ADD COLUMN IF NOT EXISTS source_primary VARCHAR(20) DEFAULT 'fmp',
      ADD COLUMN IF NOT EXISTS source_last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS price_last_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS universe_reason VARCHAR(50) DEFAULT 'core_market_cap',
      ADD COLUMN IF NOT EXISTS analysis_eligible BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS discovery_eligible BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS earnings_tracking_eligible BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS liquidity_score VARCHAR(20) DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS data_quality_status VARCHAR(20) DEFAULT 'ok';
    `);

    await client.query(`
      ALTER TABLE stock_universe
      ALTER COLUMN avg_daily_volume TYPE DECIMAL(18, 2)
      USING avg_daily_volume::DECIMAL(18, 2);
    `);

    await client.query(`
      UPDATE stock_universe
      SET source_primary = COALESCE(source_primary, 'fmp'),
          source_last_synced_at = COALESCE(source_last_synced_at, added_date, CURRENT_TIMESTAMP),
          price_last_updated_at = COALESCE(price_last_updated_at, added_date, CURRENT_TIMESTAMP),
          universe_reason = COALESCE(universe_reason, CASE
            WHEN COALESCE(universe_bucket, 'core') = 'growth_expansion' THEN 'growth_expansion'
            ELSE 'core_market_cap'
          END),
          analysis_eligible = COALESCE(analysis_eligible, status = 'active'),
          discovery_eligible = COALESCE(discovery_eligible, COALESCE(universe_bucket, 'core') = 'growth_expansion'),
          earnings_tracking_eligible = COALESCE(earnings_tracking_eligible, status = 'active'),
          liquidity_score = COALESCE(liquidity_score, CASE
            WHEN COALESCE(avg_daily_volume, 0) >= 5000000 THEN 'high'
            WHEN COALESCE(avg_daily_volume, 0) >= 1000000 THEN 'medium'
            WHEN COALESCE(avg_daily_volume, 0) > 0 THEN 'low'
            ELSE 'unknown'
          END),
          data_quality_status = COALESCE(data_quality_status, CASE
            WHEN company_name IS NULL OR sector IS NULL OR industry IS NULL THEN 'incomplete'
            ELSE 'ok'
          END)
      WHERE source_primary IS NULL
         OR source_last_synced_at IS NULL
         OR price_last_updated_at IS NULL
         OR universe_reason IS NULL
         OR analysis_eligible IS NULL
         OR discovery_eligible IS NULL
         OR earnings_tracking_eligible IS NULL
         OR liquidity_score IS NULL
         OR data_quality_status IS NULL;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_universe_growth_candidate ON stock_universe(is_growth_candidate);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_universe_analysis_eligible ON stock_universe(analysis_eligible);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_universe_earnings_tracking_eligible ON stock_universe(earnings_tracking_eligible);
    `);

    // ETF watchlist table - track ETFs for hedging/exposure (separate from stock screening)
    await client.query(`
      CREATE TABLE IF NOT EXISTS etf_watchlist (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) UNIQUE NOT NULL,
        name VARCHAR(100),
        category VARCHAR(50),
        expense_ratio DECIMAL(5, 4),
        aum BIGINT,
        avg_daily_volume BIGINT,
        tracking_index VARCHAR(100),
        purpose TEXT,
        current_price DECIMAL(10, 2),
        status VARCHAR(20) DEFAULT 'active',
        added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_etf_watchlist_symbol ON etf_watchlist(symbol);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_etf_watchlist_category ON etf_watchlist(category);
    `);

    // Value watchlist table - fundamental screening results
    await client.query(`
      CREATE TABLE IF NOT EXISTS value_watchlist (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        asset_class VARCHAR(50),
        score INTEGER,
        metrics JSONB,
        reasons TEXT,
        price DECIMAL(10, 2),
        status VARCHAR(20) DEFAULT 'active',
        added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_momentum_check TIMESTAMP,
        position_entered BOOLEAN DEFAULT FALSE,
        position_entry_date TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_value_watchlist_symbol ON value_watchlist(symbol);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_value_watchlist_status ON value_watchlist(status);
    `);

    // Quality watchlist table - high-quality stocks for dip-buying
    await client.query(`
      CREATE TABLE IF NOT EXISTS quality_watchlist (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        asset_class VARCHAR(50),
        quality_score INTEGER,
        metrics JSONB,
        reasons TEXT,
        target_entry_price DECIMAL(10, 2),
        current_price DECIMAL(10, 2),
        status VARCHAR(20) DEFAULT 'active',
        added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_price_check TIMESTAMP,
        position_entered BOOLEAN DEFAULT FALSE,
        position_entry_date TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_quality_watchlist_symbol ON quality_watchlist(symbol);
    `);

    // Overvalued watchlist table - for shorting overextended stocks
    await client.query(`
      CREATE TABLE IF NOT EXISTS overvalued_watchlist (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) UNIQUE NOT NULL,
        asset_class VARCHAR(50),
        overvalued_score INTEGER,
        metrics JSONB,
        reasons TEXT,
        target_entry_price DECIMAL(10, 2),
        current_price DECIMAL(10, 2),
        status VARCHAR(20) DEFAULT 'active',
        added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_price_check TIMESTAMP,
        position_entered BOOLEAN DEFAULT FALSE,
        position_entry_date TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_overvalued_watchlist_symbol ON overvalued_watchlist(symbol);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_quality_watchlist_status ON quality_watchlist(status);
    `);

    // Saturday watchlist - unified table for all Saturday screening results (long + short)
    await client.query(`
      CREATE TABLE IF NOT EXISTS saturday_watchlist (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        intent VARCHAR(10) NOT NULL,
        pathway VARCHAR(30) NOT NULL,
        asset_class VARCHAR(50),
        sector VARCHAR(100),
        industry VARCHAR(100),
        score INTEGER,
        metrics JSONB,
        reasons TEXT,
        price DECIMAL(10, 2),
        status VARCHAR(20) DEFAULT 'active',
        added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_reviewed TIMESTAMP,
        position_entered BOOLEAN DEFAULT FALSE,
        position_entry_date TIMESTAMP,
        UNIQUE(symbol, pathway)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saturday_watchlist_symbol ON saturday_watchlist(symbol);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saturday_watchlist_intent ON saturday_watchlist(intent);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saturday_watchlist_pathway ON saturday_watchlist(pathway);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saturday_watchlist_status ON saturday_watchlist(status);
    `);

    await client.query(`
      ALTER TABLE saturday_watchlist
      ADD COLUMN IF NOT EXISTS source VARCHAR(30) DEFAULT 'weekly_screen',
      ADD COLUMN IF NOT EXISTS promotion_status VARCHAR(30) DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS promotion_reason TEXT,
      ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
    `);

    await client.query(`
      ALTER TABLE saturday_watchlist
      ADD COLUMN IF NOT EXISTS selection_source VARCHAR(30) DEFAULT 'weekly_screen',
      ADD COLUMN IF NOT EXISTS screening_run_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS weekly_reviewed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS activation_cycle_id VARCHAR(64),
      ADD COLUMN IF NOT EXISTS screening_score INTEGER,
      ADD COLUMN IF NOT EXISTS selection_rank_within_pathway INTEGER,
      ADD COLUMN IF NOT EXISTS review_priority INTEGER DEFAULT 50,
      ADD COLUMN IF NOT EXISTS selection_status_reason TEXT,
      ADD COLUMN IF NOT EXISTS analysis_ready BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS profile_required BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS primary_pathway VARCHAR(30),
      ADD COLUMN IF NOT EXISTS secondary_pathways JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS pathway_scores_snapshot JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS pathway_selection_rule TEXT;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saturday_watchlist_source ON saturday_watchlist(source);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saturday_watchlist_promotion_status ON saturday_watchlist(promotion_status);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saturday_watchlist_expires_at ON saturday_watchlist(expires_at);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saturday_watchlist_selection_source ON saturday_watchlist(selection_source);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saturday_watchlist_analysis_ready ON saturday_watchlist(analysis_ready);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saturday_watchlist_primary_pathway ON saturday_watchlist(primary_pathway);
    `);

    await client.query(`
      UPDATE saturday_watchlist
      SET source = COALESCE(source, 'weekly_screen'),
          promotion_status = COALESCE(promotion_status, 'none'),
          selection_source = COALESCE(selection_source, source, 'weekly_screen'),
          screening_run_at = COALESCE(screening_run_at, added_date, CURRENT_TIMESTAMP),
          screening_score = COALESCE(screening_score, score),
          review_priority = COALESCE(review_priority, 50),
          primary_pathway = COALESCE(primary_pathway, pathway),
          secondary_pathways = COALESCE(secondary_pathways, '[]'::jsonb),
          pathway_scores_snapshot = COALESCE(pathway_scores_snapshot, '{}'::jsonb),
          pathway_selection_rule = COALESCE(pathway_selection_rule, 'legacy_pathway_passthrough'),
          analysis_ready = COALESCE(analysis_ready, status = 'active'),
          profile_required = COALESCE(profile_required, TRUE)
      WHERE source IS NULL
         OR promotion_status IS NULL
         OR selection_source IS NULL
         OR screening_run_at IS NULL
         OR screening_score IS NULL
         OR review_priority IS NULL
         OR primary_pathway IS NULL
         OR secondary_pathways IS NULL
         OR pathway_scores_snapshot IS NULL
         OR pathway_selection_rule IS NULL
         OR analysis_ready IS NULL
         OR profile_required IS NULL;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_symbol_state (
        symbol VARCHAR(10) NOT NULL,
        run_date DATE NOT NULL,
        run_time TIME NOT NULL,
        run_type VARCHAR(30) NOT NULL,
        review_depth VARCHAR(20) DEFAULT 'deep',
        primary_pathway VARCHAR(30),
        secondary_pathways JSONB DEFAULT '[]'::jsonb,
        source VARCHAR(30) DEFAULT 'watchlist',
        source_reasons TEXT,
        last_action VARCHAR(20),
        last_confidence VARCHAR(20),
        thesis_state VARCHAR(20),
        holding_posture VARCHAR(30),
        what_changed TEXT,
        news_fingerprint VARCHAR(64),
        technical_fingerprint VARCHAR(64),
        catalyst_fingerprint VARCHAR(64),
        thesis_summary TEXT,
        catalyst_summary TEXT,
        earnings_date DATE,
        insider_signal VARCHAR(30),
        next_review_due TIMESTAMP,
        escalation_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (symbol, run_date, run_time)
      );
    `);

    await client.query(`
      ALTER TABLE daily_symbol_state
      ADD COLUMN IF NOT EXISTS change_magnitude VARCHAR(20),
      ADD COLUMN IF NOT EXISTS review_reason_code VARCHAR(50),
      ADD COLUMN IF NOT EXISTS material_change_detected BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS candidate_bucket_at_run VARCHAR(30),
      ADD COLUMN IF NOT EXISTS decision_run_id VARCHAR(64),
      ADD COLUMN IF NOT EXISTS state_version INTEGER DEFAULT 1;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_daily_symbol_state_symbol ON daily_symbol_state(symbol);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_daily_symbol_state_run_date ON daily_symbol_state(run_date);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_daily_symbol_state_next_review_due ON daily_symbol_state(next_review_due);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_daily_symbol_state_decision_run_id ON daily_symbol_state(decision_run_id);
    `);

    // Add industry column to saturday_watchlist if it doesn't exist (migration for existing databases)
    await client.query(`
      ALTER TABLE saturday_watchlist
      ADD COLUMN IF NOT EXISTS industry VARCHAR(100);
    `);

    // Add Opus review columns to saturday_watchlist
    await client.query(`
      ALTER TABLE saturday_watchlist
      ADD COLUMN IF NOT EXISTS opus_conviction INTEGER,
      ADD COLUMN IF NOT EXISTS opus_reasoning TEXT;
    `);

    // Add pathway and sector columns to quality_watchlist if they don't exist
    await client.query(`
      ALTER TABLE quality_watchlist
      ADD COLUMN IF NOT EXISTS pathway VARCHAR(20);
    `);

    await client.query(`
      ALTER TABLE quality_watchlist
      ADD COLUMN IF NOT EXISTS sector VARCHAR(100);
    `);

    // Rename quality_score to score for consistency
    await client.query(`
      ALTER TABLE quality_watchlist
      ADD COLUMN IF NOT EXISTS score INTEGER;
    `);

    await client.query(`
      UPDATE quality_watchlist SET score = quality_score WHERE score IS NULL;
    `);

    // Add price column (renamed from current_price)
    await client.query(`
      ALTER TABLE quality_watchlist
      ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2);
    `);

    await client.query(`
      UPDATE quality_watchlist SET price = current_price WHERE price IS NULL;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trade_approvals (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        action VARCHAR(20) NOT NULL,
        quantity INTEGER NOT NULL,
        entry_price DECIMAL(10, 2),
        stop_loss DECIMAL(10, 2),
        take_profit DECIMAL(10, 2),
        order_type VARCHAR(20),
        pathway VARCHAR(50),
        intent VARCHAR(50),
        reasoning TEXT,
        investment_thesis TEXT,
        strategy_type VARCHAR(50),
        catalysts JSONB,
        fundamentals JSONB,
        technical_setup TEXT,
        risk_factors TEXT,
        holding_period VARCHAR(50),
        confidence VARCHAR(20),
        growth_potential VARCHAR(50),
        news_links JSONB,
        stop_type VARCHAR(20),
        stop_reason TEXT,
        has_fixed_target BOOLEAN,
        target_type VARCHAR(20),
        trailing_stop_pct DECIMAL(5, 2),
        rebalance_threshold_pct DECIMAL(5, 2),
        max_holding_days INTEGER,
        fundamental_stop_conditions JSONB,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        approved_at TIMESTAMP,
        rejected_at TIMESTAMP,
        executed_at TIMESTAMP,
        rejection_reason TEXT
      );
    `);

    await client.query(`
      ALTER TABLE trade_approvals
      ADD COLUMN IF NOT EXISTS order_type VARCHAR(20),
      ADD COLUMN IF NOT EXISTS pathway VARCHAR(50),
      ADD COLUMN IF NOT EXISTS secondary_pathways JSONB,
      ADD COLUMN IF NOT EXISTS pathway_selection_rule TEXT,
      ADD COLUMN IF NOT EXISTS intent VARCHAR(50),
      ADD COLUMN IF NOT EXISTS investment_thesis TEXT,
      ADD COLUMN IF NOT EXISTS strategy_type VARCHAR(50),
      ADD COLUMN IF NOT EXISTS thesis_state VARCHAR(20),
      ADD COLUMN IF NOT EXISTS holding_posture VARCHAR(30),
      ADD COLUMN IF NOT EXISTS catalysts JSONB,
      ADD COLUMN IF NOT EXISTS fundamentals JSONB,
      ADD COLUMN IF NOT EXISTS technical_setup TEXT,
      ADD COLUMN IF NOT EXISTS risk_factors TEXT,
      ADD COLUMN IF NOT EXISTS holding_period VARCHAR(50),
      ADD COLUMN IF NOT EXISTS confidence VARCHAR(20),
      ADD COLUMN IF NOT EXISTS growth_potential VARCHAR(50),
      ADD COLUMN IF NOT EXISTS news_links JSONB,
      ADD COLUMN IF NOT EXISTS stop_type VARCHAR(20),
      ADD COLUMN IF NOT EXISTS stop_reason TEXT,
      ADD COLUMN IF NOT EXISTS has_fixed_target BOOLEAN,
      ADD COLUMN IF NOT EXISTS target_type VARCHAR(20),
      ADD COLUMN IF NOT EXISTS trailing_stop_pct DECIMAL(5, 2),
      ADD COLUMN IF NOT EXISTS rebalance_threshold_pct DECIMAL(5, 2),
      ADD COLUMN IF NOT EXISTS max_holding_days INTEGER,
      ADD COLUMN IF NOT EXISTS fundamental_stop_conditions JSONB,
      ADD COLUMN IF NOT EXISTS override_phase2_decision VARCHAR(10),
      ADD COLUMN IF NOT EXISTS override_symbol VARCHAR(10),
      ADD COLUMN IF NOT EXISTS override_reason TEXT,
      ADD COLUMN IF NOT EXISTS order_id VARCHAR(50),
      ADD COLUMN IF NOT EXISTS decision_run_id VARCHAR(64),
      ADD COLUMN IF NOT EXISTS source_phase VARCHAR(30),
      ADD COLUMN IF NOT EXISTS raw_model_quantity INTEGER,
      ADD COLUMN IF NOT EXISTS quantity_adjustment_note TEXT;
    `);

    await client.query(`
      ALTER TABLE trade_approvals
      ALTER COLUMN status SET DEFAULT 'pending';
    `);

    await client.query(`
      UPDATE trade_approvals
      SET status = 'pending'
      WHERE status = 'pending_approval';
    `);

    await client.query(`
      UPDATE trade_approvals
      SET thesis_state = COALESCE(thesis_state, 'unchanged')
      WHERE strategy_type IS NOT NULL AND thesis_state IS NULL;
    `);

    await client.query(`
      UPDATE trade_approvals
      SET holding_posture = CASE
        WHEN holding_posture IS NOT NULL THEN holding_posture
        WHEN target_type = 'flexible_fundamental' THEN 'rebalance'
        WHEN thesis_state = 'broken' AND action = 'sell_short' THEN 'cover'
        WHEN thesis_state = 'broken' THEN 'exit'
        WHEN target_type = 'trailing' THEN 'trail'
        ELSE 'hold'
      END
      WHERE holding_posture IS NULL;
    `);

    await client.query(`
      UPDATE trade_approvals
      SET has_fixed_target = CASE
        WHEN has_fixed_target IS NOT NULL THEN has_fixed_target
        WHEN target_type = 'flexible_fundamental' THEN FALSE
        WHEN target_type IS NOT NULL THEN TRUE
        WHEN take_profit IS NOT NULL THEN TRUE
        ELSE FALSE
      END
      WHERE has_fixed_target IS NULL;
    `);

    await client.query(`
      UPDATE trade_approvals
      SET secondary_pathways = COALESCE(secondary_pathways, '[]'::jsonb),
          pathway_selection_rule = COALESCE(pathway_selection_rule, CASE WHEN pathway IS NOT NULL THEN 'approval_primary_pathway' ELSE 'unclassified' END)
      WHERE secondary_pathways IS NULL OR pathway_selection_rule IS NULL;
    `);

    await client.query(`
      UPDATE positions
      SET thesis_state = COALESCE(thesis_state, 'unchanged')
      WHERE strategy_type IS NOT NULL AND thesis_state IS NULL;
    `);

    await client.query(`
      ALTER TABLE positions
      ADD COLUMN IF NOT EXISTS secondary_pathways JSONB,
      ADD COLUMN IF NOT EXISTS pathway_selection_rule TEXT;
    `);

    await client.query(`
      UPDATE positions
      SET holding_posture = CASE
        WHEN holding_posture IS NOT NULL THEN holding_posture
        WHEN target_type = 'flexible_fundamental' THEN 'rebalance'
        WHEN thesis_state = 'broken' AND (position_type = 'short' OR stock_type = 'short' OR quantity < 0) THEN 'cover'
        WHEN thesis_state = 'broken' THEN 'exit'
        WHEN target_type = 'trailing' THEN 'trail'
        ELSE 'hold'
      END
      WHERE holding_posture IS NULL;
    `);

    await client.query(`
      UPDATE positions
      SET has_fixed_target = CASE
        WHEN has_fixed_target IS NOT NULL THEN has_fixed_target
        WHEN target_type = 'flexible_fundamental' THEN FALSE
        WHEN target_type IS NOT NULL THEN TRUE
        WHEN take_profit IS NOT NULL THEN TRUE
        ELSE FALSE
      END
      WHERE has_fixed_target IS NULL;
    `);

    await client.query(`
      UPDATE positions
      SET secondary_pathways = COALESCE(secondary_pathways, '[]'::jsonb),
          pathway_selection_rule = COALESCE(pathway_selection_rule, CASE WHEN pathway IS NOT NULL THEN 'position_primary_pathway' ELSE 'unclassified' END)
      WHERE secondary_pathways IS NULL OR pathway_selection_rule IS NULL;
    `);

    await client.query(`
      UPDATE position_lots
      SET thesis_state = COALESCE(thesis_state, 'unchanged')
      WHERE strategy_type IS NOT NULL AND thesis_state IS NULL;
    `);

    await client.query(`
      ALTER TABLE position_lots
      ADD COLUMN IF NOT EXISTS secondary_pathways JSONB,
      ADD COLUMN IF NOT EXISTS pathway_selection_rule TEXT;
    `);

    await client.query(`
      UPDATE position_lots
      SET holding_posture = CASE
        WHEN holding_posture IS NOT NULL THEN holding_posture
        WHEN target_type = 'flexible_fundamental' THEN 'rebalance'
        WHEN thesis_state = 'broken' AND position_type = 'short' THEN 'cover'
        WHEN thesis_state = 'broken' THEN 'exit'
        WHEN target_type = 'trailing' THEN 'trail'
        ELSE 'hold'
      END
      WHERE holding_posture IS NULL;
    `);

    await client.query(`
      UPDATE position_lots
      SET secondary_pathways = COALESCE(secondary_pathways, '[]'::jsonb),
          pathway_selection_rule = COALESCE(pathway_selection_rule, CASE WHEN pathway IS NOT NULL THEN 'lot_primary_pathway' ELSE 'unclassified' END)
      WHERE secondary_pathways IS NULL OR pathway_selection_rule IS NULL;
    `);

    await client.query(`
      UPDATE positions
      SET rebalance_threshold_pct = 20
      WHERE rebalance_threshold_pct IS NULL
        AND target_type = 'flexible_fundamental';
    `);

    await client.query(`
      UPDATE positions
      SET take_profit = NULL,
          has_fixed_target = FALSE
      WHERE target_type = 'flexible_fundamental';
    `);

    await client.query(`
      UPDATE positions
      SET trailing_stop_pct = COALESCE(trailing_stop_pct, 8)
      WHERE (position_type = 'short' OR stock_type = 'short' OR quantity < 0)
        AND trailing_stop_pct IS NULL;
    `);

    await client.query(`
      UPDATE position_lots
      SET rebalance_threshold_pct = 20
      WHERE rebalance_threshold_pct IS NULL
        AND target_type = 'flexible_fundamental';
    `);

    await client.query(`
      UPDATE position_lots
      SET take_profit = NULL
      WHERE target_type = 'flexible_fundamental';
    `);

    await client.query(`
      UPDATE position_lots
      SET trailing_stop_pct = COALESCE(trailing_stop_pct, 8)
      WHERE position_type = 'short'
        AND trailing_stop_pct IS NULL;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_positions_thesis_state ON positions(thesis_state);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_positions_holding_posture ON positions(holding_posture);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_position_lots_thesis_state ON position_lots(thesis_state);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_trade_approvals_thesis_state ON trade_approvals(thesis_state);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_trade_approvals_holding_posture ON trade_approvals(holding_posture);
    `);

    // Trend learning tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_analysis_history (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        analysis_date DATE NOT NULL,
        analysis_type VARCHAR(50) NOT NULL,
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
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_analysis_symbol ON stock_analysis_history(symbol);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_analysis_date ON stock_analysis_history(analysis_date);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_analysis_outcome ON stock_analysis_history(outcome);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS market_trend_patterns (
        id SERIAL PRIMARY KEY,
        pattern_date DATE NOT NULL,
        pattern_type VARCHAR(50) NOT NULL,
        pattern_description TEXT,
        affected_sectors JSONB,
        key_indicators JSONB,
        opus_insight TEXT,
        action_taken TEXT,
        outcome VARCHAR(20),
        outcome_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Stock profiles table - comprehensive research dossier
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_profiles (
        symbol VARCHAR(10) PRIMARY KEY,
        business_model TEXT,
        moats TEXT,
        competitive_advantages TEXT,
        fundamentals JSONB,
        risks TEXT,
        catalysts TEXT,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        profile_version INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        quality_flag VARCHAR(20) DEFAULT 'active',
        skip_reason TEXT
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_profiles_updated ON stock_profiles(last_updated);
    `);

    // Add quality_flag and skip_reason columns if they don't exist
    await client.query(`
      ALTER TABLE stock_profiles
      ADD COLUMN IF NOT EXISTS quality_flag VARCHAR(20) DEFAULT 'active';
    `);

    await client.query(`
      ALTER TABLE stock_profiles
      ADD COLUMN IF NOT EXISTS skip_reason TEXT;
    `);

    await client.query(`
      ALTER TABLE stock_profiles
      ADD COLUMN IF NOT EXISTS profile_status VARCHAR(20) DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS refresh_tier VARCHAR(20) DEFAULT 'full',
      ADD COLUMN IF NOT EXISTS last_full_refresh_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_incremental_refresh_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS next_refresh_due TIMESTAMP,
      ADD COLUMN IF NOT EXISTS refresh_priority INTEGER DEFAULT 50,
      ADD COLUMN IF NOT EXISTS coverage_score INTEGER DEFAULT 50,
      ADD COLUMN IF NOT EXISTS research_quality VARCHAR(20) DEFAULT 'standard',
      ADD COLUMN IF NOT EXISTS facts_last_verified_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_catalyst_refresh_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_news_refresh_at TIMESTAMP;
    `);

    await client.query(`
      ALTER TABLE stock_profiles
      ADD COLUMN IF NOT EXISTS competitive_landscape TEXT,
      ADD COLUMN IF NOT EXISTS management_quality TEXT,
      ADD COLUMN IF NOT EXISTS valuation_framework TEXT,
      ADD COLUMN IF NOT EXISTS industry_sector VARCHAR(100),
      ADD COLUMN IF NOT EXISTS market_cap_category VARCHAR(50),
      ADD COLUMN IF NOT EXISTS growth_stage VARCHAR(50),
      ADD COLUMN IF NOT EXISTS insider_ownership_pct DECIMAL(8, 2),
      ADD COLUMN IF NOT EXISTS institutional_ownership_pct DECIMAL(8, 2),
      ADD COLUMN IF NOT EXISTS last_earnings_date DATE,
      ADD COLUMN IF NOT EXISTS next_earnings_date DATE,
      ADD COLUMN IF NOT EXISTS key_metrics_to_watch JSONB;
    `);

    await client.query(`
      ALTER TABLE stock_profiles
      ALTER COLUMN competitive_landscape TYPE TEXT,
      ALTER COLUMN management_quality TYPE TEXT,
      ALTER COLUMN valuation_framework TYPE TEXT,
      ALTER COLUMN market_cap_category TYPE VARCHAR(20),
      ALTER COLUMN growth_stage TYPE VARCHAR(30);
    `);

    const stockProfileLengthConstraints = [
      'check_business_model_length',
      'check_moats_length',
      'check_competitive_advantages_length',
      'check_competitive_landscape_length',
      'check_management_quality_length',
      'check_valuation_framework_length',
      'check_risks_length',
      'check_catalysts_length'
    ];

    for (const constraint of stockProfileLengthConstraints) {
      await client.query(`ALTER TABLE stock_profiles DROP CONSTRAINT IF EXISTS ${constraint};`);
    }

    await client.query(`
      UPDATE stock_profiles
      SET profile_status = COALESCE(profile_status, CASE
            WHEN quality_flag = 'active' THEN 'active'
            ELSE 'skipped'
          END),
          refresh_tier = COALESCE(refresh_tier, 'full'),
          last_full_refresh_at = COALESCE(last_full_refresh_at, last_updated, created_at, CURRENT_TIMESTAMP),
          next_refresh_due = COALESCE(next_refresh_due, COALESCE(last_updated, created_at, CURRENT_TIMESTAMP) + INTERVAL '14 days'),
          refresh_priority = COALESCE(refresh_priority, CASE
            WHEN quality_flag = 'active' THEN 50
            ELSE 10
          END),
          coverage_score = COALESCE(coverage_score, CASE
            WHEN business_model IS NOT NULL AND moats IS NOT NULL AND risks IS NOT NULL AND catalysts IS NOT NULL THEN 80
            WHEN business_model IS NOT NULL OR moats IS NOT NULL OR risks IS NOT NULL OR catalysts IS NOT NULL THEN 55
            ELSE 25
          END),
          research_quality = COALESCE(research_quality, CASE
            WHEN quality_flag = 'active' THEN 'standard'
            ELSE 'light'
          END),
          facts_last_verified_at = COALESCE(facts_last_verified_at, last_updated, created_at, CURRENT_TIMESTAMP),
          last_catalyst_refresh_at = COALESCE(last_catalyst_refresh_at, last_updated, created_at, CURRENT_TIMESTAMP),
          last_news_refresh_at = COALESCE(last_news_refresh_at, last_updated, created_at, CURRENT_TIMESTAMP)
      WHERE profile_status IS NULL
         OR refresh_tier IS NULL
         OR last_full_refresh_at IS NULL
         OR next_refresh_due IS NULL
         OR refresh_priority IS NULL
         OR coverage_score IS NULL
         OR research_quality IS NULL
         OR facts_last_verified_at IS NULL
         OR last_catalyst_refresh_at IS NULL
         OR last_news_refresh_at IS NULL;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_profiles_quality ON stock_profiles(quality_flag);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_profiles_status ON stock_profiles(profile_status);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_profiles_next_refresh_due ON stock_profiles(next_refresh_due);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_market_trend_date ON market_trend_patterns(pattern_date);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_market_trend_type ON market_trend_patterns(pattern_type);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS learning_insights (
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
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_learning_insights_date ON learning_insights(insight_date);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_learning_insights_type ON learning_insights(insight_type);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_learning_insights_applied ON learning_insights(applied);
    `);

    // Cron job execution tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS cron_job_executions (
        id SERIAL PRIMARY KEY,
        job_name VARCHAR(100) NOT NULL,
        job_type VARCHAR(50) NOT NULL,
        scheduled_time TIMESTAMP NOT NULL,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        status VARCHAR(20) DEFAULT 'pending',
        error_message TEXT,
        duration_seconds INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cron_job_name ON cron_job_executions(job_name);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cron_scheduled_time ON cron_job_executions(scheduled_time);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cron_status ON cron_job_executions(status);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tavily_usage_events (
        id SERIAL PRIMARY KEY,
        activity VARCHAR(100) NOT NULL,
        symbol VARCHAR(10),
        query TEXT NOT NULL,
        topic VARCHAR(30),
        search_depth VARCHAR(20),
        max_results INTEGER,
        result_count INTEGER DEFAULT 0,
        cache_hit BOOLEAN DEFAULT FALSE,
        context JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tavily_usage_events_activity ON tavily_usage_events(activity);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tavily_usage_events_symbol ON tavily_usage_events(symbol);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tavily_usage_events_created_at ON tavily_usage_events(created_at);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS options_analysis_runs (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        intent_horizon VARCHAR(20) NOT NULL,
        underlying_price DECIMAL(10, 2),
        recommendation_type VARCHAR(30),
        strategy_type VARCHAR(50),
        direction_call VARCHAR(20),
        conviction VARCHAR(20),
        thesis_summary TEXT,
        catalysts JSONB,
        risks JSONB,
        warnings JSONB,
        guardrails JSONB,
        profile_version INTEGER,
        result_payload JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      ALTER TABLE options_analysis_runs
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_options_analysis_runs_symbol ON options_analysis_runs(symbol);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_options_analysis_runs_created_at ON options_analysis_runs(created_at);
    `);

    // Error logging table
    await client.query(`
      CREATE TABLE IF NOT EXISTS error_log (
        id SERIAL PRIMARY KEY,
        error_type VARCHAR(100) NOT NULL,
        error_message TEXT NOT NULL,
        stack_trace TEXT,
        context JSONB,
        occurrence_count INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_error_log_type ON error_log(error_type);
    `);

    // Circuit breaker events table
    await client.query(`
      CREATE TABLE IF NOT EXISTS circuit_breaker_events (
        id SERIAL PRIMARY KEY,
        reason TEXT NOT NULL,
        tripped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reset_at TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_circuit_breaker_tripped ON circuit_breaker_events(tripped_at);
    `);

    // Reconciliation log table
    await client.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_log (
        id SERIAL PRIMARY KEY,
        discrepancies JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Macro regime log table
    await client.query(`
      CREATE TABLE IF NOT EXISTS macro_regime_log (
        id SERIAL PRIMARY KEY,
        regime VARCHAR(50) NOT NULL,
        yield_curve DECIMAL(5, 2),
        unemployment DECIMAL(5, 2),
        fed_funds DECIMAL(5, 2),
        detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Dividend log table
    await client.query(`
      CREATE TABLE IF NOT EXISTS dividend_log (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        ex_date DATE,
        pay_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_error_log_created ON error_log(created_at);
    `);

    // Performance metrics table (ensure it has the right structure)
    await client.query(`
      CREATE TABLE IF NOT EXISTS performance_metrics (
        id SERIAL PRIMARY KEY,
        metric_name VARCHAR(100) NOT NULL,
        metric_value DECIMAL(12, 2) NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add created_at column if it doesn't exist (for existing tables)
    await client.query(`
      ALTER TABLE performance_metrics
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_performance_metric_name ON performance_metrics(metric_name);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_performance_created ON performance_metrics(created_at);
    `);

    console.log('✅ Database schema initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Log a trade to database
 */
export async function logTrade(trade) {
  try {
    const result = await pool.query(
      `INSERT INTO trades (symbol, action, quantity, price, total_value, order_id, status, reasoning)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        trade.symbol,
        trade.action,
        trade.quantity,
        trade.price,
        Math.abs(trade.quantity * trade.price),
        trade.orderId,
        trade.status,
        trade.reasoning
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error logging trade:', error);
    throw error;
  }
}

/**
 * Update or insert position
 */
export async function upsertPosition(position) {
  try {
    const result = await pool.query(
      `INSERT INTO positions (
         symbol, quantity, cost_basis, current_price, sector, industry, stock_type,
         stop_loss, take_profit, pathway, intent, peak_price, position_type,
         strategy_type, thesis_state, holding_posture, holding_period, secondary_pathways, pathway_selection_rule, confidence,
         growth_potential, stop_type, stop_reason, target_type, has_fixed_target,
         trailing_stop_pct, rebalance_threshold_pct, max_holding_days,
         fundamental_stop_conditions, catalysts, news_links
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31)
       ON CONFLICT (symbol)
       DO UPDATE SET
         quantity = $2,
         cost_basis = $3,
         current_price = $4,
         sector = $5,
         industry = $6,
         stock_type = $7,
         stop_loss = $8,
         take_profit = $9,
         pathway = $10,
         intent = $11,
         peak_price = $12,
         position_type = $13,
         strategy_type = $14,
         thesis_state = $15,
         holding_posture = $16,
         holding_period = $17,
         secondary_pathways = $18,
         pathway_selection_rule = $19,
         confidence = $20,
         growth_potential = $21,
         stop_type = $22,
         stop_reason = $23,
         target_type = $24,
         has_fixed_target = $25,
         trailing_stop_pct = $26,
         rebalance_threshold_pct = $27,
         max_holding_days = $28,
         fundamental_stop_conditions = $29,
         catalysts = $30,
         news_links = $31,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        position.symbol,
        position.quantity,
        position.cost_basis,
        position.current_price,
        position.sector,
        position.industry || null,
        position.stock_type,
        position.stop_loss,
        position.take_profit,
        position.pathway || null,
        position.intent || null,
        position.peak_price || position.current_price,
        position.position_type || (position.quantity < 0 ? 'short' : 'long'),
        position.strategy_type || null,
        position.thesis_state || null,
        position.holding_posture || null,
        position.holding_period || null,
        position.secondary_pathways ? JSON.stringify(position.secondary_pathways) : JSON.stringify([]),
        position.pathway_selection_rule || (position.pathway ? 'position_primary_pathway' : 'unclassified'),
        position.confidence || null,
        position.growth_potential || null,
        position.stop_type || null,
        position.stop_reason || null,
        position.target_type || null,
        position.has_fixed_target ?? null,
        position.trailing_stop_pct ?? null,
        position.rebalance_threshold_pct ?? null,
        position.max_holding_days ?? null,
        position.fundamental_stop_conditions ? JSON.stringify(position.fundamental_stop_conditions) : null,
        position.catalysts ? JSON.stringify(position.catalysts) : null,
        position.news_links ? JSON.stringify(position.news_links) : null
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error upserting position:', error);
    throw error;
  }
}

/**
 * Get all current positions
 */
export async function getPositions() {
  try {
    const result = await pool.query('SELECT * FROM positions WHERE quantity != 0 ORDER BY symbol');
    return result.rows;
  } catch (error) {
    console.error('Error fetching positions:', error);
    throw error;
  }
}

/**
 * Get portfolio summary (total value, cash, positions value)
 */
export async function getPortfolioSummary() {
  try {
    const positions = await getPositions();

    // Calculate total positions value
    let positionsValue = 0;
    for (const position of positions) {
      positionsValue += position.quantity * position.current_price;
    }

    // Get cash from most recent portfolio snapshot, default to initial capital if none
    const snapshotResult = await pool.query(
      'SELECT cash FROM portfolio_snapshots ORDER BY snapshot_date DESC LIMIT 1'
    );
    const cash = snapshotResult.rows.length > 0
      ? parseFloat(snapshotResult.rows[0].cash)
      : parseFloat(process.env.INITIAL_CAPITAL || 100000);

    const totalValue = Number(cash) + Number(positionsValue);

    return {
      totalValue,
      cash,
      positionsValue,
      positionCount: positions.length
    };
  } catch (error) {
    console.error('Error fetching portfolio summary:', error);
    throw error;
  }
}

/**
 * Delete position (when fully sold)
 */
export async function deletePosition(symbol) {
  try {
    await pool.query('DELETE FROM positions WHERE symbol = $1', [symbol]);
  } catch (error) {
    console.error('Error deleting position:', error);
    throw error;
  }
}

/**
 * Save portfolio snapshot
 */
export async function savePortfolioSnapshot(snapshot) {
  try {
    const result = await pool.query(
      `INSERT INTO portfolio_snapshots (total_value, cash, positions_value, daily_change, total_return, sp500_return, snapshot_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (snapshot_date)
       DO UPDATE SET
         total_value = $1,
         cash = $2,
         positions_value = $3,
         daily_change = $4,
         total_return = $5,
         sp500_return = $6
       RETURNING *`,
      [
        snapshot.total_value,
        snapshot.cash,
        snapshot.positions_value,
        snapshot.daily_change,
        snapshot.total_return,
        snapshot.sp500_return,
        snapshot.snapshot_date
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving snapshot:', error);
    throw error;
  }
}

/**
 * Log AI decision
 */
export async function logAIDecision(decision) {
  try {
    const result = await pool.query(
      `INSERT INTO ai_decisions (
        decision_type, symbol, recommendation, reasoning, model_used, confidence, executed,
        input_tokens, output_tokens, total_tokens, cost_estimate, duration_seconds,
        run_id, workflow_type, phase, decision_scope, symbol_count, symbols_snapshot, prompt_version, run_profile
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20) RETURNING *`,
      [
        decision.type,
        decision.symbol,
        decision.recommendation,
        decision.reasoning,
        decision.model,
        decision.confidence,
        decision.executed || false,
        decision.input_tokens || null,
        decision.output_tokens || null,
        decision.total_tokens || null,
        decision.cost_estimate || null,
        decision.duration_seconds || null,
        decision.run_id || null,
        decision.workflow_type || null,
        decision.phase || null,
        decision.decision_scope || null,
        decision.symbol_count || null,
        decision.symbols_snapshot ? JSON.stringify(decision.symbols_snapshot) : null,
        decision.prompt_version || null,
        decision.run_profile || null
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error logging AI decision:', error);
    throw error;
  }
}

/**
 * Save pending approval (10 minute timeout)
 */
export async function savePendingApproval(approval) {
  try {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    const result = await pool.query(
      `INSERT INTO pending_approvals (
        analysis_id, symbol, action, quantity, entry_price, stop_loss, take_profit, reasoning, expires_at
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        approval.analysisId,
        approval.symbol,
        approval.action,
        approval.quantity,
        approval.entryPrice,
        approval.stopLoss,
        approval.takeProfit,
        approval.reasoning,
        expiresAt
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving pending approval:', error);
    throw error;
  }
}

/**
 * Get pending approvals
 */
export async function getPendingApprovals() {
  try {
    const result = await pool.query(
      `SELECT * FROM pending_approvals
       WHERE status = 'pending' AND expires_at > NOW()
       ORDER BY created_at DESC`
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching pending approvals:', error);
    throw error;
  }
}

/**
 * Update approval status
 */
export async function updateApprovalStatus(approvalId, status) {
  try {
    const field = status === 'approved' ? 'approved_at' : 'rejected_at';

    const result = await pool.query(
      `UPDATE pending_approvals
       SET status = $1, ${field} = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, approvalId]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error updating approval status:', error);
    throw error;
  }
}

/**
 * Expire old pending approvals
 */
export async function expireOldApprovals() {
  try {
    await pool.query(
      `UPDATE pending_approvals
       SET status = 'expired'
       WHERE status = 'pending' AND expires_at <= NOW()`
    );
  } catch (error) {
    console.error('Error expiring old approvals:', error);
    throw error;
  }
}

/**
 * Log alert
 */
export async function logAlert(alert) {
  try {
    const result = await pool.query(
      `INSERT INTO alerts (alert_type, symbol, message, severity)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [alert.type, alert.symbol, alert.message, alert.severity]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error logging alert:', error);
    throw error;
  }
}

/**
 * Get trade history
 */
export async function getTradeHistory(limit = 100) {
  try {
    const result = await pool.query(
      'SELECT * FROM trades ORDER BY executed_at DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching trade history:', error);
    throw error;
  }
}

/**
 * Get portfolio performance
 */
export async function getPerformanceHistory(days = 30) {
  try {
    const result = await pool.query(
      `SELECT * FROM portfolio_snapshots
       WHERE snapshot_date >= CURRENT_DATE - INTERVAL '${days} days'
       ORDER BY snapshot_date DESC`
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching performance:', error);
    throw error;
  }
}

/**
 * Add stock to watchlist
 */
export async function addToWatchlist(watchItem) {
  try {
    const result = await pool.query(
      `INSERT INTO watchlist (
        symbol, asset_class, current_price, target_entry_price, target_exit_price,
        why_watching, why_not_buying_now, price_when_added, highest_price, lowest_price
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (symbol)
       DO UPDATE SET
         asset_class = $2,
         current_price = $3,
         target_entry_price = $4,
         target_exit_price = $5,
         why_watching = $6,
         why_not_buying_now = $7,
         last_reviewed = CURRENT_TIMESTAMP,
         highest_price = GREATEST(watchlist.highest_price, $9),
         lowest_price = LEAST(watchlist.lowest_price, $10)
       RETURNING *`,
      [
        watchItem.symbol,
        watchItem.asset_class,
        watchItem.current_price,
        watchItem.target_entry_price,
        watchItem.target_exit_price,
        watchItem.why_watching,
        watchItem.why_not_buying_now,
        watchItem.current_price,
        watchItem.current_price,
        watchItem.current_price
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error adding to watchlist:', error);
    throw error;
  }
}

/**
 * Get all watchlist items
 */
export async function getWatchlist() {
  try {
    const result = await pool.query(
      `SELECT * FROM watchlist WHERE status = 'watching' ORDER BY added_date DESC`
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching watchlist:', error);
    throw error;
  }
}

/**
 * Update watchlist item prices
 */
export async function updateWatchlistPrice(symbol, currentPrice) {
  try {
    const result = await pool.query(
      `UPDATE watchlist
       SET current_price = $2,
           highest_price = GREATEST(highest_price, $2),
           lowest_price = LEAST(lowest_price, $2),
           last_reviewed = CURRENT_TIMESTAMP
       WHERE symbol = $1
       RETURNING *`,
      [symbol, currentPrice]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error updating watchlist price:', error);
    throw error;
  }
}

/**
 * Remove from watchlist
 */
export async function removeFromWatchlist(symbol) {
  try {
    await pool.query(
      `UPDATE watchlist SET status = 'removed' WHERE symbol = $1`,
      [symbol]
    );
  } catch (error) {
    console.error('Error removing from watchlist:', error);
    throw error;
  }
}

/**
 * Get watchlist items at or below target entry price
 */
export async function getWatchlistBuyOpportunities() {
  try {
    const result = await pool.query(
      `SELECT * FROM watchlist
       WHERE status = 'watching'
       AND current_price <= target_entry_price
       ORDER BY (target_entry_price - current_price) DESC`
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching buy opportunities:', error);
    throw error;
  }
}

/**
 * Upsert earnings date for a symbol
 */
export async function upsertEarning(symbol, earningsDate, earningsTime = 'unknown') {
  const normalizedTime = String(earningsTime || '').trim();
  const lower = normalizedTime.toLowerCase();
  const normalizedSession = lower === 'bmo'
    ? 'pre_market'
    : lower === 'amc'
      ? 'post_market'
      : 'unknown';
  try {
    const result = await pool.query(
      `INSERT INTO earnings_calendar (
         symbol, earnings_date, earnings_time, source, source_primary,
         timing_raw, timing_source, session_normalized, source_priority,
         last_updated, last_verified_at, manual_override
       )
       VALUES ($1, $2, $3, 'fmp', 'fmp', $3, 'fmp', $4, 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, FALSE)
       ON CONFLICT (symbol, earnings_date)
       DO UPDATE SET
         earnings_time = $3,
         source = CASE
           WHEN earnings_calendar.manual_override THEN earnings_calendar.source
           ELSE 'fmp'
         END,
         source_primary = CASE
           WHEN earnings_calendar.manual_override THEN earnings_calendar.source_primary
           ELSE 'fmp'
         END,
         timing_raw = CASE
           WHEN earnings_calendar.manual_override THEN earnings_calendar.timing_raw
           ELSE $3
         END,
         timing_source = CASE
           WHEN earnings_calendar.manual_override THEN earnings_calendar.timing_source
           ELSE 'fmp'
         END,
         session_normalized = CASE
           WHEN earnings_calendar.manual_override THEN earnings_calendar.session_normalized
           ELSE $4
         END,
         source_priority = CASE
           WHEN earnings_calendar.manual_override THEN earnings_calendar.source_priority
           ELSE 100
         END,
         last_updated = CURRENT_TIMESTAMP,
         last_verified_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [symbol, earningsDate, earningsTime, normalizedSession]
    );
    return result.rows[0];
  } catch (error) {
    console.error(`Error upserting earning for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Get next earnings date for a symbol
 */
export async function getNextEarning(symbol) {
  try {
    const result = await pool.query(
      `SELECT * FROM earnings_calendar
       WHERE symbol = $1
       AND earnings_date >= CURRENT_DATE
       ORDER BY earnings_date ASC, source_priority DESC, last_verified_at DESC
       LIMIT 1`,
      [symbol]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error(`Error fetching next earning for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Get upcoming earnings (next N days)
 */
export async function getUpcomingEarnings(days = 30) {
  try {
    const result = await pool.query(
      `SELECT
        ec.*,
        su.company_name,
        su.market_cap
       FROM earnings_calendar ec
       LEFT JOIN stock_universe su ON su.symbol = ec.symbol
       WHERE ec.earnings_date >= CURRENT_DATE
       AND ec.earnings_date <= CURRENT_DATE + INTERVAL '${days} days'
       ORDER BY ec.earnings_date ASC, ec.source_priority DESC, ec.last_verified_at DESC`,
      []
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching upcoming earnings:', error);
    throw error;
  }
}

export async function searchUpcomingEarningsSymbols(queryText = '', limit = 10) {
  try {
    const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(Number(limit), 25)) : 10;
    const queryValue = String(queryText || '').trim().toUpperCase();
    const params = [normalizedLimit];
    let whereClause = `
      WHERE ec.earnings_date >= CURRENT_DATE
    `;

    if (queryValue) {
      params.unshift(`%${queryValue}%`);
      whereClause += `
        AND ec.symbol ILIKE $1
      `;
    }

    const limitPlaceholder = queryValue ? '$2' : '$1';

    const result = await pool.query(
      `SELECT DISTINCT ON (ec.symbol)
        ec.symbol,
        ec.earnings_date,
        ec.earnings_time,
        ec.session_normalized,
        ec.timing_raw,
        ec.source,
        ec.timing_source,
        ec.last_updated,
        ec.last_verified_at,
        su.company_name,
        su.market_cap
       FROM earnings_calendar ec
       LEFT JOIN stock_universe su ON su.symbol = ec.symbol
       ${whereClause}
       ORDER BY ec.symbol,
                ec.earnings_date ASC,
                ec.source_priority DESC,
                ec.last_verified_at DESC
       LIMIT ${limitPlaceholder}`,
      params
    );

    return result.rows;
  } catch (error) {
    console.error('Error searching upcoming earnings symbols:', error);
    throw error;
  }
}

export async function getUpcomingEarningsForAutoReminders(days = 14, minMarketCap = 10000000000) {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (ec.symbol)
        ec.symbol,
        ec.earnings_date,
        ec.earnings_time,
        ec.session_normalized,
        ec.timing_raw,
        ec.source,
        ec.timing_source,
        ec.last_updated,
        ec.last_verified_at,
        su.company_name,
        su.market_cap
       FROM earnings_calendar ec
       JOIN stock_universe su ON su.symbol = ec.symbol
       WHERE ec.earnings_date >= CURRENT_DATE
         AND ec.earnings_date <= CURRENT_DATE + ($1::text || ' days')::interval
         AND COALESCE(su.market_cap, 0) >= $2
         AND su.status = 'active'
         AND COALESCE(su.earnings_tracking_eligible, TRUE) = TRUE
       ORDER BY ec.symbol, ec.earnings_date ASC, ec.source_priority DESC, ec.last_verified_at DESC`,
      [days, minMarketCap]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching upcoming earnings for auto reminders:', error);
    throw error;
  }
}

export async function getActiveEarningsReminder(symbol) {
  try {
    const result = await pool.query(
      `SELECT er.*,
              sw.primary_pathway,
              sw.secondary_pathways,
              sw.analysis_ready,
              sw.selection_source,
              sw.selection_rank_within_pathway,
              sw.review_priority
       FROM earnings_reminders er
       LEFT JOIN LATERAL (
         SELECT primary_pathway, secondary_pathways, analysis_ready, selection_source, selection_rank_within_pathway, review_priority
         FROM saturday_watchlist
         WHERE symbol = $1
         ORDER BY CASE WHEN status = 'active' THEN 0 WHEN status = 'pending' THEN 1 ELSE 2 END,
                  COALESCE(opus_conviction, score, 0) DESC,
                  added_date DESC
         LIMIT 1
       ) sw ON TRUE
       WHERE er.symbol = $1
         AND er.status = 'active'
       ORDER BY er.updated_at DESC
       LIMIT 1`,
      [symbol]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error(`Error fetching active earnings reminder for ${symbol}:`, error);
    throw error;
  }
}

export async function getAllActiveEarningsReminders() {
  try {
    const result = await pool.query(
      `SELECT er.*,
              sw.primary_pathway,
              sw.secondary_pathways,
              sw.analysis_ready,
              sw.selection_source,
              sw.selection_rank_within_pathway,
              sw.review_priority
       FROM earnings_reminders er
       LEFT JOIN LATERAL (
         SELECT primary_pathway, secondary_pathways, analysis_ready, selection_source, selection_rank_within_pathway, review_priority
         FROM saturday_watchlist
         WHERE symbol = er.symbol
         ORDER BY CASE WHEN status = 'active' THEN 0 WHEN status = 'pending' THEN 1 ELSE 2 END,
                  COALESCE(opus_conviction, score, 0) DESC,
                  added_date DESC
         LIMIT 1
       ) sw ON TRUE
       WHERE er.status = 'active'
         AND er.earnings_date >= CURRENT_DATE
         AND er.earnings_date <= CURRENT_DATE + INTERVAL '7 days'
       ORDER BY er.scheduled_send_at ASC NULLS LAST, er.earnings_date ASC, er.symbol ASC`
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching active earnings reminders:', error);
    throw error;
  }
}

export async function getUpcomingEarningsDashboardRows(days = 1) {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (ec.symbol)
        ec.symbol,
        ec.earnings_date,
        ec.earnings_time,
        ec.session_normalized,
        ec.timing_raw,
        ec.source,
        ec.timing_source,
        ec.last_updated,
        ec.last_verified_at,
        su.company_name,
        su.market_cap,
        er.id AS reminder_id,
        er.status,
        er.notes,
        er.earnings_session,
        er.earnings_time_raw,
        er.earnings_session_source,
        er.scheduled_send_at,
        er.predictor_run_at,
        er.predictor_snapshot_price,
        er.predicted_direction,
        er.predicted_confidence,
        er.prediction_reasoning,
        er.prediction_key_risk,
        er.grade_result,
        er.actual_reaction_pct,
        sw.primary_pathway,
        sw.secondary_pathways
       FROM earnings_calendar ec
       LEFT JOIN stock_universe su ON su.symbol = ec.symbol
       LEFT JOIN LATERAL (
         SELECT *
         FROM earnings_reminders er
         WHERE er.symbol = ec.symbol
           AND er.earnings_date = ec.earnings_date
         ORDER BY er.updated_at DESC
         LIMIT 1
       ) er ON TRUE
       LEFT JOIN LATERAL (
         SELECT primary_pathway, secondary_pathways
         FROM saturday_watchlist
         WHERE symbol = ec.symbol
         ORDER BY CASE WHEN status = 'active' THEN 0 WHEN status = 'pending' THEN 1 ELSE 2 END,
                  COALESCE(opus_conviction, score, 0) DESC,
                  added_date DESC
         LIMIT 1
       ) sw ON TRUE
       WHERE ec.earnings_date >= CURRENT_DATE
         AND ec.earnings_date <= CURRENT_DATE + ($1::text || ' days')::interval
         AND ec.session_normalized IN ('pre_market', 'post_market')
       ORDER BY ec.symbol,
                ec.earnings_date ASC,
                ec.source_priority DESC,
                ec.last_verified_at DESC`,
      [days]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching earnings dashboard rows:', error);
    throw error;
  }
}

export async function getRemindersDueForSend(now = new Date()) {
  try {
    const result = await pool.query(
      `SELECT er.*
       FROM earnings_reminders er
       JOIN LATERAL (
         SELECT ec.earnings_date
         FROM earnings_calendar ec
         WHERE ec.symbol = er.symbol
           AND ec.earnings_date >= CURRENT_DATE
         ORDER BY ec.earnings_date ASC, ec.source_priority DESC, ec.last_verified_at DESC
         LIMIT 1
       ) next_event ON TRUE
       WHERE er.status = 'active'
         AND er.scheduled_send_at IS NOT NULL
         AND er.scheduled_send_at <= $1
         AND er.earnings_date = next_event.earnings_date
         AND er.earnings_date >= CURRENT_DATE
       ORDER BY er.scheduled_send_at ASC, er.symbol ASC`,
      [now]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching due earnings reminders:', error);
    throw error;
  }
}

export async function expireStaleEarningsReminders() {
  try {
    const result = await pool.query(
      `UPDATE earnings_reminders er
       SET status = 'expired',
           updated_at = CURRENT_TIMESTAMP
       WHERE er.status = 'active'
         AND (
           er.earnings_date < CURRENT_DATE
           OR NOT EXISTS (
             SELECT 1
             FROM earnings_calendar ec
             WHERE ec.symbol = er.symbol
               AND ec.earnings_date = er.earnings_date
               AND ec.earnings_date >= CURRENT_DATE
           )
         )`
    );
    return result.rowCount;
  } catch (error) {
    console.error('Error expiring stale earnings reminders:', error);
    throw error;
  }
}

export async function getSentEarningsRemindersPendingGrade() {
  try {
    const result = await pool.query(
      `SELECT *
       FROM earnings_reminders
       WHERE status = 'predicted'
         AND predicted_direction IS NOT NULL
         AND grade_result IS NULL
         AND (
           (earnings_session = 'pre_market' AND NOW() >= ((earnings_date::timestamp) + INTERVAL '11 hours'))
           OR
           (earnings_session <> 'pre_market' AND NOW() >= (
             CASE EXTRACT(ISODOW FROM earnings_date)
               WHEN 5 THEN (earnings_date::timestamp + INTERVAL '3 days')
               WHEN 6 THEN (earnings_date::timestamp + INTERVAL '2 days')
               ELSE (earnings_date::timestamp + INTERVAL '1 day')
             END
           ) + INTERVAL '11 hours')
         )
       ORDER BY predictor_run_at ASC NULLS LAST, symbol ASC`
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching sent earnings reminders pending grade:', error);
    throw error;
  }
}

export async function upsertEarningsReminder(payload) {
  const {
    symbol,
    earningsDate,
    earningsTimeRaw = null,
    earningsSession = 'unknown',
    earningsSessionSource = 'unknown',
    catalystSummary = null,
    notes = null,
    scheduledSendAt = null,
    emailEnabled = true
  } = payload;

  try {
    const existing = await getActiveEarningsReminder(symbol);

    if (existing) {
      const result = await pool.query(
        `UPDATE earnings_reminders
         SET earnings_date = $2,
             earnings_time_raw = $3,
             earnings_session = $4,
             earnings_session_source = $5,
             catalyst_summary = $6,
             notes = $7,
             scheduled_send_at = $8,
             email_enabled = $9,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [
          existing.id,
          earningsDate,
          earningsTimeRaw,
          earningsSession,
          earningsSessionSource,
          catalystSummary,
          notes,
          scheduledSendAt,
          emailEnabled
        ]
      );
      return result.rows[0];
    }

    const result = await pool.query(
      `INSERT INTO earnings_reminders (
        symbol,
        status,
        earnings_date,
        earnings_time_raw,
        earnings_session,
        earnings_session_source,
        catalyst_summary,
        notes,
        scheduled_send_at,
        email_enabled
      ) VALUES ($1, 'active', $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        symbol,
        earningsDate,
        earningsTimeRaw,
        earningsSession,
        earningsSessionSource,
        catalystSummary,
        notes,
        scheduledSendAt,
        emailEnabled
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error(`Error upserting earnings reminder for ${symbol}:`, error);
    throw error;
  }
}

export async function enrichEarningTiming(symbol, earningsDate, timing = {}) {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  if (!normalizedSymbol || !earningsDate) return null;

  const sessionNormalized = timing.earningsSession || 'unknown';
  const timingRaw = timing.earningsTimeRaw || null;
  const timingSource = timing.source || 'earnings_whispers';
  const sourcePriority = timingSource === 'manual' ? 300 : (timingSource === 'yahoo' || timingSource === 'earnings_whispers') ? 200 : 100;
  const manualOverride = timingSource === 'manual';

  try {
    const result = await pool.query(
      `UPDATE earnings_calendar
       SET earnings_time = CASE
             WHEN manual_override AND NOT $6 THEN earnings_time
             ELSE COALESCE($3, earnings_time)
           END,
           timing_raw = CASE
             WHEN manual_override AND NOT $6 THEN timing_raw
             ELSE COALESCE($4, timing_raw)
           END,
           session_normalized = CASE
             WHEN manual_override AND NOT $6 THEN session_normalized
             ELSE COALESCE($5, session_normalized)
           END,
           timing_source = CASE
             WHEN manual_override AND NOT $6 THEN timing_source
             ELSE $2
           END,
           source = CASE
             WHEN manual_override AND NOT $6 THEN source
             ELSE CASE
               WHEN source_primary = 'fmp' THEN source
               ELSE $2
             END
           END,
           source_priority = CASE
             WHEN manual_override AND NOT $6 THEN source_priority
             ELSE $7
           END,
           last_verified_at = CURRENT_TIMESTAMP,
           last_updated = CURRENT_TIMESTAMP,
           manual_override = manual_override OR $6
       WHERE symbol = $1
         AND earnings_date = $8
       RETURNING *`,
      [
        normalizedSymbol,
        timingSource,
        timingRaw,
        timingRaw,
        sessionNormalized,
        manualOverride,
        sourcePriority,
        earningsDate
      ]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error(`Error enriching earnings timing for ${normalizedSymbol}:`, error);
    throw error;
  }
}

export async function markEarningsReminderPredicted(id, predictedAt, predictionData = {}) {
  try {
    const result = await pool.query(
      `UPDATE earnings_reminders
       SET status = 'predicted',
           email_sent_at = NULL::timestamp,
           predictor_run_at = $2,
           predictor_snapshot_price = $3,
           predicted_direction = $4,
           predicted_confidence = $5,
           prediction_reasoning = $6,
           prediction_catalyst_summary = $7,
           prediction_key_risk = $8,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [
        id,
        predictionData.predictorRunAt || predictedAt,
        predictionData.snapshotPrice ?? null,
        predictionData.direction || null,
        predictionData.confidence || null,
        predictionData.reasoning || null,
        predictionData.catalystSummary || null,
        predictionData.keyRisk || null
      ]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error(`Error marking earnings reminder ${id} as predicted:`, error);
    throw error;
  }
}

export async function saveEarningsReminderGrade(id, gradePayload = {}) {
  try {
    const result = await pool.query(
      `UPDATE earnings_reminders
       SET status = 'graded',
           actual_reaction_direction = $2,
           actual_reaction_pct = $3,
           grade_result = $4,
           graded_at = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [
        id,
        gradePayload.actualReactionDirection || null,
        gradePayload.actualReactionPct ?? null,
        gradePayload.gradeResult || null,
        gradePayload.gradedAt || new Date()
      ]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error(`Error saving earnings reminder grade for ${id}:`, error);
    throw error;
  }
}

/**
 * Clean up old earnings (past dates)
 */
export async function cleanupOldEarnings() {
  try {
    const result = await pool.query(
      `DELETE FROM earnings_calendar
       WHERE earnings_date < CURRENT_DATE`
    );
    console.log(`🧹 Cleaned up ${result.rowCount} old earnings dates`);
    return result.rowCount;
  } catch (error) {
    console.error('Error cleaning up old earnings:', error);
    throw error;
  }
}

/**
 * Create a position lot
 */
export async function createPositionLot(lot) {
  try {
    const result = await pool.query(
      `INSERT INTO position_lots (
        symbol, lot_type, quantity, cost_basis, current_price,
        entry_date, stop_loss, take_profit, oco_order_id, thesis,
        days_to_long_term, original_intent, current_intent, position_type,
        pathway, strategy_type, thesis_state, holding_posture, holding_period,
        secondary_pathways, pathway_selection_rule,
        confidence, growth_potential, stop_type, target_type, trailing_stop_pct,
        rebalance_threshold_pct, max_holding_days, fundamental_stop_conditions,
        catalysts, news_links
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31)
      RETURNING *`,
      [
        lot.symbol,
        lot.lot_type,
        lot.quantity,
        lot.cost_basis,
        lot.current_price || lot.cost_basis,
        lot.entry_date || new Date().toISOString().split('T')[0],
        lot.stop_loss,
        lot.take_profit,
        lot.oco_order_id || null,
        lot.thesis || null,
        lot.lot_type === 'long-term' ? 365 : null,
        lot.original_intent || null,
        lot.current_intent || lot.original_intent || null,
        lot.position_type || (lot.quantity < 0 ? 'short' : 'long'),
        lot.pathway || null,
        lot.strategy_type || null,
        lot.thesis_state || null,
        lot.holding_posture || null,
        lot.holding_period || null,
        lot.secondary_pathways ? JSON.stringify(lot.secondary_pathways) : JSON.stringify([]),
        lot.pathway_selection_rule || (lot.pathway ? 'lot_primary_pathway' : 'unclassified'),
        lot.confidence || null,
        lot.growth_potential || null,
        lot.stop_type || null,
        lot.target_type || null,
        lot.trailing_stop_pct ?? null,
        lot.rebalance_threshold_pct ?? null,
        lot.max_holding_days ?? null,
        lot.fundamental_stop_conditions ? JSON.stringify(lot.fundamental_stop_conditions) : null,
        lot.catalysts ? JSON.stringify(lot.catalysts) : null,
        lot.news_links ? JSON.stringify(lot.news_links) : null
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error creating position lot:', error);
    throw error;
  }
}

/**
 * Get all lots for a symbol
 */
export async function getPositionLots(symbol) {
  try {
    const result = await pool.query(
      `SELECT * FROM position_lots
       WHERE symbol = $1
       ORDER BY created_at ASC`,
      [symbol]
    );
    return result.rows;
  } catch (error) {
    console.error(`Error fetching lots for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Get a specific lot by ID
 */
export async function getPositionLot(lotId) {
  try {
    const result = await pool.query(
      `SELECT * FROM position_lots WHERE id = $1`,
      [lotId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error(`Error fetching lot ${lotId}:`, error);
    throw error;
  }
}

/**
 * Update a position lot
 */
export async function updatePositionLot(lotId, updates) {
  try {
    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.entries(updates).forEach(([key, value]) => {
      fields.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    });

    values.push(lotId);

    const result = await pool.query(
      `UPDATE position_lots
       SET ${fields.join(', ')}, last_reviewed = CURRENT_TIMESTAMP
       WHERE id = $${paramCount}
       RETURNING *`,
      values
    );

    return result.rows[0];
  } catch (error) {
    console.error(`Error updating lot ${lotId}:`, error);
    throw error;
  }
}

/**
 * Delete a position lot
 */
export async function deletePositionLot(lotId) {
  try {
    await pool.query(`DELETE FROM position_lots WHERE id = $1`, [lotId]);
    console.log(`Deleted lot ${lotId}`);
  } catch (error) {
    console.error(`Error deleting lot ${lotId}:`, error);
    throw error;
  }
}

/**
 * Get all position lots (for daily updates)
 */
export async function getAllPositionLots() {
  try {
    const result = await pool.query(
      `SELECT * FROM position_lots
       WHERE quantity > 0
       ORDER BY symbol, lot_type`
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching all lots:', error);
    throw error;
  }
}

/**
 * Update days held for all lots (run daily)
 */
export async function updateDaysHeld() {
  try {
    const result = await pool.query(
      `UPDATE position_lots
       SET days_held = CURRENT_DATE - entry_date,
           days_to_long_term = CASE
             WHEN lot_type = 'long-term' THEN GREATEST(0, 365 - (CURRENT_DATE - entry_date))
             ELSE NULL
           END
       WHERE quantity > 0`
    );
    console.log(`Updated days_held for ${result.rowCount} lots`);
    return result.rowCount;
  } catch (error) {
    console.error('Error updating days held:', error);
    throw error;
  }
}

/**
 * Upsert stock to universe
 */
export async function upsertStockUniverse(stock) {
  try {
    const result = await pool.query(
      `INSERT INTO stock_universe (
         symbol, company_name, sector, industry, market_cap, market_cap_tier,
         price, shortable, last_etb_check, is_growth_candidate, universe_bucket,
         source_primary, source_last_synced_at, price_last_updated_at, universe_reason,
         analysis_eligible, discovery_eligible, earnings_tracking_eligible, liquidity_score, data_quality_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       ON CONFLICT (symbol)
       DO UPDATE SET
         company_name = $2,
         sector = $3,
         industry = $4,
         market_cap = $5,
         market_cap_tier = $6,
         price = $7,
         shortable = $8,
         last_etb_check = $9,
         is_growth_candidate = $10,
         universe_bucket = $11,
         source_primary = $12,
         source_last_synced_at = $13,
         price_last_updated_at = $14,
         universe_reason = $15,
         analysis_eligible = $16,
         discovery_eligible = $17,
         earnings_tracking_eligible = $18,
         liquidity_score = $19,
         data_quality_status = $20,
         status = 'active'
       RETURNING *`,
      [
        stock.symbol,
        stock.company_name || stock.companyName,
        stock.sector,
        stock.industry,
        stock.market_cap || stock.marketCap,
        stock.market_cap_tier || 'large',
        stock.price,
        stock.shortable || false,
        stock.last_etb_check || null,
        stock.is_growth_candidate || false,
        stock.universe_bucket || 'core',
        stock.source_primary || 'fmp',
        stock.source_last_synced_at || new Date(),
        stock.price_last_updated_at || new Date(),
        stock.universe_reason || (stock.universe_bucket === 'growth_expansion' ? 'growth_expansion' : 'core_market_cap'),
        stock.analysis_eligible ?? true,
        stock.discovery_eligible ?? (stock.universe_bucket === 'growth_expansion'),
        stock.earnings_tracking_eligible ?? true,
        stock.liquidity_score || 'unknown',
        stock.data_quality_status || 'ok'
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error(`Error upserting stock ${stock.symbol}:`, error);
    throw error;
  }
}

/**
 * Get all active stocks from universe
 */
export async function getStockUniverse() {
  try {
    const result = await pool.query(
      `SELECT * FROM stock_universe WHERE status = 'active' ORDER BY symbol`
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching stock universe:', error);
    throw error;
  }
}

/**
 * Mark stock as removed
 */
export async function removeStockFromUniverse(symbol) {
  try {
    await pool.query(
      `UPDATE stock_universe SET status = 'removed', removed_date = CURRENT_TIMESTAMP WHERE symbol = $1`,
      [symbol]
    );
  } catch (error) {
    console.error(`Error removing stock ${symbol}:`, error);
    throw error;
  }
}

/**
 * Update ETB status for stock
 */
export async function updateETBStatus(symbol, shortable) {
  try {
    const result = await pool.query(
      `UPDATE stock_universe
       SET shortable = $2, last_etb_check = CURRENT_TIMESTAMP
       WHERE symbol = $1
       RETURNING *`,
      [symbol, shortable]
    );
    return result.rows[0];
  } catch (error) {
    console.error(`Error updating ETB status for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Log cron job execution start
 */
export async function logCronJobStart(jobName, jobType, scheduledTime) {
  try {
    const result = await pool.query(
      `INSERT INTO cron_job_executions (job_name, job_type, scheduled_time, started_at, status)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 'running')
       RETURNING id`,
      [jobName, jobType, scheduledTime]
    );
    return result.rows[0].id;
  } catch (error) {
    console.error('Error logging cron job start:', error);
    throw error;
  }
}

/**
 * Log cron job execution completion
 */
export async function logCronJobComplete(jobId, success, errorMessage = null) {
  try {
    const status = success ? 'completed' : 'failed';
    await pool.query(
      `UPDATE cron_job_executions
       SET completed_at = CURRENT_TIMESTAMP,
           status = $2,
           error_message = $3,
           duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at))
       WHERE id = $1`,
      [jobId, status, errorMessage]
    );
  } catch (error) {
    console.error('Error logging cron job completion:', error);
    throw error;
  }
}

export async function logTavilyUsageEvent(payload = {}) {
  const {
    activity = 'unknown',
    symbol = null,
    query = '',
    topic = null,
    searchDepth = null,
    maxResults = null,
    resultCount = 0,
    cacheHit = false,
    context = {}
  } = payload;

  try {
    await pool.query(
      `INSERT INTO tavily_usage_events (
        activity, symbol, query, topic, search_depth, max_results, result_count, cache_hit, context
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        String(activity || 'unknown'),
        symbol ? String(symbol).toUpperCase() : null,
        String(query || ''),
        topic || null,
        searchDepth || null,
        Number.isFinite(Number(maxResults)) ? Number(maxResults) : null,
        Number.isFinite(Number(resultCount)) ? Number(resultCount) : 0,
        Boolean(cacheHit),
        JSON.stringify(context || {})
      ]
    );
  } catch (error) {
    console.error('Error logging Tavily usage event:', error);
  }
}

/**
 * Get recent cron job executions
 */
export async function getCronJobExecutions(days = 7) {
  try {
    const result = await pool.query(
      `SELECT * FROM cron_job_executions
       WHERE scheduled_time >= CURRENT_DATE - INTERVAL '${days} days'
       ORDER BY scheduled_time DESC, job_name ASC`
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching cron job executions:', error);
    throw error;
  }
}

/**
 * Export query function for direct database access
 */
export async function query(text, params) {
  return pool.query(text, params);
}

export async function getLatestStockProfile(symbol) {
  const result = await pool.query(
    `SELECT * FROM stock_profiles WHERE symbol = $1`,
    [symbol]
  );
  return result.rows[0] || null;
}

export async function getLatestSaturdayWatchlistEntry(symbol) {
  const result = await pool.query(
    `SELECT *
     FROM saturday_watchlist
     WHERE symbol = $1
     ORDER BY added_date DESC NULLS LAST
     LIMIT 1`,
    [symbol]
  );
  return result.rows[0] || null;
}

export async function getLatestPendingApprovalForSymbol(symbol) {
  const result = await pool.query(
    `SELECT *
     FROM trade_approvals
     WHERE symbol = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [symbol]
  );
  return result.rows[0] || null;
}

export async function saveOptionsAnalysisRun(run) {
  const result = await pool.query(
    `INSERT INTO options_analysis_runs (
      symbol, intent_horizon, underlying_price, recommendation_type, strategy_type,
      direction_call, conviction, thesis_summary, catalysts, risks, warnings,
      guardrails, profile_version, result_payload
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10, $11,
      $12, $13, $14
    )
    RETURNING *`,
    [
      run.symbol,
      run.intent_horizon,
      run.underlying_price ?? null,
      run.recommendation_type ?? null,
      run.strategy_type ?? null,
      run.direction_call ?? null,
      run.conviction ?? null,
      run.thesis_summary ?? null,
      JSON.stringify(run.catalysts || {}),
      JSON.stringify(run.risks || []),
      JSON.stringify(run.warnings || []),
      JSON.stringify(run.guardrails || []),
      run.profile_version ?? null,
      JSON.stringify(run.result_payload || {})
    ]
  );

  return result.rows[0];
}

export async function getRecentOptionsAnalysisRuns(limit = 20) {
  try {
    const result = await pool.query(
      `SELECT *
       FROM options_analysis_runs
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  } catch (error) {
    if (error?.code === '42703') {
      const fallback = await pool.query(
        `SELECT *,
                CURRENT_TIMESTAMP AS created_at
         FROM options_analysis_runs
         ORDER BY id DESC
         LIMIT $1`,
        [limit]
      );
      return fallback.rows;
    }
    throw error;
  }
}

/**
 * Get sector and industry for a symbol from stock_universe
 * Returns null if symbol not found
 */
export async function getStockInfo(symbol) {
  try {
    const result = await pool.query(
      'SELECT company_name, sector, industry, market_cap FROM stock_universe WHERE symbol = $1',
      [symbol]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error(`Error fetching stock info for ${symbol}:`, error);
    return null;
  }
}


export async function expireSaturdayWatchlistStatuses(statuses = ['active', 'pending', 'promoted'], reason = 'weekly_refresh') {
  try {
    const result = await pool.query(
      `UPDATE saturday_watchlist
       SET status = 'expired',
           promotion_status = CASE
             WHEN promotion_status = 'promoted' THEN 'expired'
             ELSE promotion_status
           END,
           promotion_reason = COALESCE(promotion_reason, $2),
           expires_at = CURRENT_TIMESTAMP
       WHERE status = ANY($1::text[])`,
      [statuses, reason]
    );
    return result.rowCount;
  } catch (error) {
    console.error('Error expiring saturday watchlist statuses:', error);
    throw error;
  }
}

export async function cleanupExpiredPromotions(daysOld = 7) {
  try {
    const result = await pool.query(
      `UPDATE saturday_watchlist
       SET status = 'expired',
           promotion_status = 'expired',
           expires_at = CURRENT_TIMESTAMP
       WHERE promotion_status = 'promoted'
         AND promoted_at IS NOT NULL
         AND promoted_at < NOW() - ($1::text || ' days')::interval`,
      [daysOld]
    );
    return result.rowCount;
  } catch (error) {
    console.error('Error cleaning up expired promotions:', error);
    throw error;
  }
}

export async function cleanupDailySymbolState(daysOld = 30) {
  try {
    const result = await pool.query(
      `DELETE FROM daily_symbol_state
       WHERE run_date < CURRENT_DATE - ($1::text || ' days')::interval`,
      [daysOld]
    );
    return result.rowCount;
  } catch (error) {
    console.error('Error cleaning up daily symbol state:', error);
    throw error;
  }
}

export async function upsertDailySymbolState(payload) {
  const {
    symbol,
    runDate,
    runTime,
    runType,
    reviewDepth = 'deep',
    primaryPathway = null,
    secondaryPathways = [],
    source = 'watchlist',
    sourceReasons = null,
    lastAction = null,
    lastConfidence = null,
    thesisState = null,
    holdingPosture = null,
    whatChanged = null,
    newsFingerprint = null,
    technicalFingerprint = null,
    catalystFingerprint = null,
    thesisSummary = null,
    catalystSummary = null,
    earningsDate = null,
    insiderSignal = null,
    nextReviewDue = null,
    escalationReason = null,
    changeMagnitude = null,
    reviewReasonCode = null,
    materialChangeDetected = false,
    candidateBucketAtRun = null,
    decisionRunId = null,
    stateVersion = 1
  } = payload;

  try {
    const result = await pool.query(
      `INSERT INTO daily_symbol_state (
        symbol, run_date, run_time, run_type, review_depth, primary_pathway, secondary_pathways, source,
        source_reasons, last_action, last_confidence, thesis_state, holding_posture, what_changed,
        news_fingerprint, technical_fingerprint, catalyst_fingerprint, thesis_summary, catalyst_summary,
        earnings_date, insider_signal, next_review_due, escalation_reason, change_magnitude,
        review_reason_code, material_change_detected, candidate_bucket_at_run, decision_run_id, state_version, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8,
        $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24,
        $25, $26, $27, $28, $29, CURRENT_TIMESTAMP
      )
      ON CONFLICT (symbol, run_date, run_time)
      DO UPDATE SET
        run_type = EXCLUDED.run_type,
        review_depth = EXCLUDED.review_depth,
        primary_pathway = EXCLUDED.primary_pathway,
        secondary_pathways = EXCLUDED.secondary_pathways,
        source = EXCLUDED.source,
        source_reasons = EXCLUDED.source_reasons,
        last_action = EXCLUDED.last_action,
        last_confidence = EXCLUDED.last_confidence,
        thesis_state = EXCLUDED.thesis_state,
        holding_posture = EXCLUDED.holding_posture,
        what_changed = EXCLUDED.what_changed,
        news_fingerprint = EXCLUDED.news_fingerprint,
        technical_fingerprint = EXCLUDED.technical_fingerprint,
        catalyst_fingerprint = EXCLUDED.catalyst_fingerprint,
        thesis_summary = EXCLUDED.thesis_summary,
        catalyst_summary = EXCLUDED.catalyst_summary,
        earnings_date = EXCLUDED.earnings_date,
        insider_signal = EXCLUDED.insider_signal,
        next_review_due = EXCLUDED.next_review_due,
        escalation_reason = EXCLUDED.escalation_reason,
        change_magnitude = EXCLUDED.change_magnitude,
        review_reason_code = EXCLUDED.review_reason_code,
        material_change_detected = EXCLUDED.material_change_detected,
        candidate_bucket_at_run = EXCLUDED.candidate_bucket_at_run,
        decision_run_id = EXCLUDED.decision_run_id,
        state_version = EXCLUDED.state_version,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        symbol,
        runDate,
        runTime,
        runType,
        reviewDepth,
        primaryPathway,
        JSON.stringify(secondaryPathways || []),
        source,
        sourceReasons,
        lastAction,
        lastConfidence,
        thesisState,
        holdingPosture,
        whatChanged,
        newsFingerprint,
        technicalFingerprint,
        catalystFingerprint,
        thesisSummary,
        catalystSummary,
        earningsDate,
        insiderSignal,
        nextReviewDue,
        escalationReason,
        changeMagnitude,
        reviewReasonCode,
        materialChangeDetected,
        candidateBucketAtRun,
        decisionRunId,
        stateVersion
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error upserting daily symbol state:', error);
    throw error;
  }
}

export async function getLatestDailySymbolStates(symbols = [], runDate = null) {
  try {
    const params = [];
    let filters = '';

    if (Array.isArray(symbols) && symbols.length > 0) {
      params.push(symbols);
      filters += ` AND symbol = ANY($${params.length})`;
    }

    if (runDate) {
      params.push(runDate);
      filters += ` AND run_date = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT DISTINCT ON (symbol) *
       FROM daily_symbol_state
       WHERE 1 = 1 ${filters}
       ORDER BY symbol, run_date DESC, run_time DESC`,
      params
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching latest daily symbol states:', error);
    throw error;
  }
}

export async function getActiveSaturdayWatchlist({ includePromoted = true } = {}) {
  try {
    const result = await pool.query(
      `SELECT *
       FROM saturday_watchlist
       WHERE status = 'active'
          OR ($1 = TRUE AND promotion_status = 'promoted' AND status IN ('pending', 'active'))
       ORDER BY COALESCE(opus_conviction, score, 0) DESC, added_date DESC`,
      [includePromoted]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching active saturday watchlist:', error);
    throw error;
  }
}

const PATHWAY_PRIORITY = [
  'deepValue',
  'cashMachine',
  'qarp',
  'qualityCompounder',
  'highGrowth',
  'inflection',
  'turnaround',
  'overvalued',
  'deteriorating',
  'overextended',
  'discovery'
];

function getPathwayPriority(pathway) {
  const index = PATHWAY_PRIORITY.indexOf(pathway);
  return index === -1 ? 999 : index;
}

export function pickCanonicalPathway(matchRows = []) {
  const normalized = (matchRows || []).filter(Boolean);
  if (normalized.length === 0) {
    return {
      primaryPathway: null,
      secondaryPathways: [],
      scoreSnapshot: {},
      selectionRule: 'no_pathway_matches'
    };
  }

  const sorted = [...normalized].sort((a, b) => {
    const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return getPathwayPriority(a.pathway) - getPathwayPriority(b.pathway);
  });

  const primary = sorted[0];
  return {
    primaryPathway: primary.pathway || null,
    secondaryPathways: sorted.slice(1).map(row => row.pathway).filter(Boolean),
    scoreSnapshot: Object.fromEntries(sorted.map(row => [row.pathway, Number(row.score || 0)])),
    selectionRule: sorted.length > 1 ? 'highest_score_then_priority' : 'single_pathway_match'
  };
}

export async function getCanonicalSaturdayWatchlistRows(statuses = ['active'], { includePromoted = true } = {}) {
  try {
    const result = await pool.query(
      `SELECT *
       FROM saturday_watchlist
       WHERE status = ANY($1::text[])
          OR ($2 = TRUE AND promotion_status = 'promoted' AND status IN ('pending', 'active'))
       ORDER BY COALESCE(opus_conviction, score, 0) DESC, added_date DESC`,
      [statuses, includePromoted]
    );

    const bySymbol = new Map();
    for (const row of result.rows) {
      if (!bySymbol.has(row.symbol)) {
        bySymbol.set(row.symbol, []);
      }
      bySymbol.get(row.symbol).push(row);
    }

    return [...bySymbol.values()].map(rows => {
      const canonical = pickCanonicalPathway(rows);
      const primaryRow = rows.find(row => row.pathway === canonical.primaryPathway) || rows[0];
      return {
        ...primaryRow,
        primary_pathway: canonical.primaryPathway,
        secondary_pathways: canonical.secondaryPathways,
        pathway_scores_snapshot: canonical.scoreSnapshot,
        pathway_selection_rule: canonical.selectionRule,
        matched_pathways: rows.map(row => ({
          pathway: row.pathway,
          score: row.score,
          status: row.status,
          reasons: row.reasons
        }))
      };
    });
  } catch (error) {
    console.error('Error fetching canonical saturday watchlist rows:', error);
    throw error;
  }
}

export async function getPromotedDiscoveryCandidates() {
  try {
    const result = await pool.query(
      `SELECT *
       FROM saturday_watchlist
       WHERE promotion_status = 'promoted'
       ORDER BY promoted_at DESC NULLS LAST, score DESC NULLS LAST, added_date DESC`
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching promoted discovery candidates:', error);
    throw error;
  }
}

export async function promoteDiscoveryCandidate(payload) {
  const {
    symbol,
    intent = 'LONG',
    pathway = 'discovery',
    assetClass = null,
    sector = null,
    industry = null,
    score = null,
    metrics = null,
    reasons = null,
    price = null,
    promotionReason = 'discovery_trigger',
    source = 'discovery'
  } = payload;

  try {
    const result = await pool.query(
      `INSERT INTO saturday_watchlist (
        symbol, intent, pathway, asset_class, sector, industry, score, metrics, reasons, price,
        status, source, promotion_status, promotion_reason, promoted_at, added_date,
        selection_source, screening_run_at, screening_score, review_priority,
        selection_status_reason, analysis_ready, profile_required
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10,
        'pending', $11, 'promoted', $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
        'discovery_promotion', CURRENT_TIMESTAMP, $7, 80, $12, FALSE, TRUE
      )
      ON CONFLICT (symbol, pathway)
      DO UPDATE SET
        intent = EXCLUDED.intent,
        asset_class = EXCLUDED.asset_class,
        sector = EXCLUDED.sector,
        industry = EXCLUDED.industry,
        score = EXCLUDED.score,
        metrics = EXCLUDED.metrics,
        reasons = EXCLUDED.reasons,
        price = EXCLUDED.price,
        status = 'pending',
        source = EXCLUDED.source,
        promotion_status = 'promoted',
        promotion_reason = EXCLUDED.promotion_reason,
        promoted_at = CURRENT_TIMESTAMP,
        selection_source = 'discovery_promotion',
        screening_run_at = COALESCE(saturday_watchlist.screening_run_at, CURRENT_TIMESTAMP),
        screening_score = EXCLUDED.score,
        review_priority = GREATEST(COALESCE(saturday_watchlist.review_priority, 50), 80),
        selection_status_reason = EXCLUDED.promotion_reason,
        analysis_ready = FALSE,
        profile_required = TRUE
      RETURNING *`,
      [symbol, intent, pathway, assetClass, sector, industry, score, metrics ? JSON.stringify(metrics) : null, reasons, price, source, promotionReason]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error promoting discovery candidate:', error);
    throw error;
  }
}

export default pool;
