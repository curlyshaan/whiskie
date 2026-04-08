# Whiskie Bot - Comprehensive Code Review

**Date:** 2026-04-08
**Environment:** Paper Trading (Tradier Sandbox)

---

## Issues Found & Recommendations

### 1. Missing Daily/Weekly Performance Tracking ⚠️

**Location:** `src/index.js:1315-1317`

```javascript
daily_change: 0, // TODO: Calculate from previous day
total_return: 0,
sp500_return: 0, // TODO: Fetch S&P 500 return
```

**Issue:** Portfolio snapshots don't calculate actual performance metrics

**Impact:** Can't track if bot is beating market or improving over time

**Fix Needed:**
- Calculate daily_change from previous snapshot
- Fetch SPY price for S&P 500 comparison
- Add total_return calculation from initial capital

**Recommendation:** Implement this for Sunday weekly review so Opus can analyze performance trends

---

### 2. Tax Tracking Not Integrated with Sunday Review ⚠️

**Location:** Removed 6 AM cron, but not added to weekly review

**Issue:** Days held tracking happens during daily analysis but isn't used in Sunday review

**Fix Needed:**
- Add days_held update to Sunday weekly review
- Include tax lot analysis in Opus review (short-term vs long-term gains)
- Provide Opus with tax optimization opportunities

---

### 3. No Error Recovery for Failed Trades ⚠️

**Location:** `src/index.js` - trade execution

**Issue:** If a trade fails, there's no retry logic or fallback

**Impact:** Bot might miss opportunities due to temporary API issues

**Recommendation for Paper Trading:**
- Add retry logic with exponential backoff
- Log failed trades to database for analysis
- Alert on repeated failures for same symbol

---

### 4. OCO Orders May Still Fail in Paper Trading ⚠️

**Location:** `src/tradier.js:231`

**Issue:** Fixed format, but Tradier sandbox may not support OCO orders

**Fallback Strategy:**
```javascript
// If OCO fails, place separate orders:
1. Place stop-loss order
2. Place take-profit order
3. Store both order IDs in database
4. Monitor both orders and cancel opposite when one fills
```

**Recommendation:** Add fallback logic to handle OCO rejection

---

### 5. No Position Size Validation Against Account Balance ⚠️

**Location:** `src/trade-safeguard.js`

**Issue:** Validates trade value but doesn't check if we have enough cash

**Potential Bug:**
```javascript
// Current: Checks if trade < $15k
// Missing: Checks if cash balance >= trade value
```

**Fix:**
```javascript
async canTrade(symbol, side, quantity, price) {
  // ... existing checks ...
  
  // Add cash balance check for buys
  if (side === 'buy') {
    const portfolio = await analysisEngine.getPortfolioState();
    const tradeValue = quantity * price;
    if (portfolio.cash < tradeValue) {
      errors.push(`Insufficient cash: $${portfolio.cash} < $${tradeValue}`);
    }
  }
}
```

---

### 6. Watchlist Not Being Used Effectively 📊

**Location:** `src/index.js` - runDailyAnalysis

**Issue:** Bot fetches watchlist but Opus doesn't get clear guidance on when to buy from it

**Recommendation:**
- Add watchlist entry criteria to prompt
- Track how long stocks have been on watchlist
- Remove stale watchlist entries (>30 days with no action)

---

### 7. No Stop-Loss Monitoring for Existing Positions ⚠️

**Location:** `src/index.js` - daily analysis

**Issue:** Bot checks stop-loss levels but doesn't automatically execute sells

**Current Behavior:**
```javascript
// Just logs if stop-loss triggered
console.log('Stop-loss triggered for XYZ');
// But doesn't sell!
```

**Fix Needed:**
- Auto-execute stop-loss sells when triggered
- Or at minimum, add to Opus recommendations with HIGH PRIORITY flag

---

### 8. Earnings Calendar Not Proactive ⚠️

**Location:** `src/earnings-analysis.js`

**Issue:** Only checks if positions have earnings today/tomorrow

**Missing:**
- No advance warning (3-5 days before earnings)
- No pre-earnings position sizing recommendations
- No post-earnings re-entry analysis

**Recommendation:**
- Check 5 days ahead for earnings
- Suggest position trimming before high-volatility events
- Track earnings results vs expectations

---

### 9. No Circuit Breaker for Rapid Losses 🚨

**Location:** Missing entirely

**Issue:** If market crashes or bot makes bad trades, no automatic pause

