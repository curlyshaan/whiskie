# Fundamental Screener - Pathway Metrics & Criteria

This document details the exact metrics, thresholds, and conditions used by each pathway in Whiskie's fundamental screener.

**Last Updated:** 2026-04-15

---

## Overview

The fundamental screener evaluates 407 stocks from the curated universe using **sector-adjusted thresholds** defined in `sector-config.js`. Each sector has different ideal/high thresholds for P/E, PEG, ROE, margins, etc.

**Key Principle:** Tech deep value ≠ Finance deep value. Dynamic scoring per sector ensures fair evaluation.

---

## LONG PATHWAYS

### 1. Deep Value
**Philosophy:** Low valuation + high FCF + quality fundamentals

**Market Cap Requirement:** $2B minimum (quality value vs value traps)

**Rejection Criteria:**
- Accrual ratio > 12% (earnings not backed by cash)

**Scoring Components:**

**VALUE SIGNALS (need 2 of 3):**
- **PEG Ratio (Trailing):**
  - ≤ sector ideal (default 1.5): +30 points, "excellent"
  - ≤ sector high (default 2.5): +15 points, "acceptable"
  
- **P/E Ratio:**
  - < sector low (default 15): +25 points, "low for sector"
  - < sector mid (default 25): +12 points
  
- **FCF Per Share:**
  - > 0: +20 points

**QUALITY SIGNALS:**
- **ROE:**
  - > 15%: +20 points, "quality value"
  - > 10%: +10 points
  
- **Operating Margin:**
  - > sector ideal (default 15%): +15 points
  - > sector acceptable (default 10%): +8 points
  
- **Debt to Equity:**
  - < 0.5: +10 points, "low debt"

**Minimum Requirements:**
- Must have at least 2 of 3 value signals
- Quality score > 0

**Pass Threshold:** ≥38 points

---

### 2. High Growth
**Philosophy:** Revenue growth > 15%, ignore valuation (growth justifies premium)

**Market Cap Requirement:** $500M minimum (growth emerges small)

**Rejection Criteria:**
- Accrual ratio > 12% (earnings not backed by cash)

**Scoring Components:**

**REVENUE GROWTH (tiered):**
- ≥ 50%: +40 points, "exceptional"
- ≥ 30%: +40 points, "strong"
- ≥ 20%: +25 points, "solid"
- ≥ 15%: +15 points

**EARNINGS GROWTH:**
- ≥ 40%: +30 points
- ≥ 20%: +15 points

**PROFITABILITY:**
- Operating margin > 0: +10 points

**ACCELERATION BONUS:**
- Q-over-Q acceleration (current Q > prev Q) AND current Q > 20%: +20 points

**VALUATION CHECK (Forward PEG preferred):**
- **Uses forward PEG if available, otherwise trailing PEG**
- < 2.0: +15 points, "reasonable valuation for growth"
- < 3.0: +5 points, "acceptable"

**Pass Threshold:** ≥38 points

---

### 3. Inflection
**Philosophy:** Q-over-Q acceleration + margin expansion

**Market Cap Requirement:** $500M minimum (catch early momentum)

**Rejection Criteria:**
- Accrual ratio > 12%

**Scoring Components:**

**ACCELERATION:**
- Revenue growth Q-over-Q acceleration > 10pp: +40 points, "strong acceleration"
- Revenue growth Q-over-Q acceleration > 5pp: +25 points, "accelerating"

**MARGIN EXPANSION:**
- Operating margin expansion > 5pp: +30 points, "margin expansion"
- Operating margin expansion > 2pp: +15 points

**PROFITABILITY:**
- Operating margin > 10%: +15 points
- Operating margin > 5%: +8 points

**VALUATION (Trailing PEG):**
- < 3.0: +10 points, "reasonable"

**Pass Threshold:** ≥38 points

---

### 4. Cash Machine
**Philosophy:** FCF yield > 8% + growing FCF

**Market Cap Requirement:** $2B minimum (8% FCF yield at $2B = opportunity, at $500M = distress)

**Rejection Criteria:**
- Accrual ratio > 12%

