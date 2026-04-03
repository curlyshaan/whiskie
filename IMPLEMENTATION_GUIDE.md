# Whiskie Trading Bot - Implementation Guide

## Quick Start: Apply These Fixes in Order

### Fix 1: Update `fetchMarketData()` to Include Portfolio Stocks

**File:** `src/index.js` (replace lines 654-684)

```javascript
/**
 * Fetch real-time market data (including portfolio stocks)
 */
async fetchMarketData(portfolio) {
  try {
    // Get portfolio stock symbols
    const portfolioSymbols = portfolio.positions.map(p => p.symbol);
    
    // Market indices for context
    const marketIndices = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX', 'TLT', 'GLD', 'USO'];
    
    // Combine all symbols (remove duplicates)
    const allSymbols = [...new Set([...portfolioSymbols, ...marketIndices])];
    
    console.log(`📊 Fetching quotes for ${allSymbols.length} symbols...`);
    
    // Fetch all quotes
    const quotes = await tradier.getQuotes(allSymbols);
    
    const marketData = {};
    const quoteArray = Array.isArray(quotes) ? quotes : [quotes];
    
    quoteArray.forEach(q => {
      marketData[q.symbol] = {
        price: q.last,
        change: q.change,
        change_percentage: q.change_percentage,
        volume: q.volume,
        bid: q.bid,
        ask: q.ask
      };
    });
    
    console.log(`✅ Fetched ${Object.keys(marketData).length} quotes`);
    return marketData;
  } catch (error) {
    console.error('Error fetching market data:', error.message);
    return {};
  }
}
```

---

### Fix 2: Refresh Portfolio Prices Before Claude Analysis

**File:** `src/index.js` (in `runDeepAnalysis()` method, after line 437)

Replace this:
```javascript
// Fetch real-time market data
console.log('📊 Fetching real-time market data...');
const marketData = await this.fetchMarketData();
console.log('✅ Market data fetched');
console.log('');
```

With this:
```javascript
// Fetch real-time market data (including portfolio stocks)
console.log('📊 Fetching real-time market data...');
const marketData = await this.fetchMarketData(portfolio);
console.log('✅ Market data fetched');
console.log('');

// CRITICAL: Refresh portfolio prices with fresh quotes
console.log('💰 Refreshing portfolio prices with LIVE data...');
let pricesUpdated = 0;
for (const position of portfolio.positions) {
  if (marketData[position.symbol]) {
    const oldPrice = position.currentPrice;
    position.currentPrice = marketData[position.symbol].price;
    if (oldPrice !== position.currentPrice) {
      console.log(`   ${position.symbol}: $${oldPrice} → $${position.currentPrice}`);
      pricesUpdated++;
    }
  }
}
console.log(`✅ Updated ${pricesUpdated} position prices`);
console.log('');
```

---

### Fix 3: Update Claude Prompt to Emphasize Current Prices

**File:** `src/claude.js` (replace `buildDeepAnalysisPrompt()` method, lines 209-235)

```javascript
/**
 * Build deep analysis prompt with current prices emphasized
 */
buildDeepAnalysisPrompt(portfolio, market, news, economic, question) {
  return `You are Whiskie, an AI portfolio manager managing a $100,000 portfolio.

**⚠️ CRITICAL: All prices below are CURRENT (fetched in real-time just now)**

**Current Portfolio (with LIVE prices as of this moment):**
${JSON.stringify(portfolio, null, 2)}

**Market Context (LIVE prices):**
${JSON.stringify(market, null, 2)}

**Your Analysis MUST:**
1. Use ONLY the CURRENT prices provided above
2. Calculate all gains/losses based on CURRENT prices
3. Verify stop-loss and take-profit levels against CURRENT prices
4. Make recommendations based on CURRENT market conditions
5. If a stock price seems unusual, note the discrepancy in your analysis

**Recent News:**
${news}

**Economic Indicators:**
${JSON.stringify(economic, null, 2)}

**Think deeply about:**
- Multiple scenarios and outcomes
- Second-order effects
- Risk vs reward tradeoffs
- Alternative approaches
- What could go wrong

**Provide a thorough, well-reasoned answer with specific recommendations.**

${question}`;
}
```

---

### Fix 4: Add Economic Data Fetching

**File:** `src/index.js` (add new method after `fetchMarketData()`)

```javascript
/**
 * Fetch economic indicators
 */
async fetchEconomicData(marketData) {
  try {
    return {
      vix: marketData.VIX?.price || 'N/A',
      marketTrend: marketData.SPY?.change_percentage > 0 ? 'bullish' : 'bearish',
      sp500Change: marketData.SPY?.change_percentage || 0,
      nasdaqChange: marketData.QQQ?.change_percentage || 0,
      timestamp: new Date().toISOString(),
      note: 'Economic data from market indices. For full macro data, integrate FRED API.'
    };
  } catch (error) {
    console.error('Error fetching economic data:', error.message);
    return {};
  }
}
```

