# Whiskie Trading Bot - Complete Data Flow Audit

## EXECUTIVE SUMMARY

**CRITICAL FINDING:** The bot has a **fundamental architectural flaw** in its real-time data flow. Claude Opus receives **NO current stock prices** for the portfolio positions it's supposed to analyze and trade. This means:

- ❌ Opus analyzes portfolio with **stale/missing price data**
- ❌ Opus cannot make informed decisions about current positions
- ❌ Trade recommendations are based on incomplete information
- ❌ Risk calculations are inaccurate
- ❌ The bot is essentially **flying blind**

---

## 1. COMPLETE DATA FLOW TRACE

### 1.1 Where Tradier API is Called

**File: `src/index.js` - `runDailyAnalysis()` method (line 201)**

```
runDailyAnalysis()
  ├─ tradier.isMarketOpen() [line 215]
  ├─ analysisEngine.getPortfolioState() [line 220]
  │   └─ tradier.getBalances() [analysis.js:21]
  │   └─ tradier.getPositions() [analysis.js:22]
  │   └─ getPositions() from DB [analysis.js:23]
  ├─ analysisEngine.analyzePortfolioHealth() [line 228]
  ├─ tavily.searchMarketNews() [line 274]
  └─ claude.quickSentimentCheck() [line 280]
```

**File: `src/index.js` - `runDeepAnalysis()` method (line 424)**

```
runDeepAnalysis()
  ├─ fetchMarketData() [line 437]
  │   └─ tradier.getQuotes(['SPY', 'QQQ', 'DIA', 'IWM', 'VIX', 'TLT', 'GLD', 'USO'])
  │       ✅ Gets 8 market ETFs ONLY
  │       ❌ Does NOT get portfolio stock prices
  ├─ getPreviousAnalyses() [line 443]
  ├─ claude.deepAnalysis() [line 513]
  │   └─ Sends: portfolio, marketData, news, {}, question
  └─ parseRecommendations() [line 577]
```

### 1.2 What Data is Fetched

**Market Data (from `fetchMarketData()` - line 654):**
```javascript
const symbols = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX', 'TLT', 'GLD', 'USO'];
const quotes = await tradier.getQuotes(symbols);
```

**Result:** Only 8 market indices/ETFs. **NO portfolio stock prices.**

**Portfolio Data (from `getPortfolioState()` - analysis.js:19):**
```javascript
const balances = await tradier.getBalances();
const positions = await tradier.getPositions();
const dbPositions = await getPositions();
```

**Result:** Position quantities and cost basis, but **current prices are stale** (from last API call, not real-time).

### 1.3 How Data is Passed to Claude Opus

**File: `src/index.js` - `runDeepAnalysis()` (line 513)**

```javascript
const analysis = await claude.deepAnalysis(
  portfolio,           // ← Portfolio with stale prices
  marketData,          // ← Only 8 market ETFs
  news,                // ← Market news (good)
  {},                  // ← Empty economic data
  question             // ← The analysis question
);
```

**File: `src/claude.js` - `deepAnalysis()` (line 91)**

```javascript
async deepAnalysis(portfolioData, marketData, newsData, economicData, question) {
  const prompt = this.buildDeepAnalysisPrompt(
    portfolioData,
    marketData,
    newsData,
    economicData,
    question
  );
  // ... sends to Claude
}
```

**File: `src/claude.js` - `buildDeepAnalysisPrompt()` (line 209)**

```javascript
buildDeepAnalysisPrompt(portfolio, market, news, economic, question) {
  return `You are Whiskie, an AI portfolio manager. Use extended thinking to deeply analyze this question.

**Question:**
${question}

**Current Portfolio:**
${JSON.stringify(portfolio, null, 2)}

**Market Context:**
${JSON.stringify(market, null, 2)}

**Recent News:**
${news}

**Economic Data:**
${JSON.stringify(economic, null, 2)}
...`;
}
```

### 1.4 Does Opus Actually Receive and Use Current Stock Prices?

**❌ NO. Critical Issues:**

1. **Portfolio prices are stale:**
   - `portfolio.positions[].currentPrice` comes from `tradier.getPositions()` 
   - This returns `quote.last` from the last API call
   - Not refreshed before sending to Claude

