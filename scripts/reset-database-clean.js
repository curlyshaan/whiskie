import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

/**
 * Reset all database tables (except stock_universe which has hardcoded 365 stocks)
 * This clears all trading data for a fresh start
 */

async function resetDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🗑️  Starting database reset...\n');

    // Tables to clear (in order to respect foreign key constraints)
    const tablesToClear = [
      'pending_approvals',
      'alerts',
      'performance_metrics',
      'portfolio_snapshots',
      'ai_decisions',
      'position_lots',
      'positions',
      'trades',
      'watchlist',
      'earnings_calendar',
      'stock_analysis_history',
      'market_trend_patterns',
      'learning_insights'
    ];

    for (const table of tablesToClear) {
      try {
        const result = await pool.query(`DELETE FROM ${table}`);
        console.log(`✅ Cleared ${table}: ${result.rowCount} rows deleted`);
      } catch (error) {
        if (error.code === '42P01') {
          console.log(`⚠️  Table ${table} does not exist (skipping)`);
        } else {
          console.error(`❌ Error clearing ${table}:`, error.message);
        }
      }
    }

    // Reset sequences to start IDs from 1
    const sequencesToReset = [
      'trades_id_seq',
      'positions_id_seq',
      'portfolio_snapshots_id_seq',
      'ai_decisions_id_seq',
      'alerts_id_seq',
      'performance_metrics_id_seq',
      'pending_approvals_id_seq',
      'watchlist_id_seq',
      'earnings_calendar_id_seq',
      'position_lots_id_seq'
    ];

    console.log('\n🔄 Resetting sequences...');
    for (const seq of sequencesToReset) {
      try {
        await pool.query(`ALTER SEQUENCE ${seq} RESTART WITH 1`);
        console.log(`✅ Reset ${seq}`);
      } catch (error) {
        if (error.code === '42P01') {
          console.log(`⚠️  Sequence ${seq} does not exist (skipping)`);
        } else {
          console.error(`❌ Error resetting ${seq}:`, error.message);
        }
      }
    }

    console.log('\n✅ Database reset complete!');
    console.log('📊 stock_universe table preserved (365 stocks intact)');
    console.log('🚀 Ready for fresh paper trading start\n');

  } catch (error) {
    console.error('❌ Database reset failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

resetDatabase();
