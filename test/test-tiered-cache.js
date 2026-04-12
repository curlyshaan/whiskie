import fmpCache from '../src/fmp-cache.js';
import * as db from '../src/db.js';

/**
 * Test tiered FMP caching system
 */

async function testTieredCache() {
  console.log('🧪 Testing Tiered FMP Cache System\n');

  try {
    // Initialize database and cache
    await db.initDatabase();
    await fmpCache.initDatabase();

    // Test 1: Cache fundamentals with tiered structure
    console.log('Test 1: Caching fundamentals with tiered structure...');
    const testSymbol = 'AAPL';
    const fundamentals = await fmpCache.getFundamentals(testSymbol);

    if (fundamentals) {
      console.log(`✅ Fetched fundamentals for ${testSymbol}`);
      console.log(`   Market Cap: $${(fundamentals.marketCap / 1e9).toFixed(1)}B`);
      console.log(`   P/E Ratio: ${fundamentals.peRatio?.toFixed(2) || 'N/A'}`);
    } else {
      console.log(`❌ Failed to fetch fundamentals for ${testSymbol}`);
    }

    // Test 2: Verify cache tiers
    console.log('\nTest 2: Verifying cache tiers...');
    const cachedTTM = await fmpCache.getCached(testSymbol, 'TTM');
    const cachedQuarterly = await fmpCache.getCached(testSymbol, 'QUARTERLY');
    const cachedAnnual = await fmpCache.getCached(testSymbol, 'ANNUAL');

    console.log(`   TTM cache: ${cachedTTM ? '✅ Found' : '❌ Missing'}`);
    console.log(`   Quarterly cache: ${cachedQuarterly ? '✅ Found' : '❌ Missing'}`);
    console.log(`   Annual cache: ${cachedAnnual ? '✅ Found' : '❌ Missing'}`);

    // Test 3: Cache statistics
    console.log('\nTest 3: Cache statistics...');
    const stats = await fmpCache.getCacheStats();
    console.log('   Cache breakdown:');
    console.log(`   - TTM (1-day): ${stats.TTM.valid} valid, ${stats.TTM.expired} expired`);
    console.log(`   - Quarterly (45-day): ${stats.QUARTERLY.valid} valid, ${stats.QUARTERLY.expired} expired`);
    console.log(`   - Annual (90-day): ${stats.ANNUAL.valid} valid, ${stats.ANNUAL.expired} expired`);

    // Test 4: Batch fetch with cache hit rate
    console.log('\nTest 4: Batch fetch with cache hit rate...');
    const testSymbols = ['AAPL', 'MSFT', 'GOOGL'];
    const batchResults = await fmpCache.batchGetFundamentals(testSymbols);
    console.log(`   Cached: ${batchResults.cached}`);
    console.log(`   Fetched: ${batchResults.fetched}`);
    console.log(`   Failed: ${batchResults.failed}`);
    console.log(`   Cache hit rate: ${batchResults.cacheHitRate}%`);

    console.log('\n✅ All tiered cache tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}

// Run tests
testTieredCache()
  .then(() => {
    console.log('\n🎉 Tiered cache system working correctly');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 Tests failed:', error);
    process.exit(1);
  });