2. **No individual stock prices in marketData:**
   - Only 8 market ETFs: SPY, QQQ, DIA, IWM, VIX, TLT, GLD, USO
   - Portfolio stocks (e.g., AAPL, MSFT, TSLA) are NOT included
   - Claude cannot see current prices for stocks it's supposed to trade

3. **Economic data is empty:**
   - `economicData` parameter is always `{}`
   - No interest rates, inflation, unemployment data
   - Claude has no macro context

4. **Opus prompt doesn't request price fetching:**
   - The question tells Opus to make recommendations
   - But Opus has no instruction to use/verify current prices
   - Opus doesn't know prices are stale

---

## 2. ALL IDENTIFIED GAPS

### Gap 1: Missing Stock Price Fetches
**Location:** `src/index.js` - `fetchMarketData()` (line 654)

**Problem:**
```javascript
async fetchMarketData() {
  const symbols = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX', 'TLT', 'GLD', 'USO'];
  const quotes = await tradier.getQuotes(symbols);
  // ❌ Only fetches 8 market ETFs
  // ❌ Doesn't fetch portfolio stock prices
}
```

**Impact:** Opus doesn't know current prices of stocks in the portfolio.

---

### Gap 2: Portfolio Prices Not Refreshed
**Location:** `src/analysis.js` - `getPortfolioState()` (line 19)

**Problem:**
```javascript
async getPortfolioState() {
  const balances = await tradier.getBalances();
  const positions = await tradier.getPositions();
  // ❌ getPositions() returns stale prices
  // ❌ No fresh quote fetch for each position
}
```

**Impact:** Portfolio data sent to Claude has outdated prices.

---

### Gap 3: Data Not Passed to Claude
**Location:** `src/index.js` - `runDeepAnalysis()` (line 513)

**Problem:**
```javascript
const analysis = await claude.deepAnalysis(
  portfolio,      // Has stale prices
  marketData,     // Only 8 ETFs, no portfolio stocks
  news,           // ✅ Good
  {},             // ❌ Empty economic data
  question        // ✅ Good
);
```

**Impact:** Claude receives incomplete market context.

---

### Gap 4: Claude Not Told to Use Current Prices
**Location:** `src/claude.js` - `buildDeepAnalysisPrompt()` (line 209)

**Problem:**
```javascript
buildDeepAnalysisPrompt(portfolio, market, news, economic, question) {
  return `You are Whiskie, an AI portfolio manager...
**Current Portfolio:**
${JSON.stringify(portfolio, null, 2)}

**Market Context:**
${JSON.stringify(market, null, 2)}
...`;
  // ❌ No instruction to verify/use current prices
  // ❌ No warning about stale data
  // ❌ No request to validate prices
}
```

**Impact:** Opus doesn't know to question stale prices or request fresh data.

---

### Gap 5: Trade Execution Uses Stale Prices
**Location:** `src/index.js` - `executeTrade()` (line 809)

**Problem:**
```javascript
async executeTrade(symbol, action, quantity) {
  // ✅ Gets current price before executing
  const quote = await tradier.getQuote(symbol);
  const price = quote.last;
  // ✅ This is good - but happens AFTER Opus decision
  // ❌ Opus didn't have this price when making recommendation
}
```

**Impact:** Trade price may differ significantly from what Opus analyzed.

---

### Gap 6: parseRecommendations() Fragile
**Location:** `src/index.js` - `parseRecommendations()` (line 689)

**Problem:**
```javascript
parseRecommendations(analysisText) {
  const buyPattern = /BUY\s+(\d+)\s+(?:shares?\s+)?([A-Z]{1,5})\s+at\s+\$?([\d.]+)/gi;
  // ❌ Regex-based parsing is fragile
  // ❌ Depends on exact format from Opus
  // ❌ No validation of extracted data
  // ❌ No error handling for malformed recommendations
}
```

**Impact:** If Opus format changes, parsing fails silently.

---

### Gap 7: Tavily News Not Integrated Properly
**Location:** `src/index.js` - `runDailyAnalysis()` (line 274)

**Problem:**
```javascript
const marketNews = await tavily.searchMarketNews(5);
const formattedNews = tavily.formatResults(marketNews);
// ✅ News is fetched
// ❌ But in runDeepAnalysis(), news is passed but not stock-specific
// ❌ No sector-specific news
// ❌ No news for individual portfolio stocks
```

**Impact:** Opus gets generic market news, not specific to portfolio holdings.

