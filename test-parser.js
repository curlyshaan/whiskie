/**
 * Test the trade parser with sample Phase 4 output
 */

// Simulate the parser function
function parseRecommendations(analysisText) {
  const recommendations = [];
  const allTradeMatches = [];

  // Parse EXECUTE_BUY
  const buyPattern = /EXECUTE_BUY:\s*([A-Z]{1,5})\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/gi;
  let match;
  while ((match = buyPattern.exec(analysisText)) !== null) {
    allTradeMatches.push({
      type: 'long',
      symbol: match[1],
      quantity: parseInt(match[2]),
      entryPrice: parseFloat(match[3]),
      stopLoss: parseFloat(match[4]),
      takeProfit: parseFloat(match[5]),
      index: match.index,
      endIndex: match.index + match[0].length
    });
  }

  // Parse EXECUTE_SHORT
  const shortPattern = /EXECUTE_SHORT:\s*([A-Z]{1,5})\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/gi;
  while ((match = shortPattern.exec(analysisText)) !== null) {
    allTradeMatches.push({
      type: 'short',
      symbol: match[1],
      quantity: parseInt(match[2]),
      entryPrice: parseFloat(match[3]),
      stopLoss: parseFloat(match[4]),
      takeProfit: parseFloat(match[5]),
      index: match.index,
      endIndex: match.index + match[0].length
    });
  }

  // Sort by position in text
  allTradeMatches.sort((a, b) => a.index - b.index);

  // Extract reasoning for each trade
  for (let i = 0; i < allTradeMatches.length; i++) {
    const trade = allTradeMatches[i];
    const nextTrade = allTradeMatches[i + 1];

    const reasoningStart = trade.endIndex;
    const reasoningEnd = nextTrade ? nextTrade.index : analysisText.length;
    let reasoning = analysisText.substring(reasoningStart, reasoningEnd).trim();

    reasoning = reasoning
      .replace(/^[\s\-\*]+/, '')
      .replace(/EXECUTE_(BUY|SHORT):.*$/s, '')
      .trim();

    if (reasoning.length > 1000) {
      reasoning = reasoning.substring(0, 1000) + '...';
    }

    recommendations.push({
      type: trade.type,
      symbol: trade.symbol,
      quantity: trade.quantity,
      entryPrice: trade.entryPrice,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      reasoning: reasoning || `${trade.type === 'long' ? 'Long' : 'Short'} position in ${trade.symbol}`
    });
  }

  return recommendations;
}

// Test Case 1: OLD FORMAT (should fail to parse most trades)
console.log('=== TEST 1: OLD FORMAT (broken) ===');
const oldFormat = `
EXECUTE_BUY:
AVGO | 26 | 373.96 | 355.00 | 420.00
TSM | 26 | 377.12 | 360.00 | 415.00
PANW | 32 | 155.73 | 165.00 | 140.00

EXECUTE_SHORT:
NET | 45 | 177.72 | 186.60 | 151.06
NOW | 95 | 84.23 | 88.44 | 71.60
`;

const oldResults = parseRecommendations(oldFormat);
console.log(`Parsed ${oldResults.length} trades (expected 0 - format is wrong)`);
console.log('');

// Test Case 2: NEW FORMAT (should parse all trades correctly)
console.log('=== TEST 2: NEW FORMAT (correct) ===');
const newFormat = `
**FINAL EXECUTION COMMANDS:**

EXECUTE_BUY: AVGO | 26 | 373.96 | 355.00 | 420.00
Strong momentum in semiconductors with AI tailwinds.

EXECUTE_BUY: TSM | 26 | 377.12 | 360.00 | 415.00
Taiwan Semi leading edge node advantage.

EXECUTE_BUY: PANW | 32 | 155.73 | 148.00 | 165.00
Cybersecurity leader with strong growth.

EXECUTE_SHORT: NET | 45 | 177.72 | 186.60 | 151.06
Overvalued cloud stock with slowing growth.

EXECUTE_SHORT: NOW | 95 | 84.23 | 88.44 | 71.60
ServiceNow facing margin pressure.

EXECUTE_SHORT: ARES | 120 | 99.16 | 104.50 | 89.24
Private equity headwinds in rising rate environment.
`;

const newResults = parseRecommendations(newFormat);
console.log(`Parsed ${newResults.length} trades (expected 6)`);
console.log('');

newResults.forEach((trade, i) => {
  console.log(`${i + 1}. ${trade.type.toUpperCase()}: ${trade.symbol}`);
  console.log(`   Entry: $${trade.entryPrice}, Stop: $${trade.stopLoss}, Target: $${trade.takeProfit}`);
  console.log(`   Reasoning: ${trade.reasoning.substring(0, 80)}...`);
  console.log('');
});

// Test Case 3: Mixed reasoning (verify no bleed between trades)
console.log('=== TEST 3: REASONING ISOLATION ===');
const mixedFormat = `
EXECUTE_BUY: AVGO | 26 | 373.96 | 355.00 | 420.00
This is AVGO reasoning only.
EXECUTE_BUY: TSM | 26 | 377.12 | 360.00 | 415.00
This is TSM reasoning only.
`;

const mixedResults = parseRecommendations(mixedFormat);
console.log(`Trade 1 (AVGO) reasoning: "${mixedResults[0].reasoning}"`);
console.log(`Trade 2 (TSM) reasoning: "${mixedResults[1].reasoning}"`);
console.log('');
console.log('✅ PASS if AVGO reasoning does NOT contain "TSM"');
console.log(`   Result: ${mixedResults[0].reasoning.includes('TSM') ? '❌ FAIL' : '✅ PASS'}`);
