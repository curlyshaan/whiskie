# Fundamental Screener Fixes - Implementation Plan

## Status: IN PROGRESS

### ✅ COMPLETED
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

### 🔧 IN PROGRESS - Need to Complete

#### 4. Update Margin Comparisons in Pathways
**Files to update:** fundamental-screener.js

**Changes needed:**
- scoreInflection: Use `operatingMarginQ - operatingMarginPrevQ` (line ~499)
- scoreTurnaround: Use `operatingMarginQ - operatingMarginPrevQ` (line ~718)
- scoreDeterioration: Use `operatingMarginPrevQ - operatingMarginQ` (line ~873)

#### 5. Add Negative Penalties

**Deep Value (scoreDeepValue):**
- Add check: if `revenueGrowth < -0.10` → reject (value trap protection)

**High Growth (scoreHighGrowth):**
- Add penalty: if `debtToEquity > 2.0` → -15 points (risky leverage)

**Tiered Accrual Ratio (all pathways):**
- Current: Hard reject at >12%
- New: 
  - 8-12%: -10 points
  - >12%: Reject

#### 6. Add Quality Minimums

**High Growth pathway:**
- Must score ≥10 points from quality/balance categories
- Track qualityScore separately
- Reject if qualityScore < 10

**Cash Machine pathway:**
- Must score ≥10 points from quality/balance categories
- Track qualityScore separately
- Reject if qualityScore < 10

#### 7. Tiered Operating Margin Scoring

**High Growth pathway (currently binary >0 = +10):**
- Change to:
  - >15%: +15 points
  - >5%: +8 points
  - <0%: -20 points (growth without profitability path)

### 📋 VERIFICATION CHECKLIST

Before committing:
- [ ] All database field names consistent (operatingMargin, operatingMarginQ, operatingMarginPrevQ)
- [ ] No duplicate field extractions in fundamental-screener.js
- [ ] All pathway scoring functions updated consistently
- [ ] Test that no code is broken (run a test screening)
- [ ] Review Opus prompts (ensure not overly technical-focused)
- [ ] Update FUNDAMENTAL_SCREENER_METRICS.md documentation

### 🎯 GOAL
Create "best combos" - stocks must pass multiple quality checks, not just one outlier metric.

### ⚠️ CRITICAL NOTES
- Momentum bias in pre-ranking is INTENTIONAL (timing entry, not selection)
- Do NOT remove technical analysis from Opus prompts (used for entry timing)
- Yahoo Finance rate limits handled gracefully (shortFloat defaults to 0)
- All changes must maintain "selecting fundamentally, timing technically" philosophy