---

### Gap 8: Economic Data Never Fetched
**Location:** `src/index.js` - `runDeepAnalysis()` (line 513)

**Problem:**
```javascript
const analysis = await claude.deepAnalysis(
  portfolio,
  marketData,
  news,
  {},  // ❌ Always empty
  question
);
```

**Impact:** Opus has no macro context (interest rates, inflation, unemployment, etc.).

---

### Gap 9: Risk Manager Uses Stale Prices
**Location:** `src/risk-manager.js` - `validateTrade()` (line 35)

**Problem:**
```javascript
validateTrade(trade, portfolio) {
  const tradeValue = trade.quantity * trade.price;
  // ✅ Uses trade.price passed in
  // ❌ But portfolio.positions have stale currentPrice
  // ❌ Risk calculations based on stale data
}
```

**Impact:** Risk validation is inaccurate.

---

## 3. DESIGN: THE CORRECT SOLUTION

### 3.1 What Stocks Should We Fetch Prices For?

**Answer: ALL portfolio stocks + market indices**

```javascript
// Portfolio stocks (from current positions)
const portfolioSymbols = portfolio.positions.map(p => p.symbol);

// Market indices for context
const marketIndices = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX', 'TLT', 'GLD', 'USO'];

// Combine and fetch
const allSymbols = [...new Set([...portfolioSymbols, ...marketIndices])];
const quotes = await tradier.getQuotes(allSymbols);
```

---

### 3.2 How Should We Format Data for Claude?

**Current (broken):**
```javascript
{
  "positions": [
    {
      "symbol": "AAPL",
      "quantity": 10,
      "cost_basis": 150,
      "currentPrice": 145  // ❌ Stale
    }
  ]
}
```

**Correct:**
```javascript
{
  "positions": [
    {
      "symbol": "AAPL",
      "quantity": 10,
      "cost_basis": 150,
      "currentPrice": 228.45,  // ✅ Fresh
      "gain": "+52.3%",
      "value": 2284.50,
      "sector": "Technology",
      "stop_loss": 205.65,
      "take_profit": 262.74
    }
  ],
  "marketContext": {
    "SPY": { "price": 580.25, "change": "+1.2%" },
    "QQQ": { "price": 520.10, "change": "+2.1%" },
    // ... all portfolio stocks included
  }
}
```

---

### 3.3 How Should the Prompt Tell Claude to Use Current Prices?

**Add explicit instructions:**

```javascript
buildDeepAnalysisPrompt(portfolio, market, news, economic, question) {
  return `You are Whiskie, an AI portfolio manager managing a $100,000 portfolio.

**CRITICAL: All prices below are CURRENT as of this analysis (fetched in real-time).**

**Current Portfolio (with LIVE prices):**
${JSON.stringify(portfolio, null, 2)}

**Market Context (LIVE prices):**
${JSON.stringify(market, null, 2)}

**Your Analysis Must:**
1. Use the CURRENT prices provided above
2. Calculate gains/losses based on CURRENT prices
3. Verify stop-loss and take-profit levels against CURRENT prices
4. Make recommendations based on CURRENT market conditions
5. If you see a stock at a different price than expected, note the discrepancy

**Recent News:**
${news}

**Economic Indicators:**
${JSON.stringify(economic, null, 2)}

${question}`;
}
```

---

### 3.4 Where Should We Fetch Prices at Execution Time?

**Three critical points:**

1. **Before sending to Claude (in `runDeepAnalysis()`):**
   ```javascript
   // Fetch fresh prices for ALL portfolio stocks
   const portfolioSymbols = portfolio.positions.map(p => p.symbol);
   const freshQuotes = await tradier.getQuotes(portfolioSymbols);
   
   // Update portfolio with fresh prices
   portfolio.positions = portfolio.positions.map(pos => ({
     ...pos,
     currentPrice: freshQuotes[pos.symbol].last
   }));
   ```

2. **Before executing trade (in `executeTrade()`):**
   ```javascript
   // Already done ✅
   const quote = await tradier.getQuote(symbol);
   const price = quote.last;
   ```

3. **Before risk validation (in `validateTrade()`):**
   ```javascript
   // Pass fresh prices to risk manager
   const validation = riskManager.validateTrade(trade, portfolio);
   ```

---

## 4. CHECK OTHER APIs

### 4.1 Tavily News API

