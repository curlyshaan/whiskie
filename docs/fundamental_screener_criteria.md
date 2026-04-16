> [!IMPORTANT]
> Historical or planning document.
> This file is retained for context, but it is **not** the source of truth for the current implementation.
> Use `README.md`, `ARCHITECTURE.md`, `FUNDAMENTAL_SCREENER_METRICS.md`, and `CLAUDE.md` for current behavior.

# FUNDAMENTAL SCREENER - COMPLETE CRITERIA SPECIFICATION

## CURRENT CONFIGURATION

### Market Cap & Liquidity Filters
```javascript
MIN_DOLLAR_VOLUME = $5M daily
MIN_PRICE = $5 (no penny stocks)
MIN_MARKET_CAP = $500M (for all longs currently)
MIN_SHORT_MARKET_CAP = $2B (for shorts)
MIN_SHORT_DOLLAR_VOLUME = $20M daily
MAX_SHORT_FLOAT = 20% (meme stock filter)
```

### Scoring Thresholds
```javascript
LONG_THRESHOLD = 35 points (pass ANY pathway ≥35)
SHORT_THRESHOLD = 60 points (must hit ALL 3 criteria)
```

---

## LONG PATHWAYS (6 Total)

### 1. DEEP VALUE
**Current Market Cap:** $500M minimum
**Recommended:** $2B minimum (quality value vs value traps)

**Scoring Criteria:**
- PEG ≤ sector ideal (1.5): **30 points** | PEG ≤ sector high (2.5): **15 points**
- P/E < sector low (15): **25 points** | P/E < sector mid (25): **12 points**
- Positive FCF per share: **20 points**
- Debt/Equity ≤ 0.5x sector max: **15 points** | ≤ sector max: **8 points**
- ROIC > 15%: **10 points**

**Total possible:** 100 points | **Threshold:** 35 points

**Metrics Used:**
- pegRatio (from FMP ratios-ttm)
- peRatio (from FMP ratios-ttm)
- freeCashflowPerShare (from FMP key-metrics-ttm)
- debtToEquity (from FMP ratios-ttm)
- roic (from FMP key-metrics-ttm)
- Sector-specific thresholds from sector-config.js

---

### 2. HIGH GROWTH
**Current Market Cap:** $500M minimum
**Recommended:** Keep $500M (small caps grow faster)

**Scoring Criteria:**
- Revenue growth ≥50%: **40 points** | ≥30%: **30 points** | ≥15%: **15 points**
- Earnings growth ≥40%: **30 points** | ≥20%: **15 points**
- Positive operating margin: **10 points**
- Q-over-Q acceleration (>20% growth): **20 points**

**Total possible:** 100 points | **Threshold:** 35 points

**Metrics Used:**
- revenueGrowth (from FMP financial-growth)
- earningsGrowth (from FMP financial-growth)
- operatingMargin (from FMP ratios-ttm)
- revenueGrowthQ (current quarter from FMP income-statement)
- revenueGrowthPrevQ (previous quarter from FMP income-statement)

---

### 3. INFLECTION
**Current Market Cap:** $500M minimum
**Recommended:** Keep $500M (catch early momentum)

**Scoring Criteria:**
- Revenue acceleration >10pp Q-over-Q: **35 points** | >5pp: **20 points**
- Margin expansion >5pp: **30 points** | >2pp: **15 points**
- FCF growing >50%: **20 points**
- PEG < 3.0: **15 points**

**Total possible:** 100 points | **Threshold:** 35 points

**Metrics Used:**
- revenueGrowthQ (current quarter)
- revenueGrowthPrevQ (previous quarter)
- operatingMargin (current)
- operatingMarginPrev (previous quarter)
- freeCashflow (from FMP cash-flow-statement)
- fcfGrowth (calculated YoY)
- pegRatio (from FMP ratios-ttm)

---

### 4. CASH MACHINE
**Current Market Cap:** $500M minimum
**Recommended:** $2B minimum (8% FCF yield at $500M = distress signal)

