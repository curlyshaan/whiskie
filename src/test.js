import tradier from './tradier.js';
import claude from './claude.js';
import tavily from './tavily.js';
import email from './email.js';
import riskManager from './risk-manager.js';

/**
 * Test all API integrations
 */
async function testAPIs() {
  console.log('🧪 Testing Whiskie API Integrations...\n');

  // Test 1: Tradier API
  console.log('1️⃣ Testing Tradier API...');
  try {
    const quote = await tradier.getQuote('AAPL');
    console.log('✅ Tradier working - AAPL price:', quote.last);

    const isOpen = await tradier.isMarketOpen();
    console.log('✅ Market status:', isOpen ? 'OPEN' : 'CLOSED');
  } catch (error) {
    console.error('❌ Tradier error:', error.message);
  }

  console.log('');

  // Test 2: Claude API
  console.log('2️⃣ Testing Claude API...');
  try {
    const response = await claude.quickSentimentCheck('Stock market rallies on positive earnings reports');
    console.log('✅ Claude working - Sentiment:', response.analysis.substring(0, 100) + '...');
  } catch (error) {
    console.error('❌ Claude error:', error.message);
  }

  console.log('');

  // Test 3: Tavily API
  console.log('3️⃣ Testing Tavily API...');
  try {
    const news = await tavily.searchStockNews('AAPL', 2);
    console.log('✅ Tavily working - Found', news.length, 'news articles');
    if (news.length > 0) {
      console.log('   Latest:', news[0].title.substring(0, 80) + '...');
    }
  } catch (error) {
    console.error('❌ Tavily error:', error.message);
  }

  console.log('');

  // Test 4: Email
  console.log('4️⃣ Testing Email...');
  try {
    await email.testEmail();
    console.log('✅ Email sent - Check your inbox!');
  } catch (error) {
    console.error('❌ Email error:', error.message);
  }

  console.log('');

  // Test 5: Risk Manager
  console.log('5️⃣ Testing Risk Manager...');
  try {
    const mockPortfolio = {
      totalValue: 100000,
      cash: 10000,
      positions: [],
      drawdown: -0.05
    };

    const mockTrade = {
      action: 'buy',
      symbol: 'AAPL',
      quantity: 10,
      price: 150,
      sector: 'Technology'
    };

    const validation = riskManager.validateTrade(mockTrade, mockPortfolio);
    console.log('✅ Risk Manager working');
    console.log('   Trade valid:', validation.valid);
    if (validation.errors.length > 0) {
      console.log('   Errors:', validation.errors);
    }
    if (validation.warnings.length > 0) {
      console.log('   Warnings:', validation.warnings);
    }
  } catch (error) {
    console.error('❌ Risk Manager error:', error.message);
  }

  console.log('\n✅ All tests complete!\n');
}

// Run tests
testAPIs().catch(console.error);
