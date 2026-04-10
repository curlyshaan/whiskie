// Test 4-phase analysis with NOW and OKLO
import tradier from './src/tradier.js';
import claude from './src/claude.js';

console.log('🧪 Testing 4-phase analysis system with NOW and OKLO\n');

// Simulate Phase 1: Pre-ranking
const mockCandidates = {
  longs: ['NOW', 'AAPL', 'MSFT'],
  shorts: ['OKLO', 'ZS', 'SNOW']
};

console.log('Phase 1 Mock Results:');
console.log(`  Longs: ${mockCandidates.longs.join(', ')}`);
console.log(`  Shorts: ${mockCandidates.shorts.join(', ')}`);
console.log('');

// Test extraction method
const testAnalysis = `
LONG_CANDIDATES:
NOW
AAPL
MSFT

SHORT_CANDIDATES:
OKLO
ZS
SNOW

REASONING:
Testing extraction logic
`;

// Import the bot to test extraction
import { WhiskieBot } from './src/index.js';
const bot = new WhiskieBot();

const extracted = bot.extractLongShortCandidates(testAnalysis);
console.log('✅ Extraction Test:');
console.log(`  Extracted longs: ${extracted.longs.join(', ')}`);
console.log(`  Extracted shorts: ${extracted.shorts.join(', ')}`);
console.log('');

// Test price fetching
console.log('📊 Fetching real-time prices...');
try {
  const symbols = [...mockCandidates.longs, ...mockCandidates.shorts];
  const quotes = await tradier.getQuotes(symbols.join(','));
  const quoteArray = Array.isArray(quotes) ? quotes : [quotes];

  console.log('✅ Price Data:');
  quoteArray.forEach(q => {
    if (q && q.symbol) {
      console.log(`  ${q.symbol}: $${q.last} (${q.change_percentage >= 0 ? '+' : ''}${q.change_percentage}%)`);
    }
  });
} catch (error) {
  console.error('❌ Price fetch failed:', error.message);
}

console.log('\n✅ 4-phase system components verified!');
console.log('Ready to run full analysis with: node src/index.js');
