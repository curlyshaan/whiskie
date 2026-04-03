# Whiskie Trading Bot - Data Flow Audit Summary

## The Problem in One Sentence

**Claude Opus makes trading decisions without knowing the current prices of the stocks it's supposed to trade.**

---

## Critical Issues Found

### 1. ❌ Portfolio Prices Are Stale
- `getPortfolioState()` fetches positions but doesn't refresh prices
- Prices come from the last API call, not real-time
- Claude receives outdated price data

### 2. ❌ Portfolio Stocks Not in Market Data
- `fetchMarketData()` only fetches 8 market indices (SPY, QQQ, etc.)
- Portfolio stocks (AAPL, MSFT, TSLA, etc.) are NOT included
- Claude has no price data for the stocks it's analyzing

### 3. ❌ Economic Data Always Empty
- `economicData` parameter is always `{}`
- Claude has no macro context (VIX, market trend, etc.)
- Missing critical decision-making information

### 4. ❌ Claude Prompt Doesn't Emphasize Current Prices
- No warning that prices might be stale
- No instruction to verify prices
- Claude doesn't know to question the data

### 5. ❌ Recommendation Parsing Is Fragile
- Regex-based parsing depends on exact format
- No validation of extracted data
- Silent failures if format changes

### 6. ❌ News Is Generic, Not Stock-Specific
- Only market news is fetched
- No news for individual portfolio holdings
- Claude lacks context for specific stocks

### 7. ❌ Trade Execution Price Mismatch
- Opus recommends at price X
- Trade executes at price Y (current market)
- No validation that prices haven't moved too much

---

## Data Flow: Current (Broken)

```
runDailyAnalysis()
  ├─ getPortfolioState()
  │   └─ Returns positions with STALE prices ❌
  │
  └─ runDeepAnalysis()
      ├─ fetchMarketData()
      │   └─ Fetches 8 indices ONLY ❌
      │       (SPY, QQQ, DIA, IWM, VIX, TLT, GLD, USO)
      │       Portfolio stocks NOT included ❌
      │
      ├─ tavily.searchMarketNews()
      │   └─ Generic market news only ❌
      │       Stock-specific news NOT fetched ❌
      │
      └─ claude.deepAnalysis(portfolio, marketData, news, {}, question)
          │
          ├─ Portfolio: STALE prices ❌
          ├─ MarketData: 8 indices only ❌
          ├─ News: Generic only ❌
          ├─ Economic: Empty {} ❌
          │
          └─ Opus makes recommendations based on INCOMPLETE data ❌
              │
              └─ parseRecommendations()
                  └─ Fragile regex parsing ❌
                      │
                      └─ executeTrade()
                          └─ Fetches CURRENT price at execution time
                              (Price may differ from what Opus analyzed) ❌
```

---

## Data Flow: Fixed (Correct)

```
runDailyAnalysis()
  ├─ getPortfolioState()
  │   └─ Returns positions with STALE prices
  │
  └─ runDeepAnalysis()
      ├─ fetchMarketData(portfolio)  ✅ Pass portfolio
      │   └─ Fetches ALL symbols:
      │       - Portfolio stocks (AAPL, MSFT, etc.) ✅
      │       - Market indices (SPY, QQQ, etc.) ✅
      │
      ├─ Refresh portfolio prices ✅
      │   └─ Update each position.currentPrice with fresh quote ✅
      │
      ├─ tavily.searchMarketNews() ✅
      │   └─ Market news
      │
      ├─ tavily.searchStockNews() for each position ✅
      │   └─ Stock-specific news
      │
      ├─ fetchEconomicData(marketData) ✅
      │   └─ VIX, market trend, S&P 500 change, etc. ✅
      │
      └─ claude.deepAnalysis(portfolio, marketData, news, economic, question)
          │
          ├─ Portfolio: FRESH prices ✅
          ├─ MarketData: All stocks + indices ✅
          ├─ News: Market + stock-specific ✅
          ├─ Economic: VIX, trends, etc. ✅
          │
          └─ Opus makes recommendations based on COMPLETE data ✅
              │
              └─ parseRecommendations() with validation ✅
                  │
                  └─ executeTrade(symbol, action, qty, recommendedPrice) ✅
                      └─ Validates price hasn't moved >5% ✅
                          └─ Executes at current market price ✅
```