**Scoring Components:**

**FCF YIELD:**
- > 12%: +40 points, "exceptional FCF yield"
- > 8%: +30 points, "high FCF yield"

**FCF GROWTH:**
- > 20%: +25 points, "FCF growing strongly"
- > 10%: +15 points, "FCF growing"

**PROFITABILITY:**
- Operating margin > 15%: +15 points
- Operating margin > 10%: +8 points

**BALANCE SHEET:**
- Debt to equity < 0.5: +10 points

**Pass Threshold:** ≥38 points

---

### 5. QARP (Quality at Reasonable Price)
**Philosophy:** High ROIC/ROE compounders at fair valuations

**Market Cap Requirement:** $2B minimum (quality verification, prefer $10B+)

**Rejection Criteria:**
- P/E > 35 (too expensive for QARP)
- Accrual ratio > 12%

**Scoring Components (must score in 3+ categories):**

**QUALITY:**
- **ROIC:**
  - > 20%: +25 points, "exceptional quality"
  - > 15%: +15 points, "quality compounder"
  
- **ROE:**
  - > 20%: +25 points, "high returns"

**VALUATION:**
- **P/E Ratio:**
  - 15-25: +20 points, "reasonable valuation"
  - 25-30: +10 points
  
- **PEG Ratio (Trailing):**
  - ≤ 2.0: +15 points, "reasonable price for growth"
  - ≤ 2.5: +8 points, "acceptable"

**GROWTH:**
- **Earnings Growth:**
  - > 10%: +20 points, "consistent"
  - > 0%: +10 points

**BALANCE SHEET:**
- Debt to equity < 0.5: +10 points

**Minimum Requirements:**
- Must score in 3+ categories (quality, valuation, growth, balance)

**Pass Threshold:** ≥38 points

---

### 6. Quality Compounder (NEW - 2026-04-15)
**Philosophy:** Catch high-quality companies during temporary earnings dips

**Market Cap Requirement:** $2B minimum (quality verification)

**Hard Filters (must pass ALL):**
- ROE > 20% (exceptional returns)
- ROIC > 15% (capital efficiency)
- Operating margin > 20% (pricing power)
- Operating margin Q-over-Q ≥ -2% (stable/expanding margins - distinguishes temp vs structural)
- D/E < 0.5 (low debt)
- Interest coverage > 5x (debt serviceability)
- Revenue growth > 8% (business still growing)
- Earnings growth between -8% and +5% (temporary dip range)
- P/E < 35 OR PEG < 3.0 (valuation ceiling - quality can still be overpriced)
- Accrual ratio < 12%

**Scoring Components:**

**QUALITY METRICS:**
- ROE > 25%: +30 points, "exceptional"
- ROE 20-25%: +20 points
- ROIC > 20%: +25 points, "capital efficient"
- ROIC 15-20%: +15 points
- Operating margin > 25%: +20 points, "pricing power"
- Operating margin 20-25%: +15 points
- Margin expanding Q-over-Q > 2%: +15 points (reward improving margins)

**GROWTH:**
- Revenue growth > 12%: +15 points
- Revenue growth 8-12%: +10 points

**BALANCE SHEET:**
- D/E < 0.3: +15 points, "very low debt"
- D/E 0.3-0.5: +10 points, "low debt"
- Quick ratio > 1.5: +10 points, "strong liquidity"

**ACCRUAL PENALTIES:**
- 8-10%: -15 points
- 10-12%: -25 points

**Pass Threshold:** ≥50 points

**Example:** GOOGL (ROE 35%, ROIC 21.8%, margin 32%, revenue +11.3%, earnings -1.5%) would score ~100 points

**Why This Matters:** Opus-validated pathway to catch quality companies like GOOGL during temporary earnings dips. Strict safeguards prevent catching structural declines disguised as temporary weakness. Margin stability check and interest coverage requirements are critical filters.

---

### 7. Turnaround
**Philosophy:** Distressed valuations + early recovery signs

**Market Cap Requirement:** $500M minimum (distress acceptable, upside compensates)