**Scoring Criteria:**
- FCF yield ≥10%: **45 points** | ≥8%: **35 points** | ≥5%: **15 points**
- FCF growth >20% (faster than revenue): **25 points** | >10%: **12 points**
- Debt/Equity < 0.5: **15 points**
- ROIC > 20%: **15 points**

**Total possible:** 90 points | **Threshold:** 35 points

**Metrics Used:**
- fcfYield (calculated: freeCashflow / marketCap)
- fcfGrowth (YoY growth)
- revenueGrowth (for comparison)
- debtToEquity (from FMP ratios-ttm)
- roic (from FMP key-metrics-ttm)

---

### 5. QARP (Quality at Reasonable Price)
**Current Market Cap:** $500M minimum
**Recommended:** $2B minimum, $10B+ preferred (quality verification)

**Scoring Criteria:**
- ROIC >15%: **25 points**
- ROE >20%: **25 points**
- P/E 15-25 (reasonable): **20 points** | P/E 25-30: **10 points**
- Earnings growth >10%: **20 points** | >0%: **10 points**
- Debt/Equity < 0.5: **10 points**

**Total possible:** 100 points | **Threshold:** 35 points

**Metrics Used:**
- roic (from FMP key-metrics-ttm)
- roe (from FMP ratios-ttm)
- peRatio (from FMP ratios-ttm)
- earningsGrowth (from FMP financial-growth)
- debtToEquity (from FMP ratios-ttm)

---

### 6. TURNAROUND
**Current Market Cap:** $500M minimum
**Recommended:** $500M-$2B (distress acceptable, upside compensates)

**Scoring Criteria:**
- Debt/Equity 0-1.0 (manageable): **15 points**
- Margin expansion >3pp: **30 points** | >1pp: **15 points**
- Revenue stabilizing (0-10% growth): **20 points** | >10%: **25 points**
- FCF turning positive + >20% growth: **25 points**
- P/E < 20 (undervalued): **15 points**

**Total possible:** 100 points | **Threshold:** 35 points

**Metrics Used:**
- debtToEquity (from FMP ratios-ttm)
- operatingMargin (current)
- operatingMarginPrev (previous quarter)
- revenueGrowth (from FMP financial-growth)
- freeCashflow (from FMP cash-flow-statement)
- fcfGrowth (YoY)
- peRatio (from FMP ratios-ttm)

---

## SHORT PATHWAYS (Must Pass ALL 3 Criteria)

### CRITERIA 1: Extreme Valuation (≥20 points required)
**Scoring:**
- P/E > 1.5x sector high: **20 points** | > sector high: **10 points**
- PEG > 4.0: **20 points** | > 3.0: **10 points**
- EV/EBITDA > 40: **10 points**

**Metrics Used:**
- peRatio (from FMP ratios-ttm)
- pegRatio (from FMP ratios-ttm)
- evToEbitda (from FMP key-metrics-ttm)
- Sector-specific thresholds from sector-config.js

---

### CRITERIA 2: Deteriorating Fundamentals (≥20 points required)
**Scoring:**
- Revenue deceleration >10pp: **25 points** | >5pp: **12 points**
- Margin compression >5pp: **25 points** | >2pp: **12 points**
- FCF declining <-20%: **20 points**
- Negative earnings growth + P/E >30: **20 points**

**Metrics Used:**
- revenueGrowthQ (current quarter)
- revenueGrowthPrevQ (previous quarter)
- operatingMargin (current)
- operatingMarginPrev (previous quarter)
- fcfGrowth (YoY)
- earningsGrowth (from FMP financial-growth)
- peRatio (from FMP ratios-ttm)

---

### CRITERIA 3: Short Safety Check (MUST PASS)
**Requirements:**
- Market cap ≥ $2B (currently)
- Dollar volume ≥ $20M daily
- Short float ≤ 20% (meme stock filter)

**Additional checks at execution time (in short-manager.js):**
- IV (implied volatility) < 80%
- ETB (easy to borrow) = true

**Metrics Used:**
- marketCap (from FMP profile)
- dollarVolume (calculated: price × average_volume)
- shortFloat (from FMP key-metrics-ttm)

---

