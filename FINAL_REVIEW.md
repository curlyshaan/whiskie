# Whiskie Bot - Final Review Before Deployment

## Summary
- **Problem:** Tradier API returns `cost_basis` as TOTAL COST, code treated it as per-share
- **Impact:** GLD showing $6,006/share (should be $428.99), -92.85% loss (should be +0.1% gain)
- **Solution:** Always divide cost_basis by quantity
- **Deployment:** Reset database → Push fixes → Verify

## Fixes Applied

### 1. Cost Basis Calculation (`src/analysis.js`)
```javascript
// Always divide by quantity (Tradier always returns total cost)
costBasis = tradierTotalCost / quantity;
```

### 2. Thinking Block Removal (`src/claude.js`)
Strips `<thinking_protocol>` tags from responses before display

### 3. Database Reset Script (`reset-database.js`)
One-time script to wipe all tables and start fresh

## Deployment Steps

1. **Reset Database:**
   ```bash
   export RAILWAY_TOKEN=bce52b45-fc6c-4031-9645-1613bf9f9a1c
   node reset-database.js
   ```

2. **Deploy Code:**
   ```bash
   git add -A
   git commit -m "Fix: Correct Tradier cost_basis calculation and remove thinking blocks"
   git push
   ```

3. **Verify:**
   - GLD shows ~$429/share (not $6,006)
   - No thinking blocks in output
   - Weekly review works correctly

## Questions Answered

**Q: Will existing GLD position sync correctly?**
A: YES - `mergePositions()` divides cost_basis by quantity

**Q: Does paper trading support shorting?**
A: YES - Tradier returns negative quantity for short positions

**Q: Is reset-database one-time?**
A: YES - Run once, then delete the script
