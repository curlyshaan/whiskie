# Whiskie Bot - Quick Reference Guide

## The Core Problem

```
Claude Opus analyzes portfolio WITHOUT current stock prices
                    ↓
        Makes recommendations based on stale data
                    ↓
        Trades execute at different prices
                    ↓
        Results don't match analysis
```

---

## The 3 Critical Fixes (Do These First)

### Fix #1: Fetch Portfolio Stock Prices
```javascript
// BEFORE (only 8 indices)
const symbols = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX', 'TLT', 'GLD', 'USO'];

// AFTER (all portfolio stocks + indices)
const portfolioSymbols = portfolio.positions.map(p => p.symbol);
const marketIndices = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX', 'TLT', 'GLD', 'USO'];
const allSymbols = [...new Set([...portfolioSymbols, ...marketIndices])];
```

### Fix #2: Refresh Prices Before Claude
```javascript
// BEFORE (stale prices)
const portfolio = await analysisEngine.getPortfolioState();
const marketData = await this.fetchMarketData();
// Send to Claude with stale prices ❌

// AFTER (fresh prices)
const portfolio = await analysisEngine.getPortfolioState();
const marketData = await this.fetchMarketData(portfolio);
// Refresh prices
for (const position of portfolio.positions) {
  if (marketData[position.symbol]) {
    position.currentPrice = marketData[position.symbol].price;
  }
}
// Send to Claude with fresh prices ✅
```

### Fix #3: Tell Claude Prices Are Current
```javascript
// BEFORE
return `You are Whiskie...
**Current Portfolio:**
${JSON.stringify(portfolio, null, 2)}`;

// AFTER
return `You are Whiskie...
**⚠️ CRITICAL: All prices below are CURRENT (fetched in real-time just now)**
**Current Portfolio (with LIVE prices as of this moment):**
${JSON.stringify(portfolio, null, 2)}`;
```

---

## The 5 Additional Fixes (Do These Second)

### Fix #4: Add Economic Data
```javascript
async fetchEconomicData(marketData) {
  return {
    vix: marketData.VIX?.price || 'N/A',
    marketTrend: marketData.SPY?.change_percentage > 0 ? 'bullish' : 'bearish',
    sp500Change: marketData.SPY?.change_percentage || 0,
    nasdaqChange: marketData.QQQ?.change_percentage || 0,
    timestamp: new Date().toISOString()
  };
}
```

### Fix #5: Add Stock-Specific News
```javascript
// BEFORE
const marketNews = await tavily.searchMarketNews(5);
const formattedNews = tavily.formatResults(marketNews);

// AFTER
const marketNews = await tavily.searchMarketNews(5);
const formattedNews = tavily.formatResults(marketNews);

const stockNews = {};
for (const position of portfolio.positions) {
  const news = await tavily.searchStockNews(position.symbol, 2);
  stockNews[position.symbol] = tavily.formatResults(news);
}

const combinedNews = `
**Market News:**
${formattedNews}

**Stock-Specific News:**
${Object.entries(stockNews).map(([symbol, news]) => `${symbol}:\n${news}`).join('\n')}
`;
```

### Fix #6: Improve Recommendation Parsing
```javascript
// Add validation
if (!symbol || symbol.length > 5 || quantity <= 0 || entryPrice <= 0) {
  console.warn(`⚠️ Invalid recommendation: ${match[0]}`);
  continue;
}

// Validate stop-loss and take-profit
if (stopLoss && stopLoss >= entryPrice) {
  console.warn(`⚠️ Invalid stop-loss for ${symbol}`);
}
if (takeProfit && takeProfit <= entryPrice) {
  console.warn(`⚠️ Invalid take-profit for ${symbol}`);
}
```

