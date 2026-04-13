import * as stockProfiles from '../src/stock-profiles.js';

/**
 * Retry building profiles for stocks that failed in batches 6 & 7
 */

const failedStocks = ['VRT', 'SHOP', 'VRTX', 'SHW'];

async function retryFailedProfiles() {
  console.log('🔄 Retrying failed profile builds...\n');

  const results = {
    success: [],
    failed: []
  };

  for (const symbol of failedStocks) {
    console.log(`\n📊 Attempting ${symbol}...`);
    try {
      const profile = await stockProfiles.buildStockProfile(symbol);
      if (profile) {
        console.log(`   ✅ ${symbol} profile built successfully`);
        results.success.push(symbol);
      } else {
        console.log(`   ❌ ${symbol} failed (returned null)`);
        results.failed.push(symbol);
      }
    } catch (error) {
      console.error(`   ❌ ${symbol} error:`, error.message);
      results.failed.push(symbol);
    }

    // Small delay between attempts
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 RETRY SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Success: ${results.success.length} (${results.success.join(', ')})`);
  console.log(`❌ Failed: ${results.failed.length} (${results.failed.join(', ')})`);

  return results;
}

retryFailedProfiles()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
