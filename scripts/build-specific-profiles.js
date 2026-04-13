import * as stockProfiles from '../src/stock-profiles.js';

/**
 * Build profiles for specific stocks
 * Usage: node scripts/build-specific-profiles.js SYMBOL1 SYMBOL2 ...
 */

const symbols = process.argv.slice(2);

if (symbols.length === 0) {
  console.error('Usage: node scripts/build-specific-profiles.js SYMBOL1 SYMBOL2 ...');
  process.exit(1);
}

async function buildSpecificProfiles() {
  console.log(`🔄 Building profiles for: ${symbols.join(', ')}\n`);

  const results = {
    success: [],
    failed: []
  };

  for (const symbol of symbols) {
    console.log(`\n📊 Building ${symbol}...`);
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
  console.log('📊 BUILD SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Success: ${results.success.length} (${results.success.join(', ')})`);
  console.log(`❌ Failed: ${results.failed.length} (${results.failed.join(', ')})`);

  return results;
}

buildSpecificProfiles()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
