import fmp from '../src/fmp.js';

/**
 * Test FMP Integration with TTM Data
 * Verifies all new endpoints work correctly
 */

async function testFMPIntegration() {
  console.log('🧪 Testing FMP Integration\n');
  let passed = 0;
  let failed = 0;

  // Test 1: getFundamentals with TTM data
  console.log('1️⃣ Testing getFundamentals() with TTM data...');
  try {
    const fundamentals = await fmp.getFundamentals('AAPL');

    if (!fundamentals) throw new Error('No data returned');
    if (!fundamentals.peRatio) throw new Error('Missing peRatio');
    if (!fundamentals.revenueGrowth) throw new Error('Missing revenueGrowth');
    if (!fundamentals.incomeStatements) throw new Error('Missing incomeStatements');

    console.log(`   ✅ PASS - Got TTM data for AAPL`);
    console.log(`      PE Ratio (TTM): ${fundamentals.peRatio.toFixed(2)}`);
    console.log(`      Revenue Growth: ${(fundamentals.revenueGrowth * 100).toFixed(1)}%`);
    console.log(`      Quarters: ${fundamentals.incomeStatements.length}`);
    passed++;
  } catch (error) {
    console.log(`   ❌ FAIL - ${error.message}`);
    failed++;
  }

  // Test 2: getTechnicalIndicators
  console.log('\n2️⃣ Testing getTechnicalIndicators()...');
  try {
    const technicals = await fmp.getTechnicalIndicators('NVDA');

    if (!technicals) throw new Error('No data returned');
    if (!technicals.ema200) throw new Error('Missing ema200');
    if (!technicals.rsi) throw new Error('Missing rsi');
    if (typeof technicals.aboveEma200 !== 'boolean') throw new Error('Missing aboveEma200');

    console.log(`   ✅ PASS - Got technical indicators for NVDA`);
    console.log(`      Price: $${technicals.price}`);
    console.log(`      200 EMA: $${technicals.ema200.toFixed(2)}`);
    console.log(`      RSI: ${technicals.rsi.toFixed(1)}`);
    console.log(`      Above 200 EMA: ${technicals.aboveEma200}`);
    passed++;
  } catch (error) {
    console.log(`   ❌ FAIL - ${error.message}`);
    failed++;
  }

  // Test 3: getDeepAnalysisBundle
  console.log('\n3️⃣ Testing getDeepAnalysisBundle()...');
  try {
    const bundle = await fmp.getDeepAnalysisBundle('MSFT');

    if (!bundle) throw new Error('No data returned');
    if (!bundle.ratiosTTM) throw new Error('Missing ratiosTTM');
    if (!bundle.financialGrowth) throw new Error('Missing financialGrowth');
    if (!bundle.technicals) throw new Error('Missing technicals');
    if (!bundle.signals) throw new Error('Missing signals');

    console.log(`   ✅ PASS - Got deep analysis bundle for MSFT`);
    console.log(`      PE Ratio: ${bundle.ratiosTTM.priceToEarningsRatioTTM?.toFixed(2)}`);
    console.log(`      Revenue Acceleration: ${bundle.signals.revenueAccel}`);
    console.log(`      Above 200 MA: ${bundle.signals.isAbove200MA}`);
    passed++;
  } catch (error) {
    console.log(`   ❌ FAIL - ${error.message}`);
    failed++;
  }

  // Test 4: getEarningsCalendar
  console.log('\n4️⃣ Testing getEarningsCalendar()...');
  try {
    const calendar = await fmp.getEarningsCalendar();

    if (!Array.isArray(calendar)) throw new Error('Not an array');
    if (calendar.length === 0) throw new Error('Empty calendar');

    const sample = calendar[0];
    if (!sample.symbol) throw new Error('Missing symbol in calendar entry');
    if (!sample.date) throw new Error('Missing date in calendar entry');

    console.log(`   ✅ PASS - Got earnings calendar`);
    console.log(`      Entries: ${calendar.length}`);
    console.log(`      Sample: ${sample.symbol} on ${sample.date}`);
    passed++;
  } catch (error) {
    console.log(`   ❌ FAIL - ${error.message}`);
    failed++;
  }

  // Test 5: Verify TTM vs Annual difference
  console.log('\n5️⃣ Testing TTM data is current (not stale annual)...');
  try {
    const data = await fmp.getFundamentals('TSLA');

    if (!data) throw new Error('No data returned');

    // Check that we have quarterly income statements
    if (!data.incomeStatements || data.incomeStatements.length < 4) {
      throw new Error('Missing quarterly income statements');
    }

    // Check latest quarter is recent (within last 6 months)
    const latestQuarter = new Date(data.incomeStatements[0].date);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    if (latestQuarter < sixMonthsAgo) {
      throw new Error('Latest quarter data is stale (>6 months old)');
    }

    console.log(`   ✅ PASS - Data is current`);
    console.log(`      Latest quarter: ${data.incomeStatements[0].date}`);
    console.log(`      Period: ${data.incomeStatements[0].period}`);
    passed++;
  } catch (error) {
    console.log(`   ❌ FAIL - ${error.message}`);
    failed++;
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) {
    console.log('\n❌ Some tests failed. Please review errors above.');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed! FMP integration is working correctly.');
    process.exit(0);
  }
}

// Run tests
testFMPIntegration().catch(error => {
  console.error('\n💥 Test suite crashed:', error);
  process.exit(1);
});
