// Simple test to verify 4-phase system is ready
import tradier from './src/tradier.js';

console.log('🧪 Testing 4-phase system readiness\n');

// Test 1: Check if we can fetch prices for NOW and OKLO
console.log('Test 1: Fetching prices for NOW and OKLO...');
try {
  const quotes = await tradier.getQuotes('NOW,OKLO');
  const quoteArray = Array.isArray(quotes) ? quotes : [quotes];

  console.log('✅ Price fetch successful:');
  quoteArray.forEach(q => {
    if (q && q.symbol) {
      console.log(`  ${q.symbol}: $${q.last} (${q.change_percentage >= 0 ? '+' : ''}${q.change_percentage}%)`);
    }
  });
} catch (error) {
  console.error('❌ Price fetch failed:', error.message);
  process.exit(1);
}

console.log('\n✅ System ready for 4-phase analysis!');
console.log('\nTo run full analysis:');
console.log('  node src/index.js');
console.log('\nExpected behavior:');
console.log('  Phase 1: Pre-ranking (1-2 min)');
console.log('  Phase 2: Long analysis (3-5 min, 50k tokens)');
console.log('  Phase 3: Short analysis (3-5 min, 50k tokens)');
console.log('  Phase 4: Portfolio construction (1-2 min, 20k tokens)');
console.log('  Total: 8-12 minutes with deep thinking');