---

### Fix 5: Use Economic Data in Deep Analysis

**File:** `src/index.js` (in `runDeepAnalysis()` method, around line 513)

Replace this:
```javascript
const analysis = await claude.deepAnalysis(
  portfolio,
  marketData,
  news,
  {},
  question
);
```

With this:
```javascript
// Fetch economic indicators
const economicData = await this.fetchEconomicData(marketData);

const analysis = await claude.deepAnalysis(
  portfolio,
  marketData,
  news,
  economicData,  // ✅ Now populated
  question
);
```

---

### Fix 6: Improve Recommendation Parsing

**File:** `src/index.js` (replace `parseRecommendations()` method, lines 689-744)

```javascript
/**
 * Parse trade recommendations from Opus analysis
 */
parseRecommendations(analysisText) {
  const recommendations = [];

  try {
    // Look for BUY recommendations with pattern matching
    const buyPattern = /BUY\s+(\d+)\s+(?:shares?\s+)?([A-Z]{1,5})\s+at\s+\$?([\d.]+)/gi;
    
    let match;
    const matches = [];

    // Find all BUY statements
    while ((match = buyPattern.exec(analysisText)) !== null) {
      matches.push({
        fullMatch: match[0],
        quantity: parseInt(match[1]),
        symbol: match[2].toUpperCase(),
        entryPrice: parseFloat(match[3]),
        index: match.index
      });
    }

    console.log(`🔍 Found ${matches.length} BUY recommendations`);

    // For each BUY, find the nearest stop-loss and take-profit
    for (const buyMatch of matches) {
      const quantity = buyMatch.quantity;
      const symbol = buyMatch.symbol;
      const entryPrice = buyMatch.entryPrice;

      // Validate extracted data
      if (!symbol || symbol.length > 5 || quantity <= 0 || entryPrice <= 0) {
        console.warn(`⚠️ Invalid recommendation format: ${buyMatch.fullMatch}`);
        continue;
      }

      const textAfterBuy = analysisText.substring(buyMatch.index, buyMatch.index + 1500);

      // Find stop-loss
      const stopLossPattern = /Stop-loss:\s*\$?([\d.]+)/i;
      const slMatch = stopLossPattern.exec(textAfterBuy);
      const stopLoss = slMatch ? parseFloat(slMatch[1]) : null;

      // Find take-profit
      const takeProfitPattern = /Take-profit:\s*\$?([\d.]+)/i;
      const tpMatch = takeProfitPattern.exec(textAfterBuy);
      const takeProfit = tpMatch ? parseFloat(tpMatch[1]) : null;

      // Extract reasoning (next 500 chars after the BUY statement)
      const reasoning = textAfterBuy.substring(0, 500).trim();

      // Validate stop-loss and take-profit
      if (stopLoss && stopLoss >= entryPrice) {
        console.warn(`⚠️ Invalid stop-loss for ${symbol}: $${stopLoss} >= entry $${entryPrice}`);
      }
      if (takeProfit && takeProfit <= entryPrice) {
        console.warn(`⚠️ Invalid take-profit for ${symbol}: $${takeProfit} <= entry $${entryPrice}`);
      }

      recommendations.push({
        symbol,
        quantity,
        entryPrice,
        stopLoss,
        takeProfit,
        reasoning,
        timestamp: new Date()
      });

      console.log(`   ✅ ${symbol}: BUY ${quantity} @ $${entryPrice} (SL: $${stopLoss}, TP: $${takeProfit})`);
    }

    return recommendations;
  } catch (error) {
    console.error('Error parsing recommendations:', error.message);
    return [];
  }
}
```

---

### Fix 7: Add Stock-Specific News

**File:** `src/index.js` (in `runDeepAnalysis()` method, replace news fetching section around line 274)

Replace this:
```javascript
// Get market news
console.log('📰 Fetching market news...');
const marketNews = await tavily.searchMarketNews(5);
const formattedNews = tavily.formatResults(marketNews);
console.log(`   Found ${marketNews.length} articles\n`);
```

With this:
```javascript
// Get market news
console.log('📰 Fetching market news...');
const marketNews = await tavily.searchMarketNews(5);
const formattedNews = tavily.formatResults(marketNews);
console.log(`   Found ${marketNews.length} market articles`);

// Get stock-specific news for portfolio holdings
console.log('📰 Fetching stock-specific news...');
const stockNews = {};
let stockNewsCount = 0;

for (const position of portfolio.positions) {
  try {
    const news = await tavily.searchStockNews(position.symbol, 2);
    if (news && news.length > 0) {
      stockNews[position.symbol] = tavily.formatResults(news);
      stockNewsCount += news.length;
    }
  } catch (err) {
    console.warn(`   ⚠️ Could not fetch news for ${position.symbol}`);
  }
}

console.log(`   Found ${stockNewsCount} stock-specific articles\n`);

// Combine all news
const combinedNews = `
**Market News:**
${formattedNews}

