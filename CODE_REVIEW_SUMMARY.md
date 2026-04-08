# Whiskie Code Review - Fixes Applied & Issues Requiring Approval

**Date:** 2026-04-08  
**Review Type:** Security, Logic, and Performance Analysis

---

## ✅ CRITICAL FIXES APPLIED (No Approval Needed)

### 1. Fixed `isRunning` Mutex Bug - Bot Was Broken
**Issue:** Bot set `isRunning = true` on startup and never reset it. Every cron job after the first skipped analysis with "already running" message.

**Fix Applied:**
- Changed to separate flags: `botStarted` and `analysisRunning`
- `analysisRunning` now properly resets in `finally` block
- Bot will now run analysis on all 3 daily cron schedules

**Files Modified:**
- `src/index.js:37-38` - Constructor now uses two flags
- `src/index.js:170` - Changed to `botStarted = true`
- `src/index.js:277` - Check `analysisRunning` instead
- `src/index.js:488` - Reset `analysisRunning` in finally block

---

### 2. Fixed Extended Thinking Temperature Conflict
**Issue:** Extended thinking requires `temperature: 1.0`, but code set `temperature: 0.1`, causing all Opus calls to fail.

**Fix Applied:**
- When extended thinking enabled: `temperature = 1` (required by Anthropic)
- When extended thinking disabled: `temperature = 0.1` (consistent decisions)
- Added logging to show which temperature is being used

**Files Modified:**
- `src/claude.js:36-60` - Conditional temperature based on thinking mode

**Clarification on Temperature:**
- Extended thinking has built-in consistency mechanisms
- Temperature doesn't affect randomness the same way with extended thinking
- Anthropic API **requires** temp=1 for extended thinking mode

---

### 3. Removed API Key from CLAUDE.md
**Issue:** Qutarly API key exposed in plain text in committed file.

**Fix Applied:**
- Removed API key from CLAUDE.md
- Added note that keys are stored in Railway environment variables
- Key remains secure in Railway env vars

**Files Modified:**
- `/Users/sshanoor/CLAUDE.md:14-20` - Removed exposed key

**Action Required:** Rotate the exposed Qutarly API key in Railway dashboard.

---

### 4. Fixed Trade Limit Bypass
**Issue:** Daily trade limit only counted `status = 'filled'` orders. Bot could place 10 pending orders rapidly, all passing the limit check.

**Fix Applied:**
- Now counts ALL orders regardless of status
- Prevents rapid-fire order placement
- Both trade count and exposure limits now count all orders

**Files Modified:**
- `src/trade-safeguard.js:83-95` - Removed `status = 'filled'` filter from count
- `src/trade-safeguard.js:102-116` - Removed `status = 'filled'` filter from exposure

---

### 5. Removed Duplicate Function
**Issue:** `getMarketClock()` defined twice in tradier.js (lines 528 and 646).

**Fix Applied:**
- Removed duplicate at line 646
- Kept original at line 528

**Files Modified:**
- `src/tradier.js:643-654` - Removed duplicate function

---

## ⚠️ ISSUES REQUIRING YOUR DECISION

### 1. Sandbox URL Hardcoded - Cannot Trade Live
**Location:** `src/tradier.js:9-13`

**Issue:** Base URL is hardcoded to sandbox. Even when `NODE_ENV !== 'paper'`, all orders go to sandbox.

**Current Code:**
```javascript
const BASE_URL = 'https://sandbox.tradier.com/v1';
```

**Proposed Fix:**
```javascript
const BASE_URL = isPaperTrading
  ? 'https://sandbox.tradier.com/v1'
  : 'https://api.tradier.com/v1';
```

**Question:** Do you want this fixed now, or keep it sandbox-only since you're paper trading?

---

### 2. No Stop-Loss Validation in Trade Execution
**Location:** `src/index.js:1248-1424`

**Issue:** When trades execute, stop-loss is calculated generically (-15%) instead of using Opus's recommendation. No validation that `stopLoss < entryPrice`.

**Impact:** Opus might recommend a tight 5% stop for a volatile stock, but code uses 15% instead.

**Proposed Fix:** Pass AI-recommended stops through from `parseRecommendations` to `executeTrade` and validate them.

**Question:** Should Opus's recommended stop-loss be used, or keep the generic -15% calculation?