---

## The 8 Fixes Required

| # | Fix | File | Impact | Priority |
|---|-----|------|--------|----------|
| 1 | Include portfolio stocks in `fetchMarketData()` | `src/index.js` | Claude gets stock prices | 🔴 Critical |
| 2 | Refresh portfolio prices before Claude | `src/index.js` | Prices are current | 🔴 Critical |
| 3 | Update Claude prompt to emphasize current prices | `src/claude.js` | Claude knows prices are fresh | 🔴 Critical |
| 4 | Add economic data fetching | `src/index.js` | Claude has macro context | 🟠 High |
| 5 | Improve recommendation parsing | `src/index.js` | More robust extraction | 🟠 High |
| 6 | Add stock-specific news | `src/index.js` | Better context for decisions | 🟠 High |
| 7 | Add price validation before trade | `src/index.js` | Catch slippage issues | 🟠 High |
| 8 | Pass recommended price to executeTrade | `src/index.js` | Validate execution price | 🟡 Medium |

---

## Implementation Time Estimate

- **Critical Fixes (1-3):** 30 minutes
- **High Priority Fixes (4-6):** 45 minutes
- **Medium Priority Fixes (7-8):** 15 minutes
- **Testing & Verification:** 30 minutes
- **Total:** ~2 hours

---

## What Gets Fixed

### Before
```
Opus: "I see AAPL at $150, down 10%. I recommend selling."
Reality: AAPL is actually at $228, up 52%
Result: Wrong decision based on stale data ❌
```

### After
```
Opus: "I see AAPL at $228, up 52%. I recommend trimming 25%."
Reality: AAPL is at $228, up 52%
Result: Correct decision based on current data ✅
```

---

## Files to Modify

1. **`src/index.js`** (Main changes)
   - `fetchMarketData()` - Include portfolio stocks
   - `runDeepAnalysis()` - Refresh prices, add economic data, add stock news
   - `parseRecommendations()` - Add validation
   - `executeTrade()` - Add price validation

2. **`src/claude.js`** (Prompt update)
   - `buildDeepAnalysisPrompt()` - Emphasize current prices

---

## Testing Strategy

1. **Unit Test:** Verify `fetchMarketData()` returns all symbols
2. **Integration Test:** Run `runDeepAnalysis()` and check logs
3. **Validation Test:** Verify Claude receives current prices
4. **Paper Trading:** Execute test trades in paper mode
5. **Monitoring:** Watch logs for price discrepancies

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| API rate limits | Low | Medium | Batch requests, cache results |
| Stale prices still | Low | High | Add logging, verify in tests |
| Parsing breaks | Low | Medium | Add validation, error handling |
| Performance impact | Medium | Low | ~5-10 sec additional per run |

---

## Success Criteria

✅ Portfolio stock prices are fetched before Claude analysis
✅ Claude receives current prices in the prompt
✅ Claude receives economic data (not empty `{}`)
✅ Claude receives stock-specific news
✅ Recommendations are parsed with validation
✅ Trade execution validates prices
✅ Logs show price updates and discrepancies
✅ Paper trading executes successfully

---

## Next Steps

1. Read `IMPLEMENTATION_GUIDE.md` for detailed code changes
2. Apply fixes in order (1-3 first, then 4-8)
3. Test each fix as you go
4. Run full paper trading test
5. Monitor logs for issues
6. Deploy to production

---

## Key Takeaway

The bot isn't broken—it just needs to **see the current market** before making decisions. Once Claude has real-time prices, stock-specific news, and economic context, it will make much better trading decisions.

**The fix is straightforward: fetch fresh data, pass it to Claude, tell Claude it's fresh, and validate before executing.**