**Status:** ✅ Implemented, but **underutilized**

**Current usage:**
```javascript
// Generic market news only
const marketNews = await tavily.searchMarketNews(5);

// Stock-specific news NOT fetched
// Sector news NOT fetched
```

**Should be:**
```javascript
// Market news
const marketNews = await tavily.searchMarketNews(5);

// Stock-specific news for each portfolio position
const stockNews = {};
for (const position of portfolio.positions) {
  stockNews[position.symbol] = await tavily.searchStockNews(position.symbol, 3);
}

// Sector news for portfolio sectors
const sectorNews = {};
const sectors = [...new Set(portfolio.positions.map(p => p.sector))];
for (const sector of sectors) {
  sectorNews[sector] = await tavily.searchSectorNews(sector, 3);
}
```

---

### 4.2 Economic Data

**Status:** ❌ **NOT implemented at all**

**Current:**
```javascript
const analysis = await claude.deepAnalysis(
  portfolio,
  marketData,
  news,
  {},  // ❌ Empty
  question
);
```

**Should fetch:**
- Federal Reserve interest rates
- Inflation rate (CPI)
- Unemployment rate
- GDP growth
- VIX (volatility index)
- Yield curve

**Implementation:**
```javascript
async fetchEconomicData() {
  // Could use FRED API, World Bank API, or other sources
  // For now, include VIX from market data
  return {
    vix: marketData.VIX.price,
    marketTrend: marketData.SPY.change_percentage > 0 ? 'bullish' : 'bearish',
    // Add more as needed
  };
}
```

---

### 4.3 API Integration Status

| API | Status | Usage | Issues |
|-----|--------|-------|--------|
| Tradier | ✅ Working | Quotes, positions, orders | ❌ Prices not refreshed before Claude |
| Claude | ✅ Working | Analysis | ❌ Receives incomplete data |
| Tavily | ✅ Working | Market news | ❌ Not stock/sector specific |
| Economic | ❌ Missing | None | ❌ No macro context |

---

## 5. VERIFY EXECUTION FLOW

### 5.1 parseRecommendations() Issues

**Current implementation (line 689):**
```javascript
parseRecommendations(analysisText) {
  const buyPattern = /BUY\s+(\d+)\s+(?:shares?\s+)?([A-Z]{1,5})\s+at\s+\$?([\d.]+)/gi;
  
  let match;
  const matches = [];
  
  while ((match = buyPattern.exec(analysisText)) !== null) {
    matches.push({
      fullMatch: match[0],
      quantity: parseInt(match[1]),
      symbol: match[2],
      entryPrice: parseFloat(match[3]),
      index: match.index
    });
  }
  
  // ❌ Problems:
  // 1. Regex is fragile - depends on exact format
  // 2. No validation of extracted data
  // 3. entryPrice may not match current market price
  // 4. No error handling
  // 5. Silent failures if format changes
}
```

**Issues:**
- If Opus says "BUY 10 shares of AAPL at $228" but market is at $230, regex extracts $228
- If Opus says "Consider buying 10 AAPL shares around $228", regex fails
- If Opus says "BUY 10 AAPL at market price", regex fails
- No validation that symbol exists or quantity is reasonable

---

### 5.2 executeTrade() Issues

**Current implementation (line 809):**
```javascript
async executeTrade(symbol, action, quantity) {
  // ✅ Gets current price
  const quote = await tradier.getQuote(symbol);
  const price = quote.last;
  
  // ✅ Validates trade
  const validation = riskManager.validateTrade(trade, portfolio);
  
  // ✅ Places order
  const order = await tradier.placeOrder(symbol, action, quantity);
  
  // ✅ Logs trade
  await logTrade({...});
  
  // ✅ Updates position
  await upsertPosition({...});
}
```

**Status:** ✅ Mostly good, but:
- Doesn't verify that extracted price matches current market
- Doesn't check if recommendation is still valid at execution time
- No slippage protection

---

### 5.3 Are Trades Actually Being Placed?

**Current flow:**
```
runDeepAnalysis()
  ├─ Calls claude.deepAnalysis()
  ├─ Parses recommendations
  ├─ For each recommendation:
  │   └─ Calls executeTrade()
  │       └─ Calls tradier.placeOrder()
  │           └─ ✅ Order placed
  └─ Logs to database
```

**Status:** ✅ Yes, trades are being placed

