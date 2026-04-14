import * as db from '../src/db.js';
import * as stockProfiles from '../src/stock-profiles.js';

/**
 * Build profiles ONLY for stocks that don't have them yet
 * Avoids wasting resources on duplicate work
 */
async function buildMissingProfiles() {
  console.log('\n🔬 Building profiles for stocks without profiles...\n');

  try {
    // Get all stocks from universe
    const universeResult = await db.query(
      'SELECT symbol FROM stock_universe WHERE status = $1 ORDER BY symbol',
      ['active']
    );

    // Get stocks that already have profiles
    const profilesResult = await db.query(
      'SELECT symbol FROM stock_profiles'
    );

    const allSymbols = new Set(universeResult.rows.map(r => r.symbol));
    const existingProfiles = new Set(profilesResult.rows.map(r => r.symbol));

    // Find missing profiles
    const missingSymbols = [...allSymbols].filter(s => !existingProfiles.has(s));

    console.log(`Total stocks in universe: ${allSymbols.size}`);
    console.log(`Existing profiles: ${existingProfiles.size}`);
    console.log(`Missing profiles: ${missingSymbols.length}\n`);

    if (missingSymbols.length === 0) {
      console.log('✅ All stocks already have profiles!');
      process.exit(0);
    }

    let completed = 0;
    let failed = 0;

    for (const symbol of missingSymbols) {
      try {
        console.log(`[${completed + failed + 1}/${missingSymbols.length}] Building ${symbol}...`);
        await stockProfiles.buildStockProfile(symbol);
        completed++;

        // 3-second delay between profiles to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        console.error(`Failed ${symbol}: ${error.message}`);
        failed++;
      }
    }

    console.log(`\n✅ Profile building complete: ${completed} succeeded, ${failed} failed`);
    process.exit(0);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

buildMissingProfiles();