**Rejection Criteria:**
- Accrual ratio > 12%

**Scoring Components:**

**DISTRESSED VALUATION:**
- P/E < 20: +15 points, "undervalued turnaround"
- P/E < 15: +20 points

**RECOVERY SIGNS:**
- Revenue growth acceleration (current Q > prev Q): +30 points, "growth inflecting"
- Margin expansion > 2pp: +25 points, "margins improving"
- FCF growth > 20%: +20 points, "cash flow improving"

**QUALITY CHECK:**
- Operating margin > 5%: +10 points
- Current ratio > 1.5: +10 points

**Pass Threshold:** ≥38 points

---

## SHORT PATHWAYS

### Overvalued
**Philosophy:** Extreme valuation + deteriorating fundamentals + short safety

**Market Cap Requirement:** $2B minimum

**Dollar Volume Requirement:** $20M daily minimum

**Must Pass ALL 3 Criteria:**

#### CRITERIA 1: Extreme Valuation (need 2+ signals)

**P/E Ratio:**
- > 1.5x sector ceiling: +20 points, "extreme P/E"
- > sector ceiling: +10 points

**PEG Ratio:**
- **CRITICAL: Uses forward PEG for growth stocks (>15% revenue growth), trailing PEG otherwise**
- **This prevents false positives like LLY (trailing PEG 3.29, forward PEG 1.82)**
- > 4.0: +20 points, "severely overvalued"
- > 3.0: +10 points, "overvalued"
- Negative PEG + P/E > 90% sector threshold + P/E > 15: +15 points, "premium multiple on declining earnings"

**EV/EBITDA:**
- > 40: +10 points, "stretched"

**Minimum:** Must have 2+ valuation signals

#### CRITERIA 2: Deteriorating Fundamentals

**Revenue Deceleration:**
- Deceleration > 10pp: +25 points, "revenue decelerating"
- Deceleration > 5pp: +12 points, "revenue growth slowing"

**Margin Compression:**
- Compression > 5pp: +25 points, "margin compression"
- Compression > 2pp: +12 points

**FCF Decline:**
- FCF growth < -20%: +20 points, "FCF declining"

**Accrual Bonus:**
- Accrual ratio > 12%: +15 points, "earnings not backed by cash"

#### CRITERIA 3: Short Safety Check

**Rejection Criteria (any one fails = reject):**
- Short float > 15% (squeeze risk)
- Market cap < $2B (liquidity risk)
- Dollar volume < $20M (liquidity risk)
- Average volume < 500K shares/day (liquidity risk)

**Pass Threshold:** ≥50 points total (valuation + deterioration + accrual bonus)

---

## Key Metrics Definitions

### Accrual Ratio
```
Accrual Ratio = (Net Income - Operating Cash Flow) / Total Assets
```
- Measures earnings quality
- High accruals (>12%) = earnings not backed by cash = red flag

### PEG Ratio
```
PEG Ratio = P/E Ratio / Earnings Growth Rate
```
- **Trailing PEG:** Uses TTM P/E and historical earnings growth
- **Forward PEG:** Uses TTM P/E and expected future earnings growth
- < 1.0 = undervalued relative to growth
- 1.0-2.0 = fairly valued
- > 2.0 = potentially overvalued
- > 3.0 = overvalued

**When to Use Which:**
- **Trailing PEG:** Value stocks, quality compounders (deepValue, QARP, inflection)
- **Forward PEG:** Growth stocks (highGrowth, overvalued pathway for growth stocks)

### FCF Yield
```
FCF Yield = Free Cash Flow / Market Cap
```
- > 8% = attractive
- > 12% = exceptional

### Sector-Adjusted Thresholds
Defined in `sector-config.js`:
- **P/E Range:** low, mid, high (e.g., Tech: 15/25/40, Utilities: 12/18/25)
- **PEG Range:** ideal, high (e.g., Tech: 1.5/2.5, Healthcare: 1.8/3.0)
- **ROE Range:** acceptable, ideal (e.g., Tech: 15%/25%, Financials: 10%/18%)
- **Operating Margin Range:** acceptable, ideal (varies by sector)

