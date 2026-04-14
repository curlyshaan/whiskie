## Pathway-Specific Analysis & Recommendations

### 1. QARP (85 stocks → target ~45)

**Current Issue:**
Stocks pass too easily by hitting just 2 criteria. ROIC (25) + ROE (25) = 50 points without requiring growth or reasonable valuation. This defeats the "QA" (Quality at) "RP" (Reasonable Price) concept.

**Recommended Fixes:**
- **Raise threshold to 45 points** (from 35)
- **Add category requirements**: Must score ≥15 points in at least 3 of 4 categories:
  - Profitability (ROIC + ROE)
  - Valuation (P/E scoring)
  - Growth (earnings growth)
  - Safety (debt)
- **Tighten P/E scoring**: P/E >30 = automatic disqualification (currently no upper limit)
- **Raise ROIC threshold**: >20% for full 25 points, >15% for 15 points

**Reasoning:**
QARP should identify quality companies at reasonable prices with growth. Current criteria allow expensive, slow-growing companies to pass if they're profitable. The category requirement ensures balanced scoring.

**Expected Impact:** 85 → ~45 stocks (47% reduction)

---

### 2. Turnaround (77 stocks → target ~35)

**Current Issue:**
"Turnaround" implies rare, high-conviction situations where struggling companies are genuinely improving. 77 candidates suggests criteria are catching "slightly improving" rather than "true turnaround."

**Recommended Fixes:**
- **Raise threshold to 45 points** (from 35)
- **Raise minimum market cap to $1B** (from $500M) - turnarounds are risky, need liquidity
- **Require BOTH**: 
  - Margin expansion >2pp (30 points for >3pp, 20 points for >2pp)
  - AND either FCF turning positive OR revenue stabilizing
- **Add disqualifier**: Revenue declining >10% = reject (even if margins improving)
- **Tighten debt requirement**: D/E <0.75 for points (from <1.0)

**Reasoning:**
True turnarounds show multiple simultaneous improvements, not just one metric. Higher market cap reduces bankruptcy risk. Requiring both operational improvement (margins) and financial improvement (FCF or revenue) ensures genuine turnaround vs temporary fluctuation.

**Expected Impact:** 77 → ~35 stocks (55% reduction)

---

### 3. Overvalued SHORT (70 stocks → target ~35)

**Current Issue:**
70 short candidates is excessive and risky. Criteria may be catching "expensive" stocks rather than "overvalued with deteriorating fundamentals." Shorting requires high conviction.

**Recommended Fixes:**
- **Raise total threshold to 60 points** (from 50)
- **Tighten category minimums**:
  - Extreme valuation: ≥25 points required (from ≥20)
  - Deteriorating fundamentals: ≥25 points required (from ≥20)
- **Add momentum check**: Reject if stock down >30% in 6 months (already being shorted)
- **Raise short float limit to ≤15%** (from ≤20%) - reduce squeeze risk
- **Add**: Require 2+ deteriorating metrics (not just one big one)

**Reasoning:**
Shorts are inherently risky with unlimited downside. We want only the highest-conviction overvalued situations with multiple deteriorating fundamentals. The momentum check avoids piling into already-crushed stocks. Lower short float reduces squeeze risk.

**Expected Impact:** 70 → ~35 stocks (50% reduction)

---

### 4. DeepValue (66 stocks → target ~45)

**Current Issue:**
Can pass on valuation metrics alone (PEG + P/E = 27-55 points) without demonstrating quality. "Deep value" should mean cheap AND quality, not just cheap.

**Recommended Fixes:**
- **Add quality floor**: Must score ≥20 points from quality metrics (FCF + debt + ROIC)
- **Raise threshold to 40 points** (from 35)
- **Tighten PEG scoring**: 
  - PEG ≤1.0: 30 points (from ≤1.5: 15-30)
  - PEG 1.0-1.5: 20 points
  - PEG 1.5-2.5: 10 points (from 15-30)
- **Add**: Revenue growth must be positive (reject if declining >5%)

