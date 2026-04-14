import * as db from '../src/db.js';

/**
 * Test short scoring logic - compare current vs proposed changes
 */

// Current logic (requires 2+ valuation signals)
function scoreShortValuationCurrent(metrics, sectorConfig, reasons) {
  let score = 0;
  let valuationSignals = 0;
  const highPE = sectorConfig.peRange?.high || 40;

  if (metrics.peRatio > highPE * 1.5) {
    score += 20;
    valuationSignals++;
    reasons.push(`Extreme P/E: ${metrics.peRatio.toFixed(1)} (1.5x sector ceiling of ${highPE})`);
  } else if (metrics.peRatio > highPE) {
    score += 10;
    valuationSignals++;
  }

  if (metrics.pegRatio > 4.0) {
    score += 20;
    valuationSignals++;
    reasons.push(`PEG ${metrics.pegRatio.toFixed(2)} (severely overvalued)`);
  } else if (metrics.pegRatio > 3.0) {
    score += 10;
    valuationSignals++;
    reasons.push(`PEG ${metrics.pegRatio.toFixed(2)} (overvalued)`);
  }

  if (metrics.evToEbitda > 40) {
    score += 10;
    valuationSignals++;
    reasons.push(`EV/EBITDA ${metrics.evToEbitda.toFixed(1)} (stretched)`);
  }

  // CURRENT: Require at least 2 valuation extremes
  if (valuationSignals < 2) {
    return 0;
  }

  return score;
}

// Proposed logic (requires 1+ valuation signals)
function scoreShortValuationProposed(metrics, sectorConfig, reasons) {
  let score = 0;
  let valuationSignals = 0;
  const highPE = sectorConfig.peRange?.high || 40;

  if (metrics.peRatio > highPE * 1.5) {
    score += 20;
    valuationSignals++;
    reasons.push(`Extreme P/E: ${metrics.peRatio.toFixed(1)} (1.5x sector ceiling of ${highPE})`);
  } else if (metrics.peRatio > highPE) {
    score += 10;
    valuationSignals++;
  }

  if (metrics.pegRatio > 4.0) {
    score += 20;
    valuationSignals++;
    reasons.push(`PEG ${metrics.pegRatio.toFixed(2)} (severely overvalued)`);
  } else if (metrics.pegRatio > 3.0) {
    score += 10;
    valuationSignals++;
    reasons.push(`PEG ${metrics.pegRatio.toFixed(2)} (overvalued)`);
  }

  if (metrics.evToEbitda > 40) {
    score += 10;
    valuationSignals++;
    reasons.push(`EV/EBITDA ${metrics.evToEbitda.toFixed(1)} (stretched)`);
  }

  // PROPOSED: Require at least 1 valuation extreme
  if (valuationSignals < 1) {
    return 0;
  }

  return score;
}

function scoreDeterioration(metrics, reasons) {
  let score = 0;

  const deceleration = metrics.revenueGrowthPrevQ - metrics.revenueGrowthQ;
  if (deceleration > 0.10) {
    score += 25;
    reasons.push(`Revenue decelerating: ${(metrics.revenueGrowthPrevQ * 100).toFixed(0)}% → ${(metrics.revenueGrowthQ * 100).toFixed(0)}%`);
  } else if (deceleration > 0.05) {
    score += 12;
    reasons.push('Revenue growth slowing');
  }

  const marginCompression = metrics.operatingMarginPrev - metrics.operatingMargin;
  if (marginCompression > 0.05) {
    score += 25;
    reasons.push(`Margin compression: -${(marginCompression * 100).toFixed(1)}pp`);
  } else if (marginCompression > 0.02) {
    score += 12;
  }

  if (metrics.fcfGrowth < -0.20) {
    score += 20;
    reasons.push(`FCF declining ${(metrics.fcfGrowth * 100).toFixed(0)}%`);
  }

  if (metrics.earningsGrowth < 0 && metrics.peRatio > 30) {
    score += 20;
    reasons.push('Negative earnings growth with high P/E');
  }

  return score;
}

async function testShortLogic() {
  console.log('\n🧪 Testing Short Scoring Logic\n');
  console.log('Current: Requires 2+ valuation signals');
  console.log('Proposed: Requires 1+ valuation signals\n');

  try {
    // Get all stocks from saturday_watchlist with overvalued pathway
    const result = await db.query(`
      SELECT symbol, sector, metrics, reasons
      FROM saturday_watchlist
      WHERE intent = 'SHORT' AND pathway = 'overvalued'
      ORDER BY symbol
    `);

    const stocks = result.rows;
    console.log(`Testing ${stocks.length} short candidates\n`);

    let currentPassed = 0;
    let proposedPassed = 0;
    const examples = [];

    for (const stock of stocks) {
      const metrics = stock.metrics;
      const sectorConfig = { peRange: { high: 40 } }; // Simplified

      // Test current logic
      const currentReasons = [];
      const currentValScore = scoreShortValuationCurrent(metrics, sectorConfig, currentReasons);
      const currentDetScore = scoreDeterioration(metrics, currentReasons);
      const currentTotal = currentValScore + currentDetScore;
      const currentPass = currentValScore >= 20 && currentDetScore >= 20 && currentTotal >= 50;

      // Test proposed logic
      const proposedReasons = [];
      const proposedValScore = scoreShortValuationProposed(metrics, sectorConfig, proposedReasons);
      const proposedDetScore = scoreDeterioration(metrics, proposedReasons);
      const proposedTotal = proposedValScore + proposedDetScore;
      const proposedPass = proposedValScore >= 20 && proposedDetScore >= 20 && proposedTotal >= 50;

      if (currentPass) currentPassed++;
      if (proposedPass) proposedPassed++;

      // Collect examples where proposed logic makes a difference
      if (!currentPass && proposedPass) {
        examples.push({
          symbol: stock.symbol,
          peRatio: metrics.peRatio,
          currentValScore,
          proposedValScore,
          detScore: proposedDetScore,
          currentTotal,
          proposedTotal
        });
      }
    }

    console.log('📊 RESULTS:\n');
    console.log(`Current Logic:  ${currentPassed} shorts passed threshold`);
    console.log(`Proposed Logic: ${proposedPassed} shorts passed threshold`);
    console.log(`Difference:     +${proposedPassed - currentPassed} additional shorts\n`);

    if (examples.length > 0) {
      console.log(`\n📋 Examples of stocks that would pass with proposed logic:\n`);
      examples.slice(0, 5).forEach(ex => {
        console.log(`${ex.symbol}:`);
        console.log(`  P/E: ${ex.peRatio}`);
        console.log(`  Current: Val=${ex.currentValScore}, Det=${ex.detScore}, Total=${ex.currentTotal} ❌`);
        console.log(`  Proposed: Val=${ex.proposedValScore}, Det=${ex.detScore}, Total=${ex.proposedTotal} ✅\n`);
      });
    }

    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testShortLogic();
