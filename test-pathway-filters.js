import fundamentalScreener from './src/fundamental-screener.js';

/**
 * Test script to run all 407 stocks through updated pathway filters
 * Shows how many stocks qualify for each pathway
 */

async function testPathwayFilters() {
  console.log('🧪 Testing updated pathway filters on 407-stock universe...\n');
  console.log('Changes implemented:');
  console.log('  1. Inflection: Requires 2+ of 4 criteria (not just revenue acceleration)');
  console.log('  2. Turnaround: Hard debt ceiling at D/E > 2.0');
  console.log('  3. Cash Machine: FCF yield trap protection (declining revenue check)');
  console.log('  4. Accrual Ratio: Earnings quality check (>12% = reject for longs, >15% = bonus for shorts)');
  console.log('  5. Market caps: $2B for Deep Value/Cash Machine/QARP, $500M for others');
  console.log('  6. Short threshold: 60 → 50 points\n');

  try {
    const result = await fundamentalScreener.runWeeklyScreen('full');

    console.log('\n📊 RESULTS BY PATHWAY:\n');

    // Count by pathway
    const pathwayCounts = {};
    result.longs.forEach(stock => {
      const pathway = stock.longPathway;
      pathwayCounts[pathway] = (pathwayCounts[pathway] || 0) + 1;
    });

    console.log('LONG PATHWAYS:');
    console.log(`  Deep Value:   ${pathwayCounts.deepValue || 0} stocks`);
    console.log(`  High Growth:  ${pathwayCounts.highGrowth || 0} stocks`);
    console.log(`  Inflection:   ${pathwayCounts.inflection || 0} stocks`);
    console.log(`  Cash Machine: ${pathwayCounts.cashMachine || 0} stocks`);
    console.log(`  QARP:         ${pathwayCounts.qarp || 0} stocks`);
    console.log(`  Turnaround:   ${pathwayCounts.turnaround || 0} stocks`);
    console.log(`  TOTAL LONGS:  ${result.longs.length} stocks\n`);

    console.log('SHORT CANDIDATES:');
    console.log(`  TOTAL SHORTS: ${result.shorts.length} stocks\n`);

    // Show top 5 from each pathway
    console.log('TOP 5 BY PATHWAY:\n');

    Object.keys(pathwayCounts).forEach(pathway => {
      const stocks = result.longs.filter(s => s.longPathway === pathway).slice(0, 5);
      if (stocks.length > 0) {
        console.log(`${pathway.toUpperCase()}:`);
        stocks.forEach(s => {
          console.log(`  ${s.symbol}: ${s.longScore} pts - ${s.longReasons.slice(0, 2).join(', ')}`);
        });
        console.log('');
      }
    });

    if (result.shorts.length > 0) {
      console.log('TOP 5 SHORTS:');
      result.shorts.slice(0, 5).forEach(s => {
        console.log(`  ${s.symbol}: ${s.shortScore} pts - ${s.shortReasons.slice(0, 2).join(', ')}`);
      });
    }

    console.log('\n✅ Test complete!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testPathwayFilters();
