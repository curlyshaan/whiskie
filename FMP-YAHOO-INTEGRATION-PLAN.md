# FMP + Yahoo Finance Integration Plan

## Current Situation

**FMP API Status:**
- ✅ **FREE (2 endpoints):** Profile, Insider Trading
- 💰 **PAID (13 endpoints):** All financials, metrics, institutional ownership, analyst estimates, price targets
- 🔄 **API Migration:** Updated from deprecated `/api/v3/` to `/stable/`

**Yahoo Finance Status:**
- ⚠️ **Rate Limited:** Currently hitting "Too Many Requests" errors
- ✅ **Free & Unlimited:** No API key required (when not rate limited)
- 📦 **Library Available:** `yahoo-finance2` npm package already installed

## Recommended Strategy: Hybrid Approach

### Phase 1: Use What Works Now (Immediate)
1. **FMP Free Tier:**
   - Profile data (company info, sector, industry, market cap)
   - Insider Trading (smart money signal)

2. **Existing Tradier Integration:**
   - Real-time quotes (already working)
   - Market data

3. **Cached Data:**
   - Use 90-day cache aggressively
   - Reduce API calls to minimum

### Phase 2: Add Yahoo Finance (When Rate Limits Clear)
1. **Fundamental Data:**
   - Income statements, balance sheets, cash flow
   - Key metrics (P/E, PEG, margins, ROE)
   - Financial ratios

2. **Analyst Data:**
   - Price targets (mean, high, low)
   - Recommendations
   - Number of analysts

3. **Earnings Data:**
   - Historical earnings
   - Earnings estimates
   - Quarterly/annual trends

### Phase 3: Optimize Data Flow
1. **Smart Caching:**
   - Cache Yahoo Finance data for 30-90 days
   - Only refresh when needed for screening
   - Batch requests with delays

2. **Rate Limit Management:**
   - Add 2-3 second delays between Yahoo requests
   - Implement exponential backoff on 429 errors
   - Use yahoo-finance2 library's built-in retry logic

3. **Fallback Strategy:**
   - Try Yahoo Finance first
   - Fall back to cached data if rate limited
   - Use FMP free endpoints as supplement

## Implementation Priority

### Immediate (Today):
1. ✅ Update FMP to stable API (DONE)
2. ✅ Document which endpoints work (DONE)
3. ⏳ Fix insider trading database schema (securities_transacted decimal issue)
4. ⏳ Update opus-screener.js to use hybrid data sources

### Next (This Week):
1. Implement Yahoo Finance wrapper with rate limiting
2. Add retry logic and exponential backoff
3. Update fmp-cache.js to handle Yahoo Finance data
4. Test with small batch of stocks

### Future (Optional):
1. Subscribe to FMP Professional ($29/month) if:
   - Strategy proves profitable
   - Need institutional ownership data
   - Want real-time analyst estimates
2. Alternative: Build SEC EDGAR scraper for free institutional data

## Data Source Mapping

| Data Type | Primary Source | Fallback | Notes |
|-----------|---------------|----------|-------|
| Profile | FMP Free | Yahoo | Company info, sector |
| Quote | Tradier | Yahoo | Real-time prices |
| Financials | Yahoo | Cache | Income, balance, cash flow |
| Metrics | Yahoo | Cache | P/E, margins, ROE |
| Insider Trading | FMP Free | None | Only free smart money signal |
| Institutional | PAID/Skip | None | Not critical for MVP |
| Analyst Estimates | Yahoo | Cache | Price targets, recommendations |
| Earnings | Yahoo | Cache | Historical + estimates |

## Risk Mitigation

**Yahoo Finance Rate Limits:**
- Implement request throttling (2-3 sec delays)
- Use exponential backoff on errors
- Cache aggressively (30-90 days)
- Run screening during off-peak hours (Sunday 9pm)

**FMP Free Tier Limits:**
- 250 calls/day per key (750 total with 3 keys)
- Only use for profile + insider trading
- Cache for 30+ days

**Data Quality:**
- Yahoo Finance is unofficial but widely used
- FMP free tier is official but limited
- Validate data quality during testing

## Next Steps

1. Wait for Yahoo Finance rate limits to clear (24 hours)
2. Fix insider trading database schema
3. Implement Yahoo Finance wrapper with proper rate limiting
4. Update opus-screener.js to use hybrid approach
5. Test with 10-20 stocks before full screening
6. Monitor data quality and API reliability

## Decision Point: FMP Subscription

**Wait 2-3 months before deciding:**
- Test if free data sources work reliably
- Validate that Opus screening improves returns
- Determine if institutional ownership data is critical
- If yes to all above → subscribe to FMP Professional ($29/month)