## ALL METRICS EXTRACTED FROM FMP

### From `/stable/ratios-ttm`:
- peRatio
- pegRatio
- priceToBook
- priceToSales
- operatingMargin
- profitMargin (netProfitMarginTTM)
- roe (returnOnEquityTTM)
- debtToEquity (debtEquityRatioTTM)

### From `/stable/key-metrics-ttm`:
- evToEbitda (evToEBITDATTM)
- roic (returnOnInvestedCapitalTTM)
- freeCashflowPerShare
- shortFloat (from key metrics or profile)

### From `/stable/financial-growth?period=quarter`:
- revenueGrowth (YoY)
- earningsGrowth (YoY)

### From `/stable/income-statement?period=quarter`:
- revenueGrowthQ (current quarter YoY)
- revenueGrowthPrevQ (previous quarter YoY)
- operatingMarginPrev (previous quarter)

### From `/stable/cash-flow-statement?period=quarter`:
- freeCashflow
- fcfGrowth (calculated YoY)

### From Tradier API:
- price (last or close)
- average_volume
- dollarVolume (calculated: price × average_volume)

### Calculated Metrics:
- fcfYield = freeCashflow / marketCap
- dollarVolume = price × average_volume

---

## SECTOR-ADJUSTED SCORING

All pathways use sector-specific thresholds from `src/sector-config.js`:

**Example - Technology:**
- P/E ideal: 25, high: 40
- PEG ideal: 1.5, high: 2.5
- Debt/Equity max: 0.5

**Example - Financials:**
- P/E ideal: 12, high: 18
- PEG ideal: 1.2, high: 2.0
- Debt/Equity max: 2.0 (higher acceptable)

**Example - Utilities:**
- P/E ideal: 15, high: 20
- PEG ideal: 1.5, high: 2.0
- Debt/Equity max: 1.5

**Key Principle:** Tech deep value ≠ Finance deep value. A P/E of 20 is good for Tech (< 25 ideal), acceptable for Utilities (< 20 high), but poor for Financials (> 18 high).

---

## OPUS RECOMMENDATIONS (Phase 1 - Immediate)

### 1. Pathway-Specific Market Caps
- **Deep Value:** $2B minimum (quality value vs value traps)
- **Cash Machine:** $2B minimum (8% FCF yield at $2B = opportunity, at $500M = distress)
- **QARP:** $2B minimum, $10B+ preferred (quality verification)
- **High Growth:** Keep $500M (growth emerges small)
- **Inflection:** Keep $500M (catch early momentum)
- **Turnaround:** $500M-$2B (distress acceptable)
- **Shorts:** Keep $2B, consider $3B

### 2. Lower Short Threshold
- Change from 60 → 50 points
- Current 60 too restrictive for 10-20 shorts/week target

### 3. Add Insider Trading Signals
- Net buying >$500K: **+20 points**
- Net buying >$100K: **+10 points**
- Net selling >$2M: **-15 points**

### 4. Short Interest Filters
- DISQUALIFY if >20% (squeeze risk)
- BONUS if 5-10%: **+10 points**
- AVOID if >30% (automatic rejection)

---

## IMPLEMENTATION NOTES

1. **Rate Limiting:** 500ms delay between FMP calls (stays under 300 calls/min)
2. **Progress Logging:** Every 50 stocks during screening
3. **Debug Logging:** First 10 stocks show detailed pathway scores
4. **ETF Filtering:** Automatically filtered when fundamentals return null
5. **Sector Normalization:** All sectors normalized via `normalizeSectorName()`
6. **FMP Endpoint:** Always use `/stable` (not `/api/v3`)
7. **No Caching:** FMP is fast enough without cache layer

---

## EXPECTED OUTPUT

**Target per week:**
- 15-30 long candidates (across all 6 pathways)
- 10-20 short candidates

**Current results (before optimization):**
- 276 longs (too many - thresholds may be too lenient)
- 56 shorts (good range)

**After implementing Opus recommendations:**
- Expected: 20-30 longs (higher quality with $2B+ caps)
- Expected: 15-25 shorts (lower threshold increases candidates)
