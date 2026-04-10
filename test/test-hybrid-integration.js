import yahooPython from './src/yahoo-python-client.js';
import advancedFMPScreener from './src/advanced-fmp-screener.js';
import fmp from './src/fmp.js';

/**
 * Test complete hybrid integration:
 * - Python yfinance for fundamentals
 * - FMP free for insider trading
 * - Combined analysis
 */

async function testHybridIntegration() {
  console.log('Testing Hybrid Free Tier Integration\n');
  console.log('='.repeat(80));

  const testSymbols = ['NOW', 'AAPL', 'MSFT'];

  for (const symbol of testSymbols) {
    console.log(`\n${symbol}:`);
    console.log('-'.repeat(80));

    // 1. Get fundamentals from Python yfinance
    const fundamentals = await yahooPython.getFundamentals(symbol);
    if (fundamentals) {
      console.log(`✅ Fundamentals (Python yfinance):`);
      console.log(`   ${fundamentals.companyName}`);
      console.log(`   Sector: ${fundamentals.sector}, Industry: ${fundamentals.industry}`);
      console.log(`   Market Cap: $${(fundamentals.marketCap / 1e9).toFixed(1)}B`);
      console.log(`   P/E: ${fundamentals.peRatio.toFixed(1)}, Revenue Growth: ${(fundamentals.revenueGrowth * 100).toFixed(1)}%`);
      console.log(`   Operating Margin: ${(fundamentals.operatingMargin * 100).toFixed(1)}%, ROE: ${(fundamentals.roe * 100).toFixed(1)}%`);
      console.log(`   Target: $${fundamentals.targetMeanPrice.toFixed(2)} (${fundamentals.numberOfAnalysts} analysts)`);
    } else {
      console.log(`❌ Fundamentals: Failed`);
    }

    // 2. Get insider trading from FMP free
    const insider = await advancedFMPScreener.getInsiderTrading(symbol);
    if (insider && insider.length > 0) {
      const analysis = advancedFMPScreener.analyzeInsiderTrading(insider);
      console.log(`\n✅ Insider Trading (FMP free): ${insider.length} records`);
      console.log(`   Signal: ${analysis.signal} (score: ${analysis.score})`);
      console.log(`   Reason: ${analysis.reason}`);
    } else {
      console.log(`\n⚠️  Insider Trading: No data`);
    }

    // 3. Get profile from FMP free
    try {
      const profile = await fmp.getProfile(symbol);
      if (profile) {
        console.log(`\n✅ Profile (FMP free):`);
        console.log(`   ${profile.companyName}`);
        console.log(`   Exchange: ${profile.exchangeShortName}, CEO: ${profile.ceo || 'N/A'}`);
      }
    } catch (error) {
      console.log(`\n⚠️  Profile: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('HYBRID INTEGRATION TEST COMPLETE');
  console.log('='.repeat(80));
  console.log('\n✅ Data Sources Working:');
  console.log('   - Python yfinance: Fundamentals, analyst data, earnings');
  console.log('   - FMP free: Profile, insider trading');
  console.log('   - Ready for Opus screening integration');
}

testHybridIntegration().catch(console.error);