### Fix #7: Validate Prices Before Trade
```javascript
async executeTrade(symbol, action, quantity, recommendedPrice = null) {
  const quote = await tradier.getQuote(symbol);
  const price = quote.last;
  
  if (recommendedPrice) {
    const priceChange = Math.abs((price - recommendedPrice) / recommendedPrice);
    if (priceChange > 0.05) { // 5% threshold
      console.warn(`⚠️ Price moved ${(priceChange * 100).toFixed(1)}%`);
      console.warn(`   Recommended: $${recommendedPrice}, Current: $${price}`);
    }
  }
  
  // Continue with execution...
}
```

### Fix #8: Pass Recommended Price to executeTrade
```javascript
// BEFORE
await this.executeTrade(rec.symbol, 'buy', rec.quantity);

// AFTER
await this.executeTrade(rec.symbol, 'buy', rec.quantity, rec.entryPrice);
```

---

## File Changes Summary

### `src/index.js`
- [ ] Update `fetchMarketData()` signature to accept `portfolio`
- [ ] Add portfolio symbols to fetch list
- [ ] Add price refresh loop after fetching market data
- [ ] Add `fetchEconomicData()` method
- [ ] Update `runDeepAnalysis()` to fetch stock-specific news
- [ ] Update `runDeepAnalysis()` to use `economicData`
- [ ] Improve `parseRecommendations()` with validation
- [ ] Update `executeTrade()` signature to accept `recommendedPrice`
- [ ] Add price validation in `executeTrade()`
- [ ] Pass `rec.entryPrice` when calling `executeTrade()`

### `src/claude.js`
- [ ] Update `buildDeepAnalysisPrompt()` to emphasize current prices
- [ ] Add "CRITICAL" warning about prices being current
- [ ] Add instructions for Claude to use current prices

---

## Verification Checklist

After each fix, verify:

```bash
# Fix 1: Portfolio stocks in fetchMarketData
grep -A 5 "const portfolioSymbols" src/index.js

# Fix 2: Price refresh loop
grep -A 3 "Refreshing portfolio prices" src/index.js

# Fix 3: Claude prompt emphasizes prices
grep "CRITICAL: All prices below are CURRENT" src/claude.js

# Fix 4: Economic data fetching
grep -A 5 "fetchEconomicData" src/index.js

# Fix 5: Stock-specific news
grep "searchStockNews" src/index.js

# Fix 6: Recommendation validation
grep "Invalid recommendation" src/index.js

# Fix 7: Price validation
grep "priceChange > 0.05" src/index.js

# Fix 8: Recommended price passed
grep "executeTrade.*entryPrice" src/index.js
```

---

## Testing Commands

```bash
# Test in paper trading mode
NODE_ENV=paper npm start

# Check logs for price updates
tail -f logs/whiskie.log | grep "Refreshing portfolio prices"

# Check for price discrepancies
tail -f logs/whiskie.log | grep "Price has moved"

# Verify Claude receives prices
tail -f logs/whiskie.log | grep "CRITICAL: All prices"
```

---

## Common Mistakes to Avoid

❌ **Don't forget to pass `portfolio` to `fetchMarketData()`**
```javascript
// Wrong
const marketData = await this.fetchMarketData();

// Right
const marketData = await this.fetchMarketData(portfolio);
```

❌ **Don't forget to refresh prices after fetching**
```javascript
// Wrong
const marketData = await this.fetchMarketData(portfolio);
// Send to Claude immediately

// Right
const marketData = await this.fetchMarketData(portfolio);
for (const position of portfolio.positions) {
  if (marketData[position.symbol]) {
    position.currentPrice = marketData[position.symbol].price;
  }
}
// Now send to Claude
```

❌ **Don't forget to update Claude prompt**
```javascript
// Wrong - Claude doesn't know prices are current
return `You are Whiskie...
**Current Portfolio:**
${JSON.stringify(portfolio, null, 2)}`;

// Right - Claude knows prices are current
return `You are Whiskie...
**⚠️ CRITICAL: All prices below are CURRENT (fetched in real-time just now)**
**Current Portfolio (with LIVE prices as of this moment):**
${JSON.stringify(portfolio, null, 2)}`;
```

