import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

/**
 * Database connection pool
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
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

    // Positions table - current holdings
    await client.query(`
      CREATE TABLE IF NOT EXISTS positions (
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
      `INSERT INTO ai_decisions (decision_type, symbol, recommendation, reasoning, model_used, confidence, executed)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        decision.type,
        decision.symbol,
        decision.recommendation,
        decision.reasoning,
        decision.model,
        decision.confidence,
        decision.executed || false
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

export default pool;
