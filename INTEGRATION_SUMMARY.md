# Whiskie System Integration Summary

## Three Main Systems

### 1. Saturday Screening (3:00 PM ET)
**File**: `src/index.js` (line ~165)
**What it does**:
- Runs `fundamental-screener.js` - screens all 407 stocks for value candidates
- Runs `opus-screener.js` - Opus analyzes stocks for quality/overvalued candidates
- Clears expired FMP cache
- Runs weekly portfolio review

**Data flow**:
- `fundamental-screener.js` → uses `fmpCache.getFundamentals()` → populates `value_watchlist` ✅ (now uses TTM data)
- `opus-screener.js` → uses `fmpCache.getFundamentals()` → populates `quality_watchlist` and `overvalued_watchlist` ✅ (updated to use FMP)

**Status**: ✅ Updated to use FMP TTM data

---

### 2. Biweekly Deep Research (Saturday 10:00 AM, even weeks only)
**File**: `src/stock-profiles.js`
**What it does**:
- Builds comprehensive profiles for watchlist stocks
- Uses Opus with 20k token thinking budget
- Stores: business_model, moats, competitive_advantages, fundamentals, risks, catalysts
- Saves to `stock_profiles` table

**Data flow**:
- Fetches `fmp.getFundamentals()` ✅ (fixed - was calling non-existent `getCompanyFundamentals()`)
- Fetches Yahoo Finance historical data
- Fetches Tavily news
- Opus generates comprehensive profile
- Saves to database

**Status**: ✅ Fixed to use correct FMP method

---

### 3. Daily Analysis (10:00 AM, 2:00 PM Mon-Fri)
**File**: `src/index.js` → `runDailyAnalysis()`
**What it does**:
- 4-phase Opus analysis system
- Phase 1: Pre-ranking (15-20 longs + 15-20 shorts from watchlists)
- Phase 2: Deep long analysis (50k token thinking)
- Phase 3: Deep short analysis (50k token thinking)
- Phase 4: Portfolio construction (0-3 per sub-sector)

**Data flow**:
- Reads from watchlists: `value_watchlist`, `quality_watchlist`, `overvalued_watchlist`
- **ISSUE**: Does NOT currently reference `stock_profiles` for context
- **ISSUE**: Phase 2/3 analysis may not be using FMP deep analysis bundle

**Status**: ⚠️ Needs integration with stock profiles

---

## Integration Issues Found

### ✅ FIXED:
1. `stock-profiles.js:117` - Was calling `fmp.getCompanyFundamentals()` (doesn't exist)
   - Fixed to use `fmp.getFundamentals()`

2. `opus-screener.js:53` - Was using `yahooPython.getFundamentals()`
   - Fixed to use `fmpCache.getFundamentals()` (which now returns TTM data)

3. `fundamental-screener.js` - Already using `fmpCache.getFundamentals()`
   - No changes needed, automatically gets TTM data now

### ⚠️ NEEDS WORK:
1. **Daily analysis doesn't use stock profiles**
   - Stock profiles are built biweekly but not referenced during daily analysis
   - Phase 2/3 should check if profile exists and include it in Opus prompt
   - This would reduce redundant research and improve analysis quality

2. **Phase 2/3 analysis data source unclear**
   - Need to verify what data is passed to Opus in Phase 2/3
   - Should use `fmp.getDeepAnalysisBundle()` for comprehensive data

---

## Recommended Next Steps

1. **Update daily analysis to reference stock profiles**:
   - In Phase 2/3, check if stock has profile in `stock_profiles` table
   - If profile exists and fresh (<14 days), include in Opus prompt
   - If profile stale (>14 days), flag for refresh

2. **Verify Phase 2/3 data source**:
   - Check what data is currently passed to Opus
   - Update to use `fmp.getDeepAnalysisBundle()` if not already

3. **Test end-to-end flow**:
   - Run Saturday screening manually
   - Verify watchlists populated correctly
   - Run daily analysis manually
   - Verify it uses watchlist + profiles

---

## Data Architecture Summary

**FMP Endpoints Now Used**:
- `/stable/ratios-ttm` - Current P/E, PEG, margins (TTM)
- `/stable/key-metrics-ttm` - ROIC, Graham number, EV ratios (TTM)
- `/stable/financial-growth?period=quarter` - True YoY growth rates
- `/stable/income-statement?period=quarter` - Quarterly financials
- `/stable/technical-indicators/ema` - 50/200 EMA
- `/stable/technical-indicators/rsi` - RSI(14)
- `/stable/earnings-calendar` - Upcoming earnings dates

**Cache Strategy**:
- 1-day cache: TTM ratios, technical indicators (price-dependent)
- 45-day cache: Quarterly statements (updates at earnings)
- 90-day cache: Annual context data

**Methods Available**:
- `fmp.getFundamentals(symbol)` - Basic screening data (TTM + quarterly)
- `fmp.getDeepAnalysisBundle(symbol)` - Comprehensive 7-endpoint bundle for deep analysis
- `fmp.getTechnicalIndicators(symbol)` - 200/50 EMA, RSI with signals
- `fmp.getEarningsCalendar()` - Upcoming earnings dates
