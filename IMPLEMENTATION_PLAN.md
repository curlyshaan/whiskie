> [!IMPORTANT]
> Historical or planning document.
> This file is retained for context, but it is **not** the source of truth for the current implementation.
> Use `README.md`, `ARCHITECTURE.md`, `FUNDAMENTAL_SCREENER_METRICS.md`, and `CLAUDE.md` for current behavior.

# Fundamental Screener Fixes - Implementation Plan

## Status: ✅ COMPLETED

### ✅ ALL FIXES IMPLEMENTED (2026-04-15)

1. **shortFloat from Yahoo Finance**
   - Added Yahoo Finance import to fmp.js
   - Integrated getShortInterest() call in getFundamentals()
   - Graceful error handling (defaults to 0 on failure)
   - Added shortFloat field to return object

2. **Raised Thresholds**
   - LONG_THRESHOLD: 38 → 50
   - SHORT_THRESHOLD: 50 → 55

3. **Fixed Margin Comparison Fields**
   - Added operatingMarginQ (current quarter)
   - Added operatingMarginPrevQ (previous quarter)
   - Kept operatingMargin (TTM) for general use
   - Updated fundamental-screener.js to extract both
   - Updated all pathways to use Q-over-Q comparisons

4. **Quality Minimums (Prevent One-Metric Wonders)**
   - High Growth: Raised from 10 pts → 20 pts
   - Deep Value: Raised to 25 pts + require ≥3 quality signals
   - Cash Machine: Raised to 20 pts + require ≥3 category diversity
   - Inflection: Added balance sheet requirement (≥15 pts)

5. **Tiered Accrual Penalties (All Pathways)**
   - 8-10%: -15 points
   - 10-12%: -25 points
   - >12%: Reject

6. **Debt Penalties (High Growth)**
   - D/E > 2.0: -25 points (risky leverage)
   - D/E > 1.5: -15 points (elevated leverage)

7. **Revenue Scoring Fix (High Growth)**
   - ≥50% growth: +45 points (was +40)
   - ≥30% growth: +35 points (was +40)
   - Fixed illogical scoring where both tiers gave same points

### 📋 VERIFICATION CHECKLIST

✅ All database field names consistent (operatingMargin, operatingMarginQ, operatingMarginPrevQ)
✅ No duplicate field extractions in fundamental-screener.js
✅ All pathway scoring functions updated consistently
✅ Code tested - no broken variables or database issues
✅ "Selecting fundamentally, timing technically" philosophy maintained
✅ Opus prompts balanced (not overly technical-focused)

### 🎯 GOAL ACHIEVED
Created "best combos" - stocks must pass multiple quality checks, not just one outlier metric.

### ⚠️ CRITICAL NOTES
- Momentum bias in pre-ranking is INTENTIONAL (timing entry, not selection)
- Technical analysis in Opus prompts is for entry timing, not stock selection
- Yahoo Finance rate limits handled gracefully (shortFloat defaults to 0)
- All changes maintain "selecting fundamentally, timing technically" philosophy

### 📊 EXPECTED IMPACT
- Pass rates should drop significantly from previous 62%
- Higher quality candidates with multiple strong metrics
- Fewer one-metric wonders
- Better risk-adjusted returns from diversified quality signals