**Recommendation for Paper Trading:**
```javascript
// Add to risk-manager.js
async checkCircuitBreaker() {
  const portfolio = await analysisEngine.getPortfolioState();
  
  // If down >10% in single day
  if (portfolio.dailyChange < -0.10) {
    console.log('🚨 CIRCUIT BREAKER: Daily loss >10%');
    // Pause trading for rest of day
    // Send alert email
    // Require manual override to resume
  }
  
  // If down >15% from peak
  if (portfolio.drawdown > 0.15) {
    console.log('🚨 CIRCUIT BREAKER: Drawdown >15%');
    // Reduce position sizes by 50%
    // Only defensive trades allowed
  }
}
```

---

### 10. Trend Learning Not Being Applied 📈

**Location:** `src/trend-learning.js`

**Issue:** Saves analysis history but doesn't feed it back to Opus

**Missing:**
- No "what worked last time" context in prompts
- No pattern recognition across analyses
- No learning from mistakes

**Recommendation:**
- Include recent trend patterns in Opus prompt
- Show "last time we analyzed XYZ, outcome was..."
- Track accuracy of predictions

---

### 11. No Correlation Analysis Between Positions 📊

**Location:** Missing

**Issue:** Bot might buy multiple highly correlated stocks (all tech, all airlines)

**Risk:** Portfolio not actually diversified even if sector limits met

**Recommendation:**
- Add correlation check before new positions
- Warn if adding position with >0.7 correlation to existing holdings
- Consider correlation in position sizing

---

### 12. Email Retry Logic Too Aggressive ⏱️

**Location:** `src/email.js:23`

**Issue:** 3 retries with 5-second delays = 15+ seconds blocking

**Fix:**
```javascript
// Current: Blocks for 15+ seconds on email failure
// Better: Fire and forget with background retry
async sendEmail(to, subject, html) {
  // Don't await - let it fail silently
  this.resend.emails.send({...}).catch(err => {
    console.error('Email failed:', err.message);
    // Log to database for later review
  });
}
```

---

### 13. No Backtesting or Simulation Mode 🧪

**Location:** Missing

**Issue:** Can't test strategy changes without live trading

**Recommendation for Paper Trading:**
- Add "simulation mode" that runs analysis but doesn't execute trades
- Log what trades WOULD have been made
- Compare simulated vs actual results
- Test new prompts/strategies safely

---

### 14. Database Connection Pool Not Configured ⚠️

**Location:** `src/db.js:11`

```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
```

**Missing:**
- No max connections limit
- No idle timeout
- No connection retry logic

**Fix:**
```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // Max connections
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 2000, // Fail fast if can't connect
});

// Add error handler
pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
  email.sendErrorAlert(err, 'Database pool error');
});
```

---

### 15. No Rate Limiting for API Calls 🚦

**Location:** Multiple files calling Tradier/Claude APIs

**Issue:** Could hit rate limits during high-activity periods

**Recommendation:**
- Add rate limiter for Tradier API (120 calls/minute)
- Add rate limiter for Claude API (based on Quatarly limits)
- Queue requests if approaching limits

---

## Features to Add (Paper Trading Experiments)

### 1. Trade Journal with Screenshots 📸
- Save chart snapshots at entry/exit
- Log reasoning and outcome
- Build dataset for future ML training

### 2. A/B Testing Framework 🧪
- Run two strategies simultaneously
- Compare performance
- Automatically adopt better strategy

### 3. Sentiment Analysis Integration 📰
- Analyze news sentiment for positions
- Track sentiment changes over time
- Correlate sentiment with price moves

### 4. Options Strategy Testing 📊
- Paper trade covered calls on positions
- Test protective puts
- Analyze premium collection vs risk

### 5. Market Regime Detection 🌡️
- Detect bull/bear/sideways markets
- Adjust strategy based on regime
- Track regime transitions

---

## Quick Wins (Easy Fixes)

1. ✅ Add cash balance check to trade-safeguard
2. ✅ Implement daily_change calculation
3. ✅ Add circuit breaker for >10% daily loss
4. ✅ Configure database connection pool
5. ✅ Add OCO fallback to separate orders
6. ✅ Make email non-blocking
7. ✅ Add days_held to Sunday review

---

## Priority Ranking

**Critical (Fix Now):**
1. Cash balance validation
2. Database connection pool config
3. Circuit breaker for losses

**High (Fix This Week):**
4. OCO order fallback
5. Performance tracking (daily_change, S&P comparison)
6. Stop-loss auto-execution

**Medium (Nice to Have):**
7. Trend learning integration
8. Correlation analysis
9. Earnings advance warning

**Low (Future Experiments):**
10. A/B testing framework
11. Options strategies
12. Market regime detection

---

## Paper Trading Advantages

Since this is paper trading, we can:
- Test aggressive strategies without risk
- Experiment with higher position sizes
- Try unconventional approaches
- Fail fast and learn quickly
- Build confidence before going live

**Recommendation:** Use paper trading to validate all fixes and new features before considering live trading.
