import tradier from '../src/tradier.js';
import * as db from '../src/db.js';
import assetClassData from '../src/asset-class-data.js';

/**
 * Update stock universe with volume, spread, and price filters
 * Run daily at 7pm ET to prep for next day
 */

const MIN_VOLUME = 50_000_000; // $50M daily volume minimum
const MAX_SPREAD_PCT = 0.005;  // 0.5% max bid-ask spread
const MIN_PRICE = 5.00;        // $5 minimum price

async function updateStockFilters() {
  console.log('📊 Updating stock universe filters...');

  // Get all stocks from asset classes
  const allStocks = [];
  for (const [assetClass, stocks] of Object.entries(assetClassData.ASSET_CLASSES)) {
    for (const symbol of stocks) {
      allStocks.push({ symbol, assetClass });
    }
  }

  console.log(`   Processing ${allStocks.length} stocks...`);

  let processed = 0;
  let filtered = 0;

  for (const stock of allStocks) {
    try {
      // Get quote data
      const quote = await tradier.getQuote(stock.symbol);

      if (!quote) {
        console.warn(`   ⚠️ No quote data for ${stock.symbol}`);
        continue;
      }

      const price = quote.last || quote.close;
      const avgVolume = Math.round(quote.average_volume || 0); // Round API value to integer
      const bid = quote.bid || 0;
      const ask = quote.ask || 0;

      // Calculate bid-ask spread
      const spread = (ask && bid && price) ? (ask - bid) / price : 0;

      // Calculate dollar volume (already rounded avgVolume, round again for safety)
      const dollarVolume = Math.round(avgVolume * price);

      // Check filters
      const passesFilters =
        dollarVolume >= MIN_VOLUME &&
        spread <= MAX_SPREAD_PCT &&
        price >= MIN_PRICE;

      // Update database
      await db.query(
        `INSERT INTO stock_universe (symbol, sector, avg_daily_volume, last_price, bid_ask_spread, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (symbol)
         DO UPDATE SET
           sector = $2,
           avg_daily_volume = $3,
           last_price = $4,
           bid_ask_spread = $5,
           status = $6`,
        [
          stock.symbol,
          stock.assetClass,
          dollarVolume,
          price,
          spread,
          passesFilters ? 'active' : 'filtered'
        ]
      );

      processed++;

      if (!passesFilters) {
        filtered++;
        console.log(`   ❌ ${stock.symbol}: Filtered (vol: $${(dollarVolume/1e6).toFixed(1)}M, spread: ${(spread*100).toFixed(2)}%, price: $${price.toFixed(2)})`);
      }

      // Rate limiting
      if (processed % 50 === 0) {
        console.log(`   Progress: ${processed}/${allStocks.length} stocks processed...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

    } catch (error) {
      console.error(`   ❌ Error processing ${stock.symbol}:`, error.message);
    }
  }

  console.log(`\n✅ Stock filter update complete:`);
  console.log(`   Processed: ${processed} stocks`);
  console.log(`   Filtered out: ${filtered} stocks`);
  console.log(`   Active: ${processed - filtered} stocks`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateStockFilters()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export default updateStockFilters;
