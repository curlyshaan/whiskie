## HIGH-COUNT PATHWAY ANALYSIS

### 1. QARP (85 stocks) - CRITICAL LOOPHOLE

**Issue**: Can pass on quality alone without reasonable valuation
- Current: ROIC (25) + ROE (25) = 50 points → PASS
- No upper P/E limit - stocks with P/E of 80+ can pass
- "Quality at Reasonable Price" doesn't enforce "reasonable"

**Fix**:
```javascript
// Add P/E ceiling
if (peRatio > 35) return 0;  // Hard reject expensive stocks

// Require multi-category scoring
const categories = {
  quality: (roic > 0.15 ? 25 : 0) + (roe > 0.20 ? 25 : 0),
  valuation: peScore,  // existing P/E scoring
  growth: earningsGrowthScore,  // existing
  balance: debtScore  // existing
};

// Must score in at least 3 of 4 categories
const categoriesWithPoints = Object.values(categories).filter(s => s >= 10).length;
if (categoriesWithPoints < 3) return 0;

// Increase threshold
this.LONG_THRESHOLD = 40;  // was 35
```

**Reasoning**: QARP should require quality AND reasonable valuation AND growth. Current logic allows expensive, low-growth stocks to pass on quality metrics alone.

**Expected Impact**: 85 → 45-55 stocks (35-40% reduction)

---

### 2. Turnaround (77 stocks) - INCOMPLETE TURNAROUND EVIDENCE

**Issue**: Can pass on operational OR financial improvement, not both
- Current: Margin expansion (30) + revenue stabilizing (20) = 50 → PASS
- Could have improving margins but still burning cash
- Could have positive FCF but operations still deteriorating

**Fix**:
```javascript
// Require BOTH operational AND financial improvement
const operationalScore = marginExpansionScore + revenueScore;
const financialScore = fcfScore + debtScore;

if (operationalScore < 20 || financialScore < 15) return 0;

// Tighten debt ceiling
if (debtToEquity > 1.5) return 0;  // was 2.0

// Increase threshold
this.LONG_THRESHOLD = 40;  // was 35
```

**Reasoning**: True turnarounds show improvement in BOTH operations (margins, revenue) AND financial health (FCF, debt). Single-dimension improvement isn't enough.

**Expected Impact**: 77 → 40-50 stocks (35-45% reduction)

---

### 3. DeepValue (66 stocks) - QUALITY BLIND SPOT

**Issue**: Can pass on valuation alone without quality checks
- Current: PEG ≤1.5 (30) + FCF positive (20) = 50 → PASS
- No requirement for balance sheet health or returns
- "Value trap" stocks with deteriorating fundamentals can pass

**Fix**:
```javascript
// Require minimum quality threshold
const qualityScore = (debtToEquity <= 0.5 ? 15 : debtToEquity <= 1.0 ? 8 : 0) +
                     (roic > 0.15 ? 10 : 0);

if (qualityScore < 15) return 0;  // Must have either low debt OR good ROIC

// Require multiple value signals
const valueSignals = [
  pegRatio <= 2.5,
  peRatio < 25,
  freeCashflowPerShare > 0
].filter(Boolean).length;

if (valueSignals < 2) return 0;  // Need 2 of 3 value metrics

// Increase threshold
this.LONG_THRESHOLD = 40;  // was 35
```

**Reasoning**: Deep value should mean cheap AND quality, not just cheap. Avoid value traps with deteriorating fundamentals.

**Expected Impact**: 66 → 35-45 stocks (35-45% reduction)

---

### 4. Overvalued SHORT (70 stocks) - SINGLE-METRIC VULNERABILITY

**Issue**: Can pass valuation criteria with just one extreme metric
- Current: PEG > 4.0 (20 points) alone satisfies valuation requirement
- Could have reasonable P/E but high PEG due to low growth
- Need multiple valuation metrics to confirm overvaluation

**Fix**:
```javascript
// Require multiple valuation signals
const valuationSignals = [
  peRatio > highPE * 1.5,
  pegRatio > 3.0,
  evToEbitda > 40
].filter(Boolean).length;

if (valuationSignals < 2) return 0;  // Need 2 of 3 extreme valuations

// Increase threshold
this.SHORT_THRESHOLD = 55;  // was 50

// Tighten short float limit
this.MAX_SHORT_FLOAT = 0.15;  // was 0.20 (avoid crowded shorts)
```

**Reasoning**: True overvaluation should be evident across multiple metrics, not just one. Single-metric extremes can be justified by business model or sector.

**Expected Impact**: 70 → 35-45 stocks (40-50% reduction)

---

## VOLUME FILTERING GAP - CRITICAL FIX

**Issue**: Only checking dollar volume, not share volume
- $100 stock × 50K shares = $5M (passes) but only 50K shares/day
- $10 stock × 500K shares = $5M (passes) with 500K shares/day
- Share liquidity matters for execution

**Fix**:
```javascript
// Add share volume requirements
this.MIN_AVG_VOLUME_SHARES_LONG = 100_000;   // 100K shares/day minimum
this.MIN_AVG_VOLUME_SHARES_SHORT = 500_000;  // 500K shares/day for shorts

// Apply in global filters
if (intent === 'LONG') {
  if (avgVolume < this.MIN_AVG_VOLUME_SHARES_LONG) return false;
  if (dollarVolume < this.MIN_DOLLAR_VOLUME) return false;
}

if (intent === 'SHORT') {
  if (avgVolume < this.MIN_AVG_VOLUME_SHARES_SHORT) return false;
  if (dollarVolume < this.MIN_SHORT_DOLLAR_VOLUME) return false;
}
```

**Reasoning**: 
- Share volume ensures sufficient liquidity for position building/unwinding
- Higher requirement for shorts due to borrow availability and covering risk
- Dual check (dollar + share volume) prevents both low-liquidity scenarios

**Expected Impact**: 5-10% reduction across all pathways, primarily affecting lower-priced stocks

---

## CROSS-PATHWAY IMPROVEMENTS

### 1. Accrual Ratio Consistency
**Current**: Applied to some pathways, not all

**Fix**:
```javascript
// Apply to ALL long pathways
if (intent === 'LONG' && accrualRatio > 0.12) return 0;
```

**Reasoning**: High accruals indicate earnings quality issues - should disqualify across all strategies.

---

### 2. Minimum Profitability for Growth Pathways
**Current**: highGrowth only requires positive operating margin

**Fix**:
```javascript
// For highGrowth pathway
if (operatingMargin < 0.05) return 0;  // was just > 0

// Add for inflection pathway
if (operatingMargin < 0) return 0;  // must be profitable or breaking even
```

**Reasoning**: Growth without path to profitability is speculative. Require minimum margin threshold.

---

## SUMMARY OF CHANGES

**Global Filters:**
```javascript
this.MIN_AVG_VOLUME_SHARES_LONG = 100_000;
this.MIN_AVG_VOLUME_SHARES_SHORT = 500_000;
this.LONG_THRESHOLD = 40;  // was 35
this.SHORT_THRESHOLD = 55;  // was 50
this.MAX_SHORT_FLOAT = 0.15;  // was 0.20
```

**Expected New Distribution:**
- qarp: 85 → 45-55 (quality + valuation required)
- turnaround: 77 → 40-50 (both operational + financial improvement)
- overvalued: 70 → 35-45 (multiple valuation extremes)
- deepValue: 66 → 35-45 (quality floor required)
- Others: Minimal impact (already selective)

**Total watchlist: 366 → 220-260 stocks (40% reduction)**

This maintains opportunity set while dramatically improving quality. Phase 2/3 Opus filtering will further refine from this higher-quality base.