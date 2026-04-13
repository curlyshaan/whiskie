import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

/**
 * Database connection pool
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // Maximum number of connections in pool
  idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
  connectionTimeoutMillis: 2000, // Fail fast if can't connect within 2 seconds
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
  const client = await pool.connect();

  try {
    console.log('📊 Initializing database schema...');

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
        stock_type VARCHAR(30),
        position_type VARCHAR(10) DEFAULT 'long',
        entry_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        trimmed_1 BOOLEAN DEFAULT FALSE,
        trimmed_2 BOOLEAN DEFAULT FALSE,
        trimmed_3 BOOLEAN DEFAULT FALSE,
        stop_loss DECIMAL(10, 2),
        take_profit DECIMAL(10, 2),
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
      CREATE INDEX IF NOT EXISTS idx_earnings_symbol ON earnings_calendar(symbol);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_earnings_date ON earnings_calendar(earnings_date);
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
      ADD COLUMN IF NOT EXISTS days_to_long_term INTEGER,
      ADD COLUMN IF NOT EXISTS next_earnings_date DATE,
      ADD COLUMN IF NOT EXISTS trim_history JSONB,
      ADD COLUMN IF NOT EXISTS oco_order_id VARCHAR(50),
      ADD COLUMN IF NOT EXISTS order_modification_history JSONB,
      ADD COLUMN IF NOT EXISTS asset_class VARCHAR(50);
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
      CREATE INDEX IF NOT EXISTS idx_stock_profiles_quality ON stock_profiles(quality_flag);
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
        trade.quantity * trade.price,
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
      `INSERT INTO positions (symbol, quantity, cost_basis, current_price, sector, stock_type, stop_loss, take_profit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (symbol)
       DO UPDATE SET
         quantity = $2,
         cost_basis = $3,
         current_price = $4,
         sector = $5,
         stock_type = $6,
         stop_loss = $7,
         take_profit = $8,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        position.symbol,
        position.quantity,
        position.cost_basis,
        position.current_price,
        position.sector,
        position.stock_type,
        position.stop_loss,
        position.take_profit
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
    const result = await pool.query('SELECT * FROM positions WHERE quantity > 0 ORDER BY symbol');
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
      ? snapshotResult.rows[0].cash
      : parseFloat(process.env.INITIAL_CAPITAL || 100000);

    const totalValue = cash + positionsValue;

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
        input_tokens, output_tokens, total_tokens, cost_estimate, duration_seconds
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
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
        decision.duration_seconds || null
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
  try {
    const result = await pool.query(
      `INSERT INTO earnings_calendar (symbol, earnings_date, earnings_time, last_updated)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (symbol, earnings_date)
       DO UPDATE SET
         earnings_time = $3,
         last_updated = CURRENT_TIMESTAMP
       RETURNING *`,
      [symbol, earningsDate, earningsTime]
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
       ORDER BY earnings_date ASC
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
      `SELECT * FROM earnings_calendar
       WHERE earnings_date >= CURRENT_DATE
       AND earnings_date <= CURRENT_DATE + INTERVAL '${days} days'
       ORDER BY earnings_date ASC`,
      []
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching upcoming earnings:', error);
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
        days_to_long_term, original_intent, current_intent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
        lot.current_intent || lot.original_intent || null
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
      `INSERT INTO stock_universe (symbol, company_name, sector, industry, market_cap, market_cap_tier, price, shortable, last_etb_check)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
        stock.last_etb_check || null
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

/**
 * Get sector and industry for a symbol from stock_universe
 * Returns null if symbol not found
 */
export async function getStockInfo(symbol) {
  try {
    const result = await pool.query(
      'SELECT sector, industry FROM stock_universe WHERE symbol = $1',
      [symbol]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error(`Error fetching stock info for ${symbol}:`, error);
    return null;
  }
}

export default pool;