**But:** Trades are based on stale price analysis from Opus.

---

## 6. COMPLETE FIX PLAN

### Phase 1: Fix Real-Time Price Data Flow

**File: `src/index.js`**

1. **Modify `fetchMarketData()` to include portfolio stocks:**
   ```javascript
   async fetchMarketData(portfolio) {
     try {
       // Get portfolio stock symbols
       const portfolioSymbols = portfolio.positions.map(p => p.symbol);
       
       // Market indices
       const marketIndices = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX', 'TLT', 'GLD', 'USO'];
       
       // Combine all symbols
       const allSymbols = [...new Set([...portfolioSymbols, ...marketIndices])];
       
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
       
       return marketData;
     } catch (error) {
       console.error('Error fetching market data:', error.message);
       return {};
     }
   }
   ```

2. **Modify `runDeepAnalysis()` to refresh portfolio prices:**
   ```javascript
   async runDeepAnalysis(portfolio, news) {
     try {
       // ... existing code ...
       
       // Fetch real-time market data (including portfolio stocks)
       console.log('📊 Fetching real-time market data...');
       const marketData = await this.fetchMarketData(portfolio);
       console.log('✅ Market data fetched');
       
       // CRITICAL: Refresh portfolio prices with fresh quotes
       console.log('💰 Refreshing portfolio prices...');
       for (const position of portfolio.positions) {
         if (marketData[position.symbol]) {
           position.currentPrice = marketData[position.symbol].price;
         }
       }
       console.log('✅ Portfolio prices updated');
       
       // ... rest of code ...
     }
   }
   ```

---

### Phase 2: Enhance Claude Prompt with Price Awareness

**File: `src/claude.js`**

