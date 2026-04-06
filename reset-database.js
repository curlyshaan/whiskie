import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

/**
 * ONE-TIME DATABASE RESET SCRIPT
 * WARNING: This will DELETE ALL DATA in the Whiskie database
 * Use this to reset and start fresh with corrected calculations
 */

async function resetDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('⚠️  WARNING: This will DELETE ALL DATA in the Whiskie database');
    console.log('📊 Connecting to database...');

    const client = await pool.connect();

    // Drop all tables
    console.log('\n🗑️  Dropping all tables...');

    await client.query('DROP TABLE IF EXISTS alerts CASCADE');
    console.log('   ✓ Dropped alerts');

    await client.query('DROP TABLE IF EXISTS ai_decisions CASCADE');
    console.log('   ✓ Dropped ai_decisions');

    await client.query('DROP TABLE IF EXISTS portfolio_snapshots CASCADE');
    console.log('   ✓ Dropped portfolio_snapshots');

    await client.query('DROP TABLE IF EXISTS position_lots CASCADE');
    console.log('   ✓ Dropped position_lots');

    await client.query('DROP TABLE IF EXISTS positions CASCADE');
    console.log('   ✓ Dropped positions');

    await client.query('DROP TABLE IF EXISTS trades CASCADE');
    console.log('   ✓ Dropped trades');

    await client.query('DROP TABLE IF EXISTS watchlist CASCADE');
    console.log('   ✓ Dropped watchlist');

    await client.query('DROP TABLE IF EXISTS earnings_calendar CASCADE');
    console.log('   ✓ Dropped earnings_calendar');

    console.log('\n✅ All tables dropped successfully');
    console.log('\n📝 Next steps:');
    console.log('   1. Restart the app to recreate tables with correct schema');
    console.log('   2. The app will automatically initialize the database on startup');
    console.log('   3. New positions will be calculated correctly from Tradier API');

    client.release();
    await pool.end();

  } catch (error) {
    console.error('❌ Error resetting database:', error);
    throw error;
  }
}

// Run the reset
resetDatabase()
  .then(() => {
    console.log('\n🎉 Database reset complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Database reset failed:', error);
    process.exit(1);
  });
