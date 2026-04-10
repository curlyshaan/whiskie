# Free Tier Implementation Plan

## Current Status (2026-04-10)

**Working:**
- ✅ FMP Free: Profile + Insider Trading (stable API, database schema fixed)
- ✅ Tradier: Real-time quotes (already integrated)
- ✅ Database: All tables initialized, insider trading tested with 12 records

**Blocked:**
- ❌ Yahoo Finance: Rate limited (429 errors) - IP-based blocking, no user tracking
- ⏳ Need to wait for rate limit window to expire (unknown duration, could be hours to days)

## Implementation Strategy

### Phase 1: Use What Works (Immediate)

**Data Sources:**
1. **FMP Free** - Company profile + insider trading
2. **Tradier** - Real-time quotes, market data
3. **Cached data** - 90-day cache for all fundamental data

**Limitations:**
- No financial statements (income, balance, cash flow)
- No key metrics (P/E, margins, ROE) from FMP
- No institutional ownership
- No analyst estimates
- No earnings data

**Workaround:**
- Use existing cached data if available
- Run screening with limited data set
- Focus on insider trading signals (only free smart money data)

### Phase 2: Add Yahoo Finance (When Rate Limits Clear)

**Implementation:**
1. Use `yahoo-finance2` npm package (already installed)
2. Add 3-5 second delays between requests
3. Implement exponential backoff on 429 errors
4. Cache aggressively (30-90 days)
5. Run screening during off-peak hours

**Yahoo Finance Data:**
- Fundamentals: P/E, PEG, margins, ROE, debt/equity
- Financials: Income statements, balance sheets, cash flow
- Analyst data: Price targets, recommendations
- Earnings: Historical + estimates

### Phase 3: Hybrid Integration

**Data Priority:**
1. **Profile** → FMP Free (fast, reliable)
2. **Quotes** → Tradier (real-time, already working)
3. **Fundamentals** → Yahoo Finance (when available) → Cache
4. **Insider Trading** → FMP Free (only source)
5. **Institutional** → Skip for now (requires paid plan)
6. **Analyst Data** → Yahoo Finance (when available) → Cache

## Code Changes Needed

### 1. Update `src/fmp-cache.js`
- Add fallback to Yahoo Finance when FMP returns 402
- Implement hybrid data fetching strategy
- Handle rate limiting gracefully

### 2. Update `src/opus-screener.js`
- Use FMP profile + Tradier quotes + cached fundamentals
- Skip institutional ownership (not available free)
- Focus on insider trading signals
- Reduce data requirements for screening

### 3. Create `src/yahoo-finance-wrapper.js`
- Wrapper around yahoo-finance2 with rate limiting
- 3-5 second delays between requests
- Exponential backoff on 429 errors
- Aggressive caching (30-90 days)

### 4. Update `src/advanced-fmp-screener.js`
- Mark institutional/analyst endpoints as "paid only"
- Add fallback logic to Yahoo Finance
- Handle missing data gracefully

## Testing Plan

**When Yahoo rate limits clear:**
1. Test with 5 stocks first (NOW, CBP, AAPL, MSFT, GOOGL)
2. Verify data quality matches expectations
3. Check rate limiting behavior
4. Expand to 20 stocks
5. Run full screening (100+ stocks)

**Monitoring:**
- Track Yahoo Finance request count
- Monitor 429 error frequency
- Measure cache hit rate
- Validate data completeness

## Decision Points

**After 2-3 months of testing:**

**If free tier works well:**
- Continue with free sources
- Save $29-49/month
- Accept limited institutional/analyst data

**If free tier is unreliable:**
- Subscribe to Polygon.io ($29/month) - best reliability
- OR Alpha Vantage Premium ($49.99/month) - best value
- OR FMP Professional ($29/month) - original plan

## Risk Mitigation

**Yahoo Finance risks:**
- Rate limiting unpredictable
- Unofficial API can break
- No SLA or support

**Mitigation:**
- Aggressive caching (30-90 days)
- Run screening during off-peak hours (Sunday 9pm)
- Have Polygon.io as backup plan
- Monitor reliability metrics

**FMP Free risks:**
- Only 2 endpoints work
- 750 calls/day limit (3 keys)
- Could change terms

**Mitigation:**
- Use only for profile + insider trading
- Cache for 30+ days
- Minimize API calls

## Next Steps

1. ✅ FMP stable API migration (DONE)
2. ✅ Database schema fixes (DONE)
3. ⏳ Wait for Yahoo rate limits to clear
4. ⏳ Implement Yahoo Finance wrapper with rate limiting
5. ⏳ Update opus-screener.js for hybrid approach
6. ⏳ Test with small batch of stocks
7. ⏳ Run full screening
8. ⏳ Monitor for 2-3 months
9. ⏳ Decide on paid subscription if needed

## Current Blockers

- Yahoo Finance rate limited (IP-based, no ETA on clear)
- Cannot test Yahoo integration until rate limits expire
- System can run with FMP free + Tradier + cache in the meantime