**Reasoning:**
Deep value traps are real - cheap stocks that deserve to be cheap. Requiring quality metrics ensures we're finding undervalued quality, not just cheap junk. Positive revenue growth confirms business isn't dying.

**Expected Impact:** 66 → ~45 stocks (32% reduction)

---

## Volume & Liquidity Recommendations

**Add MIN_AVG_VOLUME Filter:**

Current dollar volume filters ($5M longs, $20M shorts) are good but insufficient. Need actual share volume:

- **Longs**: 250,000 shares/day minimum
  - Ensures ability to build positions over 5-10 days
  - Reduces slippage on entry/exit
  
- **Shorts**: 500,000 shares/day minimum
  - Critical for covering positions quickly if wrong
  - Reduces squeeze risk from low liquidity
  - Higher than longs because shorts need exit flexibility

**Reasoning:**
A $10 stock with $5M volume = 500k shares (good)
A $100 stock with $5M volume = 50k shares (illiquid)

Share volume captures actual liquidity better than dollar volume alone.

---

## Market Cap Adjustments

**Current:**
- $2B: deepValue, qarp, cashMachine, overvalued ✓
- $500M: highGrowth, inflection, turnaround

**Recommended:**
- **Turnaround: $500M → $1B** (as discussed above)
- **HighGrowth: Keep $500M** (small-caps can have explosive growth)
- **Inflection: Keep $500M** (inflection points happen at all sizes)

---

## Additional Cross-Pathway Improvements

### 1. Accrual Ratio Check
Currently applied to: deepValue, highGrowth, inflection, qarp

**Add to**: turnaround, cashMachine
- Turnarounds with high accruals may be manipulating earnings
- Cash machines should have low accruals by definition

### 2. Insider Trading Filter
**Add across all pathways:**
- Reject if insider selling >$5M in last 3 months AND buying <$500k
- Insiders know more than we do

### 3. Earnings Quality Score
**Add to qarp and quality pathways:**
- Check for: consistent earnings, low special items, cash flow alignment
- Reject if >20% of earnings from non-recurring items

---

## Risk of Over-Filtering Assessment

**Legitimate Concern:** Tightening criteria could eliminate valid opportunities.

**Mitigation Strategies:**

1. **Graduated Implementation:**
   - Phase 1: Implement volume filters + raise thresholds by 5 points
   - Phase 2: Add category requirements after observing results
   - Phase 3: Fine-tune based on Phase 2/3 Opus analysis quality

2. **Pathway Diversity:**
   - Keep some pathways looser (highGrowth, inflection) for small-cap opportunities
   - Tighten only the high-count pathways (qarp, turnaround, overvalued)

3. **Regular Review:**
   - Monthly review of filtered-out stocks that performed well
   - Adjust criteria if consistently missing opportunities

4. **Safety Net:**
   - Keep "quality" pathway (15 stocks) as catch-all for exceptional companies
   - Add "special situations" pathway for unique opportunities

**Conclusion on Risk:**
Current 296 long candidates → ~210 is still substantial. With Phase 2/3 Opus doing deep analysis, we want quality over quantity. Better to deeply analyze 210 good candidates than superficially analyze 296 mediocre ones.

---

## Summary of Expected Impacts

**Before:**
- Total longs: 296 stocks
- Total shorts: 70 stocks
- Total candidates: 366 stocks

**After Recommended Changes:**
- Total longs: ~210 stocks (29% reduction)
- Total shorts: ~35 stocks (50% reduction)
- Total candidates: ~245 stocks (33% reduction)

**Quality Improvements:**
- Higher conviction candidates in each pathway
- Better liquidity across all positions
- Reduced false positives (value traps, failing turnarounds, expensive-but-not-overvalued)
- More balanced scoring requiring multiple strengths

**Maintained Flexibility:**
- Still substantial candidate pools for analysis
- Pathway diversity preserved
- Small-cap opportunities retained in appropriate pathways
- Room for Phase 2/3 to find hidden gems

The goal isn't fewer candidates for its own sake - it's higher-quality candidates that justify the deep Opus analysis in Phase 2/3.