import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('💥 Unexpected database pool error:', err);
});

/**
 * Initialize complete database schema v2
 * - Dynamic FMP-based universe (7B+ market cap)
 * - New stock profile structure with history tracking
 * - Catalyst tracking (recent, upcoming, long-term)
 * - Market cap monitoring for positions
 */
export async function initDatabaseV2() {
  const client = await pool.connect();

  try {
    console.log('📊 Initializing database schema v2...\n');

    // ============================================
    // CORE TRADING TABLES
    // ============================================

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

    // Positions table - current holdings (long and short)
    await client.query(`
      CREATE TABLE IF NOT EXISTS positions (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) UNIQUE NOT NULL,
        quantity INTEGER NOT NULL,
        cost_basis DECIMAL(10, 2) NOT NULL,
        current_price DECIMAL(10, 2),
        current_market_cap BIGINT,
        sector VARCHAR(50),
        industry VARCHAR(100),
        stock_type VARCHAR(30),
        position_type VARCHAR(10) DEFAULT 'long',
        entry_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        stop_loss DECIMAL(10, 2),
        take_profit DECIMAL(10, 2),
        pathway VARCHAR(50),
        intent VARCHAR(50),
        peak_price DECIMAL(10, 2),
        trailing_stop_activated BOOLEAN DEFAULT FALSE,
        trailing_stop_distance DECIMAL(8, 4),
        strategy_type VARCHAR(50),
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
        thesis TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Position lots - granular lot tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS position_lots (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        lot_type VARCHAR(20) NOT NULL,
        position_type VARCHAR(10) DEFAULT 'long',
        quantity INTEGER NOT NULL,
        cost_basis DECIMAL(10, 2) NOT NULL,
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

    // ============================================
    // STOCK UNIVERSE (FMP-BASED, DYNAMIC)
    // ============================================

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
        is_growth_candidate BOOLEAN DEFAULT FALSE,
        universe_bucket VARCHAR(30) DEFAULT 'core',
        added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
      CREATE INDEX IF NOT EXISTS idx_stock_universe_market_cap ON stock_universe(market_cap);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_universe_status ON stock_universe(status);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_universe_growth_candidate ON stock_universe(is_growth_candidate);
    `);

    // ============================================
    // WATCHLISTS
    // ============================================

    // Main watchlist - manual entries
    await client.query(`
      CREATE TABLE IF NOT EXISTS watchlist (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        target_entry_price DECIMAL(10, 2),
        target_exit_price DECIMAL(10, 2),
        stop_loss DECIMAL(10, 2),
        thesis TEXT,
        status VARCHAR(20) DEFAULT 'active',
        last_reviewed TIMESTAMP,
        why_not_buying_now TEXT
      );
    `);

    // Saturday watchlist - Opus screening results (15 longs + 15 shorts)
    await client.query(`
      CREATE TABLE IF NOT EXISTS saturday_watchlist (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        intent VARCHAR(10) NOT NULL,
        pathway VARCHAR(30) NOT NULL,
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
      CREATE INDEX IF NOT EXISTS idx_saturday_watchlist_status ON saturday_watchlist(status);
    `);

    // ============================================
    // STOCK PROFILES (NEW STRUCTURE)
    // ============================================

    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_profiles (
        symbol VARCHAR(10) PRIMARY KEY,
        business_model TEXT,
        moats TEXT,
        competitive_advantages TEXT,
        valuation_assessment TEXT,
        fundamentals JSONB,
        risks TEXT,
        catalysts JSONB,
        catalysts_raw TEXT,
        investment_thesis TEXT,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        profile_version INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_profiles_updated ON stock_profiles(last_updated);
    `);

    // Profile history - audit trail for changes
    await client.query(`
      CREATE TABLE IF NOT EXISTS profile_history (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        change_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        field_changed VARCHAR(50) NOT NULL,
        old_value TEXT,
        new_value TEXT,
        change_reason VARCHAR(200),
        profile_version INTEGER
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_profile_history_symbol ON profile_history(symbol);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_profile_history_date ON profile_history(change_date);
    `);

    // ============================================
    // WATCHLISTS
    // ============================================

    // Main watchlist - manual entries
    await client.query(`
      CREATE TABLE IF NOT EXISTS watchlist (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        target_entry_price DECIMAL(10, 2),
        target_exit_price DECIMAL(10, 2),
        stop_loss DECIMAL(10, 2),
        thesis TEXT,
        status VARCHAR(20) DEFAULT 'active',
        last_reviewed TIMESTAMP,
        why_not_buying_now TEXT
      );
    `);

    // Saturday watchlist - Opus screening results (15 longs + 15 shorts)
    await client.query(`
      CREATE TABLE IF NOT EXISTS saturday_watchlist (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        intent VARCHAR(10) NOT NULL,
        pathway VARCHAR(30) NOT NULL,
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
      CREATE INDEX IF NOT EXISTS idx_saturday_watchlist_status ON saturday_watchlist(status);
    `);

    // ============================================
    // TRADE APPROVALS
    // ============================================

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
        rejection_reason TEXT,
        order_id VARCHAR(50)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_trade_approvals_status ON trade_approvals(status);
    `);

    // ============================================
    // AI & ANALYSIS
    // ============================================

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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ============================================
    // EARNINGS & EVENTS
    // ============================================

    await client.query(`
      CREATE TABLE IF NOT EXISTS earnings_calendar (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        earnings_date DATE NOT NULL,
        earnings_time VARCHAR(20),
        eps_estimated DECIMAL(10, 4),
        revenue_estimated BIGINT,
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

    // ============================================
    // PERFORMANCE & METRICS
    // ============================================

    await client.query(`
      CREATE TABLE IF NOT EXISTS performance_metrics (
        id SERIAL PRIMARY KEY,
        metric_name VARCHAR(100) NOT NULL,
        metric_value JSONB,
        period VARCHAR(20),
        calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(metric_name, period)
      );
    `);

    // ============================================
    // SYSTEM TABLES
    // ============================================

    await client.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
        alert_type VARCHAR(50) NOT NULL,
        symbol VARCHAR(10),
        message TEXT NOT NULL,
        severity VARCHAR(20) DEFAULT 'info',
        acknowledged BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS cron_job_executions (
        id SERIAL PRIMARY KEY,
        job_name VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        error_message TEXT,
        execution_time_ms INTEGER
      );
    `);

    console.log('✅ Database schema v2 initialized successfully\n');
    console.log('📋 Tables created:');
    console.log('   - Core: trades, positions, position_lots, portfolio_snapshots');
    console.log('   - Universe: stock_universe (FMP-based, 7B+ market cap)');
    console.log('   - Profiles: stock_profiles, profile_history');
    console.log('   - Watchlists: watchlist, saturday_watchlist');
    console.log('   - Trading: trade_approvals');
    console.log('   - Analysis: ai_decisions, earnings_calendar');
    console.log('   - System: alerts, performance_metrics, cron_job_executions');

  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

export { pool };
export default { initDatabaseV2, pool };
