# Short Valuation Logic Review

**Date:** 2026-04-14  
**Purpose:** 3rd party review of proposed changes to short candidate valuation scoring

---

## Current Implementation

**Location:** `src/fundamental-screener.js:719-755`

### Logic Summary
Short candidates must pass THREE criteria:
1. **Valuation Score ≥20** - Requires 2+ extreme valuation signals
2. **Deterioration Score ≥20** - Requires declining fundamentals
3. **Safety Check** - Meme stock filter (short float, liquidity)
4. **Total Score ≥50** - Combined threshold

### Valuation Signals (Current)
Requires **2 of 3** signals to score:
- **Extreme P/E:** >1.5x sector threshold (20 points) OR >1x sector threshold (10 points)
- **High PEG:** >4.0 (20 points) OR >3.0 (10 points)
- **High EV/EBITDA:** >40 (10 points)

### Critical Issue: Negative PEG Handling
**Current behavior:** Negative PEG is completely ignored (not counted as a signal)

**Why this is problematic:**
- PEG becomes negative when earnings decline (PEG = P/E ÷ Earnings Growth)
- Negative PEG signals deteriorating earnings, which is valuable for shorts
- A stock with P/E 28 and declining earnings (-34%) gets 0 valuation signals
- This creates a blind spot for overvalued stocks with deteriorating fundamentals

---

## Proposed Changes

### 1. Add Negative PEG as Valuation Signal

**New scoring rule:**
```javascript
if (metrics.pegRatio < 0 && metrics.peRatio > highPE * 0.8) {
  score += 15;
  valuationSignals++;
  reasons.push(`Negative PEG with P/E ${metrics.peRatio.toFixed(1)} (paying premium for declining earnings)`);
}
```

**Rationale:**
- Negative PEG + above-average P/E = overvalued for a declining business
- Threshold: P/E must be >80% of sector threshold (e.g., >20 for Consumer Cyclical with threshold 25)
- Scores 15 points (between moderate and extreme valuation)

### 2. Lower Signal Requirement

**Change:** Require **1+ signals** instead of 2+

**Rationale:**
- Single extreme valuation metric (P/E 300) should qualify
- Combined with deterioration score, provides sufficient evidence
- Current 2-signal requirement is too restrictive

---

## Impact Analysis

### Example: Nike (NKE)

**Current Fundamentals:**
- P/E: 28.2 (vs Consumer Cyclical threshold 25)
- PEG: -0.83 (negative due to -34% earnings decline)
- Revenue Growth: -9.2%
- Operating Income: -45%
- FCF Growth: -26%
- Margin compression: 10-12% → 6%

**Current Logic:**
- Valuation Score: 0 (P/E 28.2 = 1.13x threshold, only 1 signal, needs 2)
- Deterioration Score: 40 (FCF declining -26%, negative earnings with P/E >30)
- Total: 40 (fails 50 threshold) ❌

**Proposed Logic:**
- Valuation Score: 25
  - P/E 28.2 vs 25 threshold: 10 points, 1 signal
  - Negative PEG with P/E 28.2: 15 points, 1 signal
- Deterioration Score: 40
- Total: 65 (passes 50 threshold) ✅

---

## Questions for Review

1. **Is negative PEG a valid valuation signal for shorts?**
   - Does paying 28x earnings for a company with -34% earnings growth constitute overvaluation?

2. **Is the 80% P/E threshold appropriate?**
   - Should we require P/E to be above sector average before negative PEG counts?
   - Alternative: Require P/E > sector threshold (100% instead of 80%)

3. **Should we require 1 or 2 valuation signals?**
   - 1 signal: More shorts, catches single-metric extremes
   - 2 signals: Fewer shorts, requires multiple confirmation points

4. **Scoring weight for negative PEG:**
   - Proposed: 15 points (between moderate 10 and extreme 20)
   - Alternative: 10 points (same as moderate P/E)
   - Alternative: 20 points (same as extreme valuation)

---

## Current Results

**Saturday Screening (2026-04-14):**
- Total stocks screened: 379
- Shorts identified: 37
- All shorts in "overvalued" pathway
- Score range: 87-95 (all well above 50 threshold)

**Stocks missing threshold:**
- 130 stocks failed both long and short thresholds
- Includes stocks like NKE with deteriorating fundamentals but moderate valuation

---

## Recommendation

**Implement both changes:**
1. Add negative PEG as valuation signal (15 points, requires P/E >80% of sector threshold)
2. Lower requirement from 2 signals to 1 signal

**Expected impact:**
- Increase short candidates by 10-20%
- Capture stocks with extreme single metrics (P/E 300) or negative PEG + moderate P/E
- Maintain quality through deterioration requirement (still need both valuation AND deterioration ≥20)

**Risk mitigation:**
- Total threshold remains 50 (unchanged)
- Deterioration requirement remains (unchanged)
- Safety check remains (meme stock filter)
- Only valuation scoring logic changes

---

## Code Changes Required

**File:** `src/fundamental-screener.js`

**Line 733-741:** Add negative PEG handling
```javascript
} else if (metrics.pegRatio > 3.0) {
  score += 10;
  valuationSignals++;
  reasons.push(`PEG ${metrics.pegRatio.toFixed(2)} (overvalued)`);
} else if (metrics.pegRatio < 0 && metrics.peRatio > highPE * 0.8) {
  // NEW: Negative PEG signals declining earnings
  score += 15;
  valuationSignals++;
  reasons.push(`Negative PEG with P/E ${metrics.peRatio.toFixed(1)} (paying premium for declining earnings)`);
}
```

**Line 750:** Change signal requirement
```javascript
// CHANGED: Require at least 1 signal (was 2)
if (valuationSignals < 1) {
  return 0;
}
```

---

## Testing Plan

1. Run screening with proposed changes on current universe (379 stocks)
2. Compare results: current 37 shorts vs proposed count
3. Review new short candidates for quality (extreme valuation or deterioration)
4. Verify NKE and similar stocks now qualify appropriately
5. Monitor for false positives (stocks that shouldn't be shorts)

---

**Prepared by:** Claude Code  
**Review requested from:** [3rd party reviewer name]  
**Status:** Awaiting approval
