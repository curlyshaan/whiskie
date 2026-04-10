import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function resetPaperTrading() {
  const client = await pool.connect();

  try {
    console.log('🔄 Resetting paper trading account...\n');

    // Show current state
    console.log('📊 Current State:');
    const trades = await client.query('SELECT COUNT(*) as count FROM trades');
    const positions = await client.query('SELECT COUNT(*) as count FROM positions');
    const decisions = await client.query('SELECT COUNT(*) as count FROM ai_decisions');

    console.log(`   Trades: ${trades.rows[0].count}`);
    console.log(`   Positions: ${positions.rows[0].count}`);
    console.log(`   AI Decisions: ${decisions.rows[0].count}`);
    console.log('');

    // Delete all data
    console.log('🗑️  Deleting all data...');
    await client.query('DELETE FROM trades');
    await client.query('DELETE FROM positions');
    await client.query('DELETE FROM portfolio_snapshots');
    await client.query('DELETE FROM alerts');
    await client.query('DELETE FROM pending_approvals');

    // Keep ai_decisions for learning, but you can uncomment to delete:
    // await client.query('DELETE FROM ai_decisions');

    console.log('✅ All trades and positions deleted');
    console.log('ℹ️  AI decisions kept for learning (delete manually if needed)');
    console.log('');

    // Verify
    console.log('📊 After Reset:');
    const tradesAfter = await client.query('SELECT COUNT(*) as count FROM trades');
    const positionsAfter = await client.query('SELECT COUNT(*) as count FROM positions');

    console.log(`   Trades: ${tradesAfter.rows[0].count}`);
    console.log(`   Positions: ${positionsAfter.rows[0].count}`);
    console.log('');

    console.log('✅ Paper trading account reset complete!');
    console.log('💰 Portfolio is now back to $100,000 cash');

  } catch (error) {
    console.error('❌ Error resetting account:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

resetPaperTrading();