1. **Modify `buildDeepAnalysisPrompt()` to emphasize current prices:**
   ```javascript
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
5. If a stock price seems unusual, note it in your analysis

**Recent News:**
${news}

**Economic Indicators:**
${JSON.stringify(economic, null, 2)}

${question}`;
   }
   ```

---

### Phase 3: Improve Trade Recommendation Parsing

**File: `src/index.js`**

1. **Replace fragile regex with structured parsing:**
   ```javascript
   parseRecommendations(analysisText) {
     const recommendations = [];
     
     try {
       // Look for structured BUY recommendations
       const buyPattern = /BUY\s+(\d+)\s+(?:shares?\s+)?([A-Z]{1,5})\s+at\s+\$?([\d.]+)/gi;
       
       let match;
       while ((match = buyPattern.exec(analysisText)) !== null) {
         const quantity = parseInt(match[1]);
         const symbol = match[2].toUpperCase();
         const entryPrice = parseFloat(match[3]);
         
         // Validate extracted data
         if (!symbol || symbol.length > 5 || quantity <= 0 || entryPrice <= 0) {
           console.warn(`⚠️ Invalid recommendation format: ${match[0]}`);
           continue;
         }
         
         // Extract stop-loss and take-profit from nearby text
         const textAfterBuy = analysisText.substring(match.index, match.index + 1500);
         
         const stopLossMatch = /Stop-loss:\s*\$?([\d.]+)/i.exec(textAfterBuy);
         const takeProfitMatch = /Take-profit:\s*\$?([\d.]+)/i.exec(textAfterBuy);
         
         const stopLoss = stopLossMatch ? parseFloat(stopLossMatch[1]) : null;
         const takeProfit = takeProfitMatch ? parseFloat(takeProfitMatch[1]) : null;
         
         // Extract reasoning
         const reasoning = textAfterBuy.substring(0, 500).trim();
         
         recommendations.push({
           symbol,
           quantity,
           entryPrice,
           stopLoss,
           takeProfit,
           reasoning,
           timestamp: new Date()
         });
       }
       
       return recommendations;
     } catch (error) {
       console.error('Error parsing recommendations:', error.message);
       return [];
     }
   }
   ```

---

### Phase 4: Enhance News Integration

**File: `src/index.js`**

1. **Modify `runDeepAnalysis()` to include stock-specific news:**
   ```javascript
   async runDeepAnalysis(portfolio, news) {
     try {
       // ... existing code ...
       
       // Get market news
       console.log('📰 Fetching market news...');
       const marketNews = await tavily.searchMarketNews(5);
       const formattedNews = tavily.formatResults(marketNews);
       
       // Get stock-specific news for portfolio holdings
       console.log('📰 Fetching stock-specific news...');
       const stockNews = {};
       for (const position of portfolio.positions) {
         try {
           const news = await tavily.searchStockNews(position.symbol, 2);
           stockNews[position.symbol] = tavily.formatResults(news);
         } catch (err) {
           console.warn(`Could not fetch news for ${position.symbol}`);
         }
       }
       
       // Combine all news
       const combinedNews = `
**Market News:**
${formattedNews}

**Stock-Specific News:**
${Object.entries(stockNews).map(([symbol, news]) => `
${symbol}:
${news}
`).join('\n')}
       `;
       
       // ... pass combinedNews to Claude ...
     }
   }
   ```

---

### Phase 5: Add Economic Data

**File: `src/index.js`**

1. **Create `fetchEconomicData()` method:**
   ```javascript
   async fetchEconomicData(marketData) {
     try {
       return {
         vix: marketData.VIX?.price || 'N/A',
         marketTrend: marketData.SPY?.change_percentage > 0 ? 'bullish' : 'bearish',
         sp500Change: marketData.SPY?.change_percentage || 0,
         nasdaqChange: marketData.QQQ?.change_percentage || 0,
         timestamp: new Date().toISOString()
       };
     } catch (error) {
       console.error('Error fetching economic data:', error.message);
       return {};
     }
   }
   ```

2. **Use in `runDeepAnalysis()`:**
   ```javascript
   const economicData = await this.fetchEconomicData(marketData);
   
   const analysis = await claude.deepAnalysis(
     portfolio,
     marketData,
     combinedNews,
     economicData,  // ✅ Now populated
     question
   );
   ```

---

### Phase 6: Add Price Validation Before Trade Execution

**File: `src/index.js`**

1. **Modify `executeTrade()` to validate prices:**
   ```javascript
   async executeTrade(symbol, action, quantity, recommendedPrice = null) {
     try {
       console.log(`\n💼 Executing ${action.toUpperCase()} ${quantity} ${symbol}...`);
       
       // Get current price
       const quote = await tradier.getQuote(symbol);
       const currentPrice = quote.last;
       
       // Validate price hasn't moved too much
       if (recommendedPrice) {
         const priceChange = Math.abs((currentPrice - recommendedPrice) / recommendedPrice);
         if (priceChange > 0.05) { // 5% slippage threshold
           console.warn(`⚠️ Price has moved ${(priceChange * 100).toFixed(1)}% since recommendation`);
           console.warn(`   Recommended: $${recommendedPrice}, Current: $${currentPrice}`);
           // Could add user confirmation here
         }
       }
       
       // ... rest of execution ...
     }
   }
   ```

---

## 7. IMPLEMENTATION PRIORITY

### Critical (Do First)
1. ✅ Fix `fetchMarketData()` to include portfolio stocks
2. ✅ Refresh portfolio prices before sending to Claude
3. ✅ Update Claude prompt to emphasize current prices

### High (Do Second)
4. ✅ Improve recommendation parsing
5. ✅ Add price validation before trade execution
6. ✅ Add stock-specific news

### Medium (Do Third)
7. ✅ Add economic data
8. ✅ Improve error handling
9. ✅ Add logging for price discrepancies

---

## 8. TESTING CHECKLIST

- [ ] Verify portfolio stock prices are fetched before Claude analysis
- [ ] Verify Claude receives current prices in prompt
- [ ] Verify recommendations are parsed correctly
- [ ] Verify trade execution uses current prices
- [ ] Verify risk validation uses current prices
- [ ] Verify stock-specific news is included
- [ ] Verify economic data is populated
- [ ] Test with paper trading first
- [ ] Monitor for price discrepancies in logs
- [ ] Verify trades execute at expected prices

---

## SUMMARY

The Whiskie bot has a **critical architectural flaw**: it sends Claude Opus stale portfolio price data and incomplete market context. This means Opus makes trading decisions without knowing current stock prices, which is fundamentally broken.

**The fix is straightforward:**
1. Fetch fresh prices for ALL portfolio stocks (not just market indices)
2. Update portfolio data with fresh prices before sending to Claude
3. Tell Claude explicitly that prices are current
4. Include stock-specific news and economic data
5. Validate prices before trade execution

**Estimated implementation time:** 2-3 hours for all phases.

