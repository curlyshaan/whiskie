# Remaining Issues to Fix

## Status: NOT DEPLOYED (Awaiting Approval)

### ✅ FIXED - Cost Basis Calculation
- **Issue:** Tradier returns total cost, code treated as per-share
- **Fix:** Always divide by quantity in `src/analysis.js`
- **Verified:** Latest analysis shows GLD at +0.10% (not -92.85%)

### ✅ FIXED - All 6 Critical Issues from Opus Review
1. Division by zero guard
2. Hardcoded sandbox URL
3. Code-enforced trade limits
4. Sell quantity validation
5. API retry logic
6. Audited gain_loss field

### ❌ ISSUE 1: Positions Not Syncing to Database
**Problem:** GLD exists in Tradier but `positions` table is empty

**Root Cause:** Bot reads from Tradier but doesn't automatically save to database. Only saves when trades are executed.

**Solution Options:**
1. Add auto-sync on first analysis run
2. Manually run `sync-positions.js` script
3. Wait for next trade execution (will auto-sync)

**Recommended:** Add auto-sync to daily analysis workflow

### ❌ ISSUE 2: Stop-Loss Email Timeout
**Problem:** Email sending fails with ETIMEDOUT error

**Root Cause:** Gmail SMTP connection timeout (line 431 in index.js)

**Solution:** 
- Check Gmail app password is correct
- Increase SMTP timeout
- Add retry logic for email sending
- Consider alternative email service

### ✅ VERIFIED: Analysis Continues After Stop-Loss
**Confirmed:** Workflow DOES continue looking for opportunities after stop-loss
- Lines 313-388 in index.js show it continues to:
  - Check take-profit opportunities
  - Run trim checks
  - Tax optimization
  - Trailing stops
  - Earnings analysis
  - Market news
  - Deep analysis with Opus

**User Request:** Email should be sent on stop-loss trigger (currently failing due to timeout)

---

## Files Ready (NOT PUSHED):
1. `src/analysis.js` - Cost basis fix with zero guard
2. `src/tradier.js` - Hardcoded sandbox + retry logic
3. `src/trade-safeguard.js` - NEW: Trade limits
4. `src/index.js` - Integrated safeguard
5. `src/claude.js` - Strip thinking tags
6. `sync-positions.js` - NEW: Manual position sync
7. `reset-database.js` - Database reset script
8. `review-workflow.js` - Opus review script

---

## Next Steps (Awaiting Approval):

### Option A: Deploy Current Fixes
```bash
# Already committed but not pushed
git push
```

### Option B: Fix Remaining Issues First
1. Add auto-sync for positions
2. Fix email timeout issue
3. Then deploy everything together

### Option C: Deploy Now, Fix Later
1. Push current fixes (cost_basis working)
2. Address email/sync issues in next iteration

**Recommendation:** Option C - deploy the working fixes now, address email/sync separately
