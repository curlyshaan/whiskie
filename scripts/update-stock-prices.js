import fmp from '../src/fmp.js';
import * as db from '../src/db.js';

/**
 * Update stock_universe with current prices and volume data from FMP
 */
async function updateStockPrices() {
  console.log('🔄 Updating stock prices and volume data...\n');

  try {
    // Get all stocks from universe
    const result = await db.query('SELECT symbol FROM stock_universe WHERE status = $1', ['active']);
    const stocks = result.rows;

    console.log(`📊 Found ${stocks.length} stocks to update\n`);

    let updated = 0;
    let errors = 0;

    for (let i = 0; i < stocks.length; i++) {
      const { symbol } = stocks[i];

      try {
        // Fetch profile data from FMP (includes price and volume)
        const profile = await fmp.getProfile(symbol);

        if (profile) {
          await db.query(
            `UPDATE stock_universe
             SET avg_daily_volume = $1,
                 last_price = $2,
                 bid_ask_spread = $3
             WHERE symbol = $4`,
            [
              profile.avgVolume || profile.averageVolume || 0,
              profile.price || 0,
              0, // bid_ask_spread not in profile, set to 0
              symbol
            ]
          );
          updated++;

          if ((i + 1) % 50 === 0) {
            console.log(`   Progress: ${i + 1}/${stocks.length} stocks updated`);
          }
        } else {
          errors++;
        }

        // Rate limiting: 400ms delay (150 calls/min)
        await new Promise(resolve => setTimeout(resolve, 400));

      } catch (error) {
        console.error(`   Error updating ${symbol}:`, error.message);
        errors++;
      }
    }

    console.log(`\n✅ Update complete!`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Errors: ${errors}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

updateStockPrices();
