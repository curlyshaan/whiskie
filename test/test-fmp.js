import fmp from '../src/fmp.js';

console.log('Testing FMP API Integration\n');
console.log('='.repeat(80));

const testSymbols = ['AAPL', 'MSFT', 'GOOGL'];

for (const symbol of testSymbols) {
  console.log(`\n📊 Testing ${symbol}`);
  console.log('-'.repeat(80));

  try {
    const fundamentals = await fmp.getFundamentals(symbol);

    if (!fundamentals) {
      console.log('❌ No data returned');
      continue;
    }

    console.log(`✅ Data retrieved successfully`);
    console.log(`   Market Cap: $${(fundamentals.marketCap / 1e9).toFixed(1)}B`);
    console.log(`   Sector: ${fundamentals.sector}`);
    console.log(`   P/E Ratio: ${fundamentals.peRatio.toFixed(2)}`);
    console.log(`   PEG Ratio: ${fundamentals.pegRatio.toFixed(2)}`);
    console.log(`   Revenue Growth: ${(fundamentals.revenueGrowth * 100).toFixed(1)}%`);
    console.log(`   Earnings Growth: ${(fundamentals.earningsGrowth * 100).toFixed(1)}%`);
    console.log(`   Debt/Equity: ${fundamentals.debtToEquity.toFixed(2)}`);
    console.log(`   Operating Margin: ${(fundamentals.operatingMargin * 100).toFixed(1)}%`);

  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
}

// Show API usage stats
console.log(`\n${'='.repeat(80)}`);
console.log('\n📊 FMP API Usage Statistics:');
const stats = fmp.getUsageStats();
console.log(`   Calls made: ${stats.calls}`);
console.log(`   Limit: ${stats.limit}`);
console.log(`   Remaining: ${stats.remaining}`);
console.log(`   Rolling usage: ${stats.percentage}`);
console.log(`   Recent calls (60s): ${stats.recentCallsLast60s}`);

console.log(`\n${'='.repeat(80)}`);
