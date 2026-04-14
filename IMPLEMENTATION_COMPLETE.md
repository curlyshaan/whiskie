# Pathway-Specific Exit Strategies - Implementation Complete

**Date:** 2026-04-14  
**Status:** Ready for deployment to Railway production

---

## What Was Implemented

### 1. Database Schema Updates ✅
- Added `pathway` column to positions table (deepValue, highGrowth, etc.)
- Added `intent` column to positions table (value_dip, growth, momentum, etc.)
- Added `peak_price` column for tracking trailing stops
- Added `trailing_stop_activated` boolean flag
- Added `trailing_stop_distance` for trail amount
- Added `last_trim_date` and `trim_history` for tracking partial exits
- Migration applied to Railway production database

### 2. Pathway Exit Strategies Module ✅
**File:** `src/pathway-exit-strategies.js`

Defines exit rules for each pathway:
- **deepValue**: Activate trailing stop at +50% (not +100%), trail -20%, no fixed trims
- **highGrowth**: +50% target, -12% stop, trim 33% at +50% and +100%
- **inflection**: +30% target, -10% stop, trim 50% at +30%
- **cashMachine**: Hold for income, -12% stop or dividend cut, trail at +40%
- **qarp**: +40% target, -10% stop, trim 33% at +40% and +80%
- **turnaround**: Activate trailing stop at +60%, trail -25%, no fixed trims
- **value_dip**: +20% target (fair value), -8% stop, trim 50% at +15% and +25%
- **Short pathways**: overvalued, deteriorating, overextended

### 3. Pathway Exit Monitor ✅
**File:** `src/pathway-exit-monitor.js`

Runs every 45 minutes during market hours (9am-4pm ET):
- Checks trim opportunities (e.g., value_dip at +20%)
- Activates trailing stops (e.g., deepValue at +50%)
- Triggers trailing stop exits when price falls below trail level
- Auto-executes all pathway exits (no approval needed)
- Sends email notifications after execution

### 4. Tradier Trailing Stop Support ✅
**File:** `src/tradier.js`

Added `placeTrailingStopOrder()` method:
- Places Tradier `trailing_stop` order type
- Trail amount in dollars (e.g., $5.00 trail)
- Automatically adjusts stop as price moves favorably

### 5. Trade Execution Integration ✅
**Files:** `src/trade-executor.js`, `src/db.js`

- Trade executor now stores `pathway` and `intent` when creating positions
- Database `upsertPosition()` updated to accept pathway/intent fields
- Initial `peak_price` set to entry price
- Trade approvals already support pathway/intent parsing

### 6. Cron Integration ✅
**File:** `src/index.js`

- Added `pathwayExitMonitor` import
- Integrated into existing 45-minute cron job
- Runs alongside trade executor during market hours

### 7. Updated Strategy Approach ✅
**Key improvements based on user feedback:**

**Before:** deepValue trimmed 25% at +100%, 25% at +200%  
**After:** deepValue activates trailing stop at +50%, no fixed trims

**Reasoning:** MSFT example - stock went $280→$530→$380. Old approach would hold through drawdown. New approach activates trailing stop at $420 (+50%), locks in gains at $336 (20% trail), exits at $336 instead of riding down to $380.

**Re-evaluation frequency:** Changed from quarterly to monthly for all pathways

---

## How It Works

### Entry Flow
1. Opus recommends trade: `EXECUTE_BUY: MSFT | 26 | 420.00 | 395.00 | 500.00 | deepValue | value_dip`
2. Trade queued for approval with pathway and intent
3. User approves via `/approvals` dashboard
4. Trade executor creates position with pathway/intent/peak_price

### Exit Flow (Automated)
**Every 45 minutes during market hours:**

1. **Pathway monitor checks all positions**
   - Fetches current price
   - Updates peak_price if new high/low reached
   - Checks pathway-specific rules

2. **Trim opportunity detected** (e.g., value_dip at +20%)
   - Cancel existing OCO order
   - Sell trim quantity at market (e.g., 50% of shares)
   - Place new OCO for remaining shares
   - Log trim in `trim_history`
   - Send email notification

3. **Trailing stop activation** (e.g., deepValue at +50%)
   - Cancel existing OCO order
   - Place Tradier `trailing_stop` order
   - Update `trailing_stop_activated = TRUE`
   - Store `trailing_stop_distance`
   - Send email notification

4. **Trailing stop triggered** (price falls below trail level)
   - Sell entire position at market
   - Remove from positions table
   - Log trade
   - Send email notification

