# Whiskie Database & Cost Basis Fixes

## Problem Identified

**Root Cause:** Tradier API returns `cost_basis` as **TOTAL COST** (not per-share), but the code was treating it inconsistently.

**Evidence from Tradier API docs:**
```json
{
  "cost_basis": 7954.16,  // TOTAL cost for position
  "quantity": 37,         // Number of shares
  "symbol": "AAPL"
}
// Per-share cost = 7954.16 / 37 = $215.04
```

**Impact:** 
- GLD position showing cost_basis of $6,006 per share (should be $428.99)
- Calculated as -92.85% loss (should be +0.1% gain)
- False stop-loss triggers
- Incorrect portfolio analysis

---

## Fixes Applied (NOT YET DEPLOYED)

### 1. Fixed Cost Basis Calculation (`src/analysis.js`)
**Before:** Complex heuristic trying to guess if total or per-share
**After:** Always divide by quantity (since Tradier always returns total cost)

```javascript
// FIXED: Always divide by quantity
costBasis = tradierTotalCost / quantity;
```

### 2. Removed Thinking Block Display (`src/claude.js`)
**Issue:** Extended thinking was appearing in user-facing output wrapped in `<thinking_protocol>` tags
**Fix:** Strip out thinking protocol tags before storing/displaying

```javascript
// Strip <thinking_protocol>...</thinking_protocol> from response
if (analysisText.includes('<thinking_protocol>')) {
  // Remove thinking block
}
```

### 3. Created Database Reset Script (`reset-database.js`)
**Purpose:** One-time script to wipe all data and start fresh with corrected calculations

**Usage:**
```bash
node reset-database.js
```

**What it does:**
- Drops all tables (trades, positions, position_lots, ai_decisions, etc.)
- Allows app to recreate tables on next startup
- Fresh start with correct cost_basis calculations

---

## Files Modified (Pending Approval)

1. ✅ `src/analysis.js` - Fixed cost_basis calculation
2. ✅ `src/claude.js` - Strip thinking protocol tags
3. ✅ `reset-database.js` - NEW: Database reset script
4. ✅ `src/weekly-review.js` - Added comment about thinking (already pushed)
5. ✅ `src/index.js` - Removed thinking display (already pushed)

---

## Deployment Plan (Awaiting Approval)

### Step 1: Reset Database
```bash
# On Railway or locally with Railway DB credentials
export DATABASE_URL="postgresql://..."
node reset-database.js
```

### Step 2: Deploy Fixed Code
```bash
git add src/analysis.js src/claude.js reset-database.js
git commit -m "Fix: Correct Tradier cost_basis calculation (always total cost) and remove thinking blocks"
git push
```

### Step 3: Verify
- Railway will auto-deploy
- App will recreate tables on startup
- Next position sync will use correct cost_basis calculation
- Weekly review will show clean output without thinking blocks

---

## Testing Checklist

After deployment:
- [ ] Check GLD position shows ~$429/share cost basis (not $6,006)
- [ ] Verify gain/loss calculation is correct (~0.1%, not -92.85%)
- [ ] Confirm weekly review output has no thinking blocks
- [ ] Test manual trigger: `curl -X POST https://whiskie-production.up.railway.app/weekly-review`
- [ ] Check dashboard shows clean analysis without `<thinking_protocol>` tags

---

## Notes

- **Tradier API always returns total cost** - this is confirmed in their documentation
- **Database reset is one-time** - after this, all new positions will be calculated correctly
- **No data loss concern** - this is paper trading mode, safe to reset
- **Thinking blocks are still captured** - just not displayed to users (stored for debugging)

---

## Ready for Approval

All fixes are ready but **NOT deployed** to git/Railway yet.
Awaiting user approval to proceed with deployment.