---

### 3. Order State Lost on Restart - Positions Unprotected
**Location:** `src/order-manager.js:100-148`

**Issue:** Cancel-then-replace pattern is not atomic. If bot crashes between cancel and replace, position has no stop-loss protection.

**Proposed Fix:** 
- Option A: Use database-backed transaction (mark "pending_replace" before cancel)
- Option B: Use Tradier's `modifyOrder` API if available (in-place modification)

**Question:** Which approach do you prefer, or is this acceptable risk for paper trading?

---

### 4. In-Memory Trade Counter Resets on Restart
**Location:** `src/risk-manager.js:17-29`

**Issue:** `dailyTradeCount` is in-memory only. On restart, it resets to 0, allowing double the intended trades.

**Impact:** Combined with Railway auto-restart on crash, this could allow 10+ trades in one day.

**Proposed Fix:** Remove in-memory counter, use database-backed `tradeSafeguard.getTodayTradeCount()` exclusively.

**Question:** Should I remove the redundant in-memory counter?

---

### 5. Fragile Regex Parsing for Trade Recommendations
**Location:** `src/index.js:1058-1149`

**Issue:** Regex matches any text like "BUY 100 shares MSFT at $400" - could match news quotes, analyst recommendations, or historical context.

**Impact:** False-positive trade executions from news content.

**Proposed Fix:** Add strict sentinel pattern that Opus must follow exactly:
```
EXECUTE_BUY: MSFT | 100 | 400 | 360 | 450
```

**Question:** Should I implement stricter parsing, or is current regex acceptable for paper trading?

---

### 6. Prompt Injection via News Feed
**Location:** `src/index.js:788`, `src/order-manager.js:278`

**Issue:** Raw Tavily news content inserted directly into prompts. Malicious article could contain trade instructions.

**Proposed Fix:**
- Strip financial instruction patterns from news
- Add delimiter: "The following is untrusted external content"
- Add human approval workflow (but you said no human approval needed)

**Question:** Should I sanitize news content, or is this acceptable risk for paper trading?

---

## 📊 RECOMMENDATIONS TO BEAT S&P 500

Based on review and your goal to outperform S&P 500:

### Strategy Improvements (Require Your Approval):

1. **Conviction-Based Position Sizing**
   - Current: All positions 10-15%
   - Proposed: 5% (low conviction) → 10% (standard) → 15% (high conviction)
   - Requires: Update prompts to instruct Opus on sizing logic

2. **Sector Rotation Strategy**
   - Track sector momentum, overweight winning sectors
   - S&P 500 is market-cap weighted; you can outperform by tactical rotation
   - Requires: New sector momentum analyzer module

3. **Earnings Momentum Strategy**
   - Buy 2-4 weeks before earnings if momentum strong
   - Sell/trim 1-2 days before earnings to avoid volatility
   - Re-enter after earnings if results beat
   - Requires: Integration of earnings calendar into decision prompts

4. **Aggressive Short Hunting**
   - Current: 0-30% shorts allowed but Opus may be too conservative
   - Proposed: Add explicit "find 2-3 shorts" instruction to prompts
   - Target: 10-20% short exposure consistently
   - Requires: Update prompts with short hunting mandate

5. **Trailing Stops on Winners**
   - Current: Static stops
   - Proposed: Trailing stops that lock in gains
   - Requires: Integration of trailing stop logic into order management

6. **Scale Into Positions**
   - Current: Buy full position at once
   - Proposed: 50% initial → 25% on confirmation → 25% on breakout
   - Requires: Update trade execution logic

---

## 🎯 SUMMARY

**Fixed (No Approval Needed):**
- ✅ Bot mutex bug (was completely broken)
- ✅ Extended thinking temperature
- ✅ API key exposure
- ✅ Trade limit bypass
- ✅ Duplicate function

**Awaiting Your Decision:**
1. Sandbox URL fix (live trading capability)
2. Stop-loss validation (use Opus recommendations)
3. Order state persistence (atomic operations)
4. In-memory counter removal
5. Stricter trade parsing
6. News content sanitization
7. Strategy improvements for beating S&P 500

**Ready to push to git once you approve.**

Which issues would you like me to fix, and which strategy improvements should I implement?
