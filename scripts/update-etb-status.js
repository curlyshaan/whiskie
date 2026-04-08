import tradier from '../src/tradier.js';
import * as db from '../src/db.js';

/**
 * Update ETB (Easy-to-Borrow) status for all stocks in universe
 * Run periodically to keep shortable status current
 */

async function updateETBStatus() {
  try {
    console.log('🔍 Fetching ETB list from Tradier...');

    const etbList = await tradier.getETBList();

    if (!etbList || etbList.length === 0) {
      console.error('❌ No ETB data received from Tradier');
      process.exit(1);
    }

    console.log(`📊 Received ${etbList.length} stocks on ETB list`);

    // Get all stocks from universe
    const allStocks = await db.getStockUniverse();
    console.log(`📈 Checking ${allStocks.length} stocks in universe`);

    let shortableCount = 0;
    let notShortableCount = 0;

    for (const stock of allStocks) {
      const isETB = etbList.some(etb => etb.symbol === stock.symbol);

      await db.updateETBStatus(stock.symbol, isETB);

      if (isETB) {
        shortableCount++;
        process.stdout.write('✓');
      } else {
        notShortableCount++;
        process.stdout.write('·');
      }
    }

    console.log('\n\n✅ ETB status update complete!');
    console.log(`✓ Shortable: ${shortableCount}`);
    console.log(`· Not shortable: ${notShortableCount}`);
    console.log(`📊 Shortable percentage: ${((shortableCount / allStocks.length) * 100).toFixed(1)}%`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error updating ETB status:', error);
    process.exit(1);
  }
}

// Run if called directly
updateETBStatus();
