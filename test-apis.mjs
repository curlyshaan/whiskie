import dotenv from 'dotenv';
import yahooFinance from './src/yahoo-finance.js';
import tradier from './src/tradier.js';

dotenv.config();

const TEST_SYMBOL = 'AAPL';

console.log(`\n🧪 Testing APIs for ${TEST_SYMBOL}...\n`);

// Test 1: Days to Cover from Yahoo Finance
console.log('1️⃣ Testing Days to Cover (Yahoo Finance)...');
try {
  const shortStats = await yahooFinance.getShortInterest(TEST_SYMBOL);
  if (shortStats && shortStats.shortRatio) {
    console.log(`   ✅ Days to Cover: ${shortStats.shortRatio.toFixed(2)}`);
    console.log(`   ✅ Short % of Float: ${(shortStats.shortPercentOfFloat * 100).toFixed(1)}%`);
  } else {
    console.log('   ⚠️ No short interest data available');
  }
} catch (error) {
  console.log(`   ❌ Error: ${error.message}`);
}

// Test 2: IV from Tradier Options Chain
console.log('\n2️⃣ Testing IV (Tradier Options Chain)...');
try {
  const optionsData = await tradier.getOptionsChain(TEST_SYMBOL);
  if (optionsData && optionsData.options && optionsData.options.option) {
    const options = Array.isArray(optionsData.options.option)
      ? optionsData.options.option
      : [optionsData.options.option];

    const quote = await tradier.getQuote(TEST_SYMBOL);
    const currentPrice = quote?.last || quote?.close;

    // Find ATM options
    const atmOptions = options
      .filter(opt => opt.greeks && opt.greeks.mid_iv)
      .map(opt => ({
        strike: opt.strike,
        iv: opt.greeks.mid_iv,
        distance: Math.abs(opt.strike - currentPrice)
      }))
      .sort((a, b) => a.distance - b.distance);

    if (atmOptions.length > 0) {
      const atmIV = atmOptions[0].iv;
      console.log(`   ✅ Current IV: ${(atmIV * 100).toFixed(1)}%`);
      console.log(`   ✅ Strike: $${atmOptions[0].strike} (ATM)`);

      // Calculate IV percentile (need historical IV data)
      console.log('   ℹ️ IV percentile requires historical options data (not tested here)');
    } else {
      console.log('   ⚠️ No IV data in options chain');
    }
  } else {
    console.log('   ⚠️ No options data available');
  }
} catch (error) {
  console.log(`   ❌ Error: ${error.message}`);
}

// Test 3: Borrow Fee (Tradier doesn't provide this directly)
console.log('\n3️⃣ Testing Borrow Fee...');
console.log('   ⚠️ Tradier API does not provide borrow fee rates');
console.log('   ℹ️ Will implement graceful fallback (skip check if unavailable)');

console.log('\n✅ API testing complete\n');