❌ **Don't forget to pass `economicData` to Claude**
```javascript
// Wrong
const analysis = await claude.deepAnalysis(portfolio, marketData, news, {}, question);

// Right
const economicData = await this.fetchEconomicData(marketData);
const analysis = await claude.deepAnalysis(portfolio, marketData, news, economicData, question);
```

---

## Expected Results After Fixes

### Before
```
📊 Fetching real-time market data...
✅ Market data fetched

🧠 STARTING DEEP ANALYSIS WITH OPUS
Portfolio: $100,000
Positions: 5
Cash: $20,000

📝 Sending question to Opus...
⏳ Extended thinking enabled (50,000 tokens MAX)
⏳ This will take 3-7 minutes...

✅ OPUS ANALYSIS COMPLETE
Duration: 245.3 seconds
Response length: 3847 characters

🔍 Parsing trade recommendations...
❌ No trade recommendations found (holding cash)
```

### After
```
📊 Fetching real-time market data...
✅ Market data fetched

💰 Refreshing portfolio prices with LIVE data...
   AAPL: $150 → $228.45
   MSFT: $300 → $425.30
   TSLA: $200 → $245.67
✅ Updated 3 position prices

📰 Fetching market news...
   Found 5 market articles
📰 Fetching stock-specific news...
   Found 6 stock-specific articles

🧠 STARTING DEEP ANALYSIS WITH OPUS
Portfolio: $100,000
Positions: 5
Cash: $20,000

📝 Sending question to Opus...
⏳ Extended thinking enabled (50,000 tokens MAX)
⏳ This will take 3-7 minutes...

✅ OPUS ANALYSIS COMPLETE
Duration: 287.4 seconds
Response length: 4521 characters

🔍 Parsing trade recommendations...
🔍 Found 2 BUY recommendations
   ✅ AAPL: BUY 5 @ $228.45 (SL: $205.65, TP: $262.74)
   ✅ MSFT: BUY 3 @ $425.30 (SL: $382.77, TP: $489.10)

💰 Executing trade: BUY 5 AAPL at $228.45...
   Current market price: $228.50
   ✅ Trade executed successfully
   📧 Confirmation email sent
```

---

## Performance Impact

- **Before:** ~4 minutes (Opus analysis only)
- **After:** ~4.5-5 minutes (Opus + fresh data fetching)
- **Additional time:** ~30-60 seconds
- **Worth it:** Yes, because decisions are now based on current data

---

## Rollback Plan

If something breaks, revert in this order:

1. Remove stock-specific news (keep market news)
2. Remove economic data (keep empty `{}`)
3. Revert `fetchMarketData()` to original
4. Revert Claude prompt to original

Each step is independent.

---

## Success Indicators

✅ Logs show "Refreshing portfolio prices"
✅ Logs show price updates (e.g., "AAPL: $150 → $228.45")
✅ Claude prompt includes "CRITICAL: All prices below are CURRENT"
✅ Logs show "Found X stock-specific articles"
✅ Logs show "Found X BUY recommendations"
✅ Trade execution shows current market price
✅ No "Price has moved" warnings (or only minor ones)

---

## Questions?

- **Q: Will this slow down the bot?**
  A: Yes, by ~30-60 seconds per analysis. Worth it for accurate decisions.

- **Q: What if API rate limits are hit?**
  A: Batch requests or cache results. Low likelihood with Tradier's limits.

- **Q: What if a stock price changes between analysis and execution?**
  A: That's normal. The 5% validation threshold catches major moves.

- **Q: Do I need to change anything else?**
  A: No. These 8 fixes are all that's needed.

- **Q: Can I apply fixes one at a time?**
  A: Yes. Fixes 1-3 are critical and should be done together. Fixes 4-8 are independent.