### Weekly Review (Opus)
**Sunday 9pm:**
- Opus reviews all positions with extended thinking
- Can recommend target/stop adjustments based on fundamentals
- Requires trade approval (not auto-executed)
- Example: "MSFT ROE dropped 30% for 2 quarters → exit position"

---

## Configuration

### Pathway Strategies
All strategies defined in `src/pathway-exit-strategies.js`:
- Activation thresholds (when to activate trailing stops)
- Trail distances (how far to trail from peak)
- Trim levels (partial exit points)
- Stop-loss percentages
- Re-evaluation frequency (monthly)

### Monitoring Schedule
Cron job in `src/index.js`:
```javascript
cron.schedule('*/45 9-16 * * 1-5', async () => {
  await tradeExecutor.processApprovedTrades();
  await pathwayExitMonitor.checkPathwayExits();
});
```

### Email Notifications
Sent via Resend API to `ALERT_EMAIL`:
- Trim executions
- Trailing stop activations
- Trailing stop exits
- Includes: symbol, quantity, price, reason, order ID

---

## Testing Checklist

Before going live, test in paper trading mode:

- [ ] Create position with pathway/intent via trade approval
- [ ] Verify pathway/intent stored in database
- [ ] Verify peak_price updates as price moves
- [ ] Test trim execution (manually set price to trigger level)
- [ ] Test trailing stop activation
- [ ] Test trailing stop exit
- [ ] Verify email notifications sent
- [ ] Verify OCO cancel/replace logic works
- [ ] Test with both long and short positions
- [ ] Verify weekly Opus review can recommend adjustments

---

## Files Changed

**New Files:**
- `src/pathway-exit-strategies.js` - Exit strategy definitions
- `src/pathway-exit-monitor.js` - 45-minute monitoring logic
- `migrations/add-pathway-columns.sql` - Database migration
- `PATHWAY_EXIT_STRATEGIES.md` - Detailed Opus recommendations
- `AI_REVIEW_SUMMARY.md` - Complete system overview
- `WORKFLOW.md` - System architecture documentation
- `test-pathway-exit.js` - Test script for Opus analysis

**Modified Files:**
- `src/index.js` - Added pathwayExitMonitor import and cron integration
- `src/db.js` - Updated upsertPosition() to accept pathway/intent/peak_price
- `src/trade-executor.js` - Store pathway/intent when creating positions
- `src/tradier.js` - Added placeTrailingStopOrder() method
- `src/pathway-exit-strategies.js` - Updated deepValue/turnaround/cashMachine strategies

---

## Deployment Steps

1. **Verify Railway environment variables:**
   - `DATABASE_URL` - PostgreSQL connection string
   - `TRADIER_SANDBOX_API_KEY` - Paper trading API key
   - `ALERT_EMAIL` - Email for notifications
   - `RESEND_API_KEY` - Email service API key

2. **Push to GitHub:**
   ```bash
   git add -A
   git commit -m "Implement pathway-specific exit strategies"
   git push origin main
   ```

3. **Railway auto-deploys from main branch**

4. **Verify deployment:**
   - Check Railway logs for startup errors
   - Verify cron jobs scheduled
   - Test pathway monitor with existing positions (if any)

5. **Monitor first 24 hours:**
   - Watch for pathway exit emails
   - Check Railway logs every few hours
   - Verify no errors in pathway monitoring

---

## Key Decisions Made

1. **Trailing stops at +50% instead of +100%** for deepValue
   - Protects gains earlier
   - Based on MSFT $280→$530→$380 example

2. **No fixed trim levels for long-term pathways**
   - deepValue, turnaround, cashMachine rely on trailing stops only
   - Simpler, lets winners run with protection

3. **45-minute monitoring frequency**
   - Balances responsiveness with API rate limits
   - Runs during market hours only (9am-4pm ET)

4. **Auto-execution with email notifications**
   - Pathway exits are mechanical, don't need approval
   - User gets notified after execution
   - Weekly Opus review can still recommend manual adjustments

5. **Monthly re-evaluation guidance**
   - Not a separate cron job
   - Guidance for Opus in weekly reviews
   - Focus on long-term positions monthly

---

## Production URL

**App:** https://whiskie-production.up.railway.app  
**Database:** `postgresql://postgres:FfUODiEUFXZPGEeJifsKToEvxnavlkGz@hopper.proxy.rlwy.net:44407/railway`

---

**Status:** Implementation complete, ready for deployment and testing in paper trading mode.
