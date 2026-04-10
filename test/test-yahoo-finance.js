import yahooFinance from 'yahoo-finance2';

console.log('Testing yahoo-finance2 library\n');
console.log('='.repeat(80));

const testSymbol = 'AAPL';

// Test 1: Basic quote
console.log(`\n📊 Test 1: Basic Quote (${testSymbol})`);
console.log('-'.repeat(80));
try {
  const quote = await yahooFinance.quote(testSymbol);
  console.log('✅ Quote works!');
  console.log(`   Price: $${quote.regularMarketPrice}`);
  console.log(`   Volume: ${quote.regularMarketVolume?.toLocaleString()}`);
} catch (error) {
  console.log(`❌ Quote failed: ${error.message}`);
}

// Test 2: Quote Summary with short interest
console.log(`\n📊 Test 2: Quote Summary with Short Interest (${testSymbol})`);
console.log('-'.repeat(80));
try {
  const summary = await yahooFinance.quoteSummary(testSymbol, {
    modules: ['defaultKeyStatistics']
  });
  console.log('✅ Quote Summary works!');
  if (summary.defaultKeyStatistics) {
    console.log(`   Short % of Float: ${(summary.defaultKeyStatistics.shortPercentOfFloat * 100).toFixed(2)}%`);
    console.log(`   Short Ratio: ${summary.defaultKeyStatistics.shortRatio}`);
  }
} catch (error) {
  console.log(`❌ Quote Summary failed: ${error.message}`);
}

// Test 3: Historical data
console.log(`\n📊 Test 3: Historical Data (${testSymbol})`);
console.log('-'.repeat(80));
try {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);

  const history = await yahooFinance.historical(testSymbol, {
    period1: startDate,
    period2: endDate
  });
  console.log('✅ Historical data works!');
  console.log(`   Got ${history.length} days of data`);
} catch (error) {
  console.log(`❌ Historical data failed: ${error.message}`);
}

console.log(`\n${'='.repeat(80)}`);