**Stock-Specific News:**
${Object.entries(stockNews).map(([symbol, news]) => `
**${symbol}:**
${news}
`).join('\n')}
`;
```

Then update the claude call to use `combinedNews` instead of `formattedNews`:
```javascript
const analysis = await claude.deepAnalysis(
  portfolio,
  marketData,
  combinedNews,  // ✅ Changed from formattedNews
  economicData,
  question
);
```

---

### Fix 8: Add Price Validation Before Trade Execution

**File:** `src/index.js` (in `executeTrade()` method, after line 814)

Replace this:
```javascript
// Get current price
const quote = await tradier.getQuote(symbol);
const price = quote.last;
```

With this:
```javascript
// Get current price
const quote = await tradier.getQuote(symbol);
const price = quote.last;

// Log price info
console.log(`   Current market price: $${price}`);
```

Then in the `runDeepAnalysis()` method, when calling `executeTrade()`, pass the recommended price:

Replace this (around line 587):
```javascript
await this.executeTrade(rec.symbol, 'buy', rec.quantity);
```

With this:
```javascript
await this.executeTrade(rec.symbol, 'buy', rec.quantity, rec.entryPrice);
```

Then update `executeTrade()` signature:
```javascript
async executeTrade(symbol, action, quantity, recommendedPrice = null) {
  try {
    console.log(`\n💼 Executing ${action.toUpperCase()} ${quantity} ${symbol}...`);

    // Get current price
    const quote = await tradier.getQuote(symbol);
    const price = quote.last;

    // Validate price hasn't moved too much
    if (recommendedPrice) {
      const priceChange = Math.abs((price - recommendedPrice) / recommendedPrice);
      if (priceChange > 0.05) { // 5% slippage threshold
        console.warn(`⚠️ Price has moved ${(priceChange * 100).toFixed(1)}% since recommendation`);
        console.warn(`   Recommended: $${recommendedPrice}, Current: $${price}`);
        console.warn(`   Proceeding with execution at current market price`);
      }
    }

    console.log(`   Current market price: $${price}`);
    
    // ... rest of execution ...
```

---

## Testing Checklist

After applying all fixes, verify:

- [ ] **Price Refresh:** Run analysis and check logs show portfolio prices being updated
- [ ] **Claude Receives Prices:** Check that portfolio positions in Claude prompt have current prices
- [ ] **Recommendation Parsing:** Verify recommendations are extracted correctly with validation
- [ ] **Economic Data:** Check that economic data is populated (not empty `{}`)
- [ ] **Stock News:** Verify stock-specific news appears in logs
- [ ] **Trade Execution:** Execute a test trade and verify price validation works
- [ ] **Paper Trading:** Test full flow in paper trading mode first
- [ ] **Price Discrepancies:** Monitor logs for any price mismatches

---

## Verification Commands

### Check if portfolio prices are being fetched:
```bash
grep -n "Refreshing portfolio prices" src/index.js
grep -n "Updated.*position prices" src/index.js
```

### Check if Claude receives current prices:
```bash
grep -n "CRITICAL: All prices below are CURRENT" src/claude.js
```

### Check if economic data is used:
```bash
grep -n "economicData" src/index.js
```

### Check if stock news is fetched:
```bash
grep -n "stock-specific news" src/index.js
```

---

## Common Issues & Solutions

### Issue: "Portfolio prices not updating"
**Solution:** Verify `fetchMarketData()` is called with `portfolio` parameter:
```javascript
const marketData = await this.fetchMarketData(portfolio);  // ✅ Pass portfolio
```

### Issue: "Claude still getting empty economic data"
**Solution:** Verify `fetchEconomicData()` is called before `deepAnalysis()`:
```javascript
const economicData = await this.fetchEconomicData(marketData);
const analysis = await claude.deepAnalysis(..., economicData, ...);
```

### Issue: "Recommendations not parsing"
**Solution:** Check Claude's output format matches the regex pattern:
```
✅ Correct: "BUY 10 shares AAPL at $228"
❌ Wrong: "Consider buying 10 AAPL around $228"
```

### Issue: "Stock news not appearing"
**Solution:** Verify Tavily API key is set and portfolio has positions:
```bash
echo $TAVILY_API_KEY  # Should not be empty
```

---

## Performance Notes

- **API Calls:** Fetching all portfolio stocks + 8 indices may add 1-2 seconds
- **News Fetching:** Stock-specific news adds ~2-3 seconds per position
- **Total Impact:** ~5-10 seconds additional per analysis run
- **Optimization:** Can batch news requests or cache results if needed

---

## Rollback Plan

If issues occur, revert changes in this order:
1. Remove stock-specific news fetching (keep market news)
2. Remove economic data (keep empty `{}`)
3. Revert `fetchMarketData()` to original (8 indices only)
4. Revert Claude prompt to original

Each step is independent and can be reverted without affecting others.

