import * as db from '../src/db.js';
import readline from 'readline';

/**
 * Reset Database - Fresh Start
 * Clears all trading data while preserving stock universe
 *
 * WARNING: This will delete:
 * - All positions
 * - All trades history
 * - All AI decisions
 * - All portfolio snapshots
 * - All alerts
 * - All pending approvals
 * - All watchlist items
 * - All position lots
 *
 * This will KEEP:
 * - Stock universe (symbols and ETB status)
 * - Earnings calendar data
 */

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askConfirmation(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

async function resetDatabase() {
  try {
    console.log('\n⚠️  DATABASE RESET - FRESH START ⚠️\n');
    console.log('This will DELETE all trading data:');
    console.log('  ❌ All positions');
    console.log('  ❌ All trades history');
    console.log('  ❌ All AI decisions');
    console.log('  ❌ All portfolio snapshots');
    console.log('  ❌ All alerts');
    console.log('  ❌ All pending approvals');
    console.log('  ❌ All watchlist items');
    console.log('  ❌ All position lots\n');
    console.log('This will KEEP:');
    console.log('  ✅ Stock universe');
    console.log('  ✅ Earnings calendar\n');

    const confirmed = await askConfirmation('Type "yes" to confirm reset: ');

    if (!confirmed) {
      console.log('\n❌ Reset cancelled');
      rl.close();
      process.exit(0);
    }

    console.log('\n🗑️  Starting database reset...\n');

    // Delete all positions
    const positionsResult = await db.query('DELETE FROM positions');
    console.log(`✅ Deleted ${positionsResult.rowCount} positions`);

    // Delete all position lots
    const lotsResult = await db.query('DELETE FROM position_lots');
    console.log(`✅ Deleted ${lotsResult.rowCount} position lots`);

    // Delete all trades
    const tradesResult = await db.query('DELETE FROM trades');
    console.log(`✅ Deleted ${tradesResult.rowCount} trades`);

    // Delete all AI decisions
    const decisionsResult = await db.query('DELETE FROM ai_decisions');
    console.log(`✅ Deleted ${decisionsResult.rowCount} AI decisions`);

    // Delete all portfolio snapshots
    const snapshotsResult = await db.query('DELETE FROM portfolio_snapshots');
    console.log(`✅ Deleted ${snapshotsResult.rowCount} portfolio snapshots`);

    // Delete all alerts
    const alertsResult = await db.query('DELETE FROM alerts');
    console.log(`✅ Deleted ${alertsResult.rowCount} alerts`);

    // Delete all pending approvals
    const approvalsResult = await db.query('DELETE FROM pending_approvals');
    console.log(`✅ Deleted ${approvalsResult.rowCount} pending approvals`);

    // Delete all watchlist items
    const watchlistResult = await db.query('DELETE FROM watchlist');
    console.log(`✅ Deleted ${watchlistResult.rowCount} watchlist items`);

    // Delete all performance metrics
    const metricsResult = await db.query('DELETE FROM performance_metrics');
    console.log(`✅ Deleted ${metricsResult.rowCount} performance metrics`);

    console.log('\n✅ Database reset complete!');
    console.log('\n📊 Next steps:');
    console.log('  1. Bot will sync positions from Tradier on next run');
    console.log('  2. Fresh start with clean slate');
    console.log('  3. All historical data cleared\n');

    rl.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error resetting database:', error);
    rl.close();
    process.exit(1);
  }
}

// Run if called directly
resetDatabase();