---

## Data Sources

All metrics sourced from FMP (Financial Modeling Prep) API:

**Endpoints:**
- `/stable/ratios-ttm` - P/E, PEG (trailing & forward), margins, ROE
- `/stable/key-metrics-ttm` - ROIC, FCF yield, EV ratios
- `/stable/financial-growth?period=quarter` - True YoY growth rates
- `/stable/income-statement?period=quarter` - Quarterly financials
- `/stable/cash-flow-statement?period=quarter` - Cash flow data
- `/stable/balance-sheet?period=quarter` - Balance sheet data

**Rate Limiting:** 400ms between calls, 300 calls/minute limit

---

## Recent Improvements (2026-04-15)

### Comprehensive Pathway Filter Overhaul

**Raised Selectivity Thresholds:**
- LONG_THRESHOLD: 38 → 50 (31% increase)
- SHORT_THRESHOLD: 50 → 55 (10% increase)
- Expected impact: Significantly lower pass rates from previous 62%

**Quality Minimums (Prevent One-Metric Wonders):**
- **High Growth**: Raised from 10 pts → 20 pts
- **Deep Value**: Raised to 25 pts + require ≥3 quality signals
- **Cash Machine**: Raised to 20 pts + require ≥3 category diversity
- **Inflection**: Added balance sheet requirement (≥15 pts)

**Tiered Accrual Penalties (All Pathways):**
- 8-10%: -15 points (was -10)
- 10-12%: -25 points (new tier)
- >12%: Reject (unchanged)
- Better granularity than binary reject

**Debt Penalties (High Growth):**
- D/E > 2.0: -25 points (risky leverage)
- D/E > 1.5: -15 points (elevated leverage)
- Prevents growth stocks with dangerous debt loads

**Revenue Scoring Fix (High Growth):**
- ≥50% growth: +45 points (was +40)
- ≥30% growth: +35 points (was +40)
- Fixed illogical scoring where both tiers gave same points

**Category Diversity Requirements:**
- Deep Value must score in ≥3 of: ROE, operating margin, debt/equity, ROIC, quick ratio, dividend yield
- Cash Machine must score in ≥3 of: FCF yield, FCF growth, efficiency, balance sheet
- Prevents passing on single outlier metric

### Forward PEG Integration
1. **Added `forwardPegRatio` field** to `fmp.js` getFundamentals()
2. **HighGrowth pathway** now uses forward PEG (prefers forward over trailing)
3. **Overvalued pathway** uses forward PEG for growth stocks (>15% revenue growth)
4. **QARP pathway** added PEG ratio checks (trailing PEG)
5. **Adhoc analyzer** displays both trailing and forward PEG
6. **Weekly Opus review** includes both PEG ratios in prompts
7. **Opus screener** shows both PEG ratios in Phase 2/3 analysis

### Why This Matters
**Forward PEG:** Growth stocks like LLY were incorrectly flagged as overvalued based on trailing PEG (3.29) when forward PEG (1.82) showed reasonable valuation. Forward PEG reflects expected future growth, making it more appropriate for high-growth companies.

**Quality Minimums:** Previous system allowed stocks to pass with single outlier metrics (e.g., 50% revenue growth = +40 pts, pass at 38 threshold). New system requires "best combos" - multiple quality signals across different categories. This creates more robust, diversified candidates with lower risk profiles.

---

## Testing & Validation

To test a specific stock against all pathways:
```bash
node test/test-fundamental-screener.js SYMBOL
```

To run full Saturday screening:
```javascript
import fundamentalScreener from './src/fundamental-screener.js';
await fundamentalScreener.runSaturdayScreening();
```

---

## Related Files

- `src/fundamental-screener.js` - Main screener implementation
- `src/sector-config.js` - Sector-specific thresholds
- `src/fmp.js` - FMP API integration and data fetching
- `src/weekly-opus-review.js` - Sunday Opus review of Saturday candidates
- `src/adhoc-analyzer.js` - Manual stock analysis tool
- `src/opus-screener.js` - Phase 2/3 deep analysis with Opus
