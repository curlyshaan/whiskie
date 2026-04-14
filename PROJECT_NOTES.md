# Whiskie Project Notes

**Last Updated:** 2026-04-14

## Current System State

### Quick Reference
- **Whiskie URL:** https://whiskie-production.up.railway.app
- **Database URL:** `postgresql://postgres:FfUODiEUFXZPGEeJifsKToEvxnavlkGz@hopper.proxy.rlwy.net:44407/railway`
- **FMP Plan:** Paid plan with 300 calls/minute limit (unlimited daily calls)
- **FMP Endpoint:** ALWAYS use `/stable` endpoint (e.g., `https://financialmodelingprep.com/stable/profile`)
- **Claude API Access:** Via Quatarly (https://github.com/himanshu91081/Quatarly-setup)
- **Claude Model:** `claude-opus-4-6-thinking` (OPUS with extended thinking)
  - Other models available: `claude-sonnet-4-6`, `claude-haiku-4-5`
  - See Quatarly repo for full model list

### Architecture
- **AI Model:** Claude Opus 4.6 with extended thinking (20k token budget for profiles, 50k for analysis)
- **Database:** PostgreSQL on Railway
- **APIs:** 
  - FMP (fundamentals) - `/stable` endpoint ONLY, 300 calls/minute
  - Tradier (trading/ETB)
  - Tavily (news)
  - Yahoo Finance (short interest)
- **Deployment:** Railway (auto-deploy from main branch)
- **Mode:** Paper trading only

### Stock Universe
- **Source:** FMP API via `scripts/populate-universe-v2.js`
- **Criteria:** Top 7 stocks per industry, $7B+ market cap, US exchanges only
- **Size:** 379 stocks (11 sectors, 105 industries)
- **Update:** Manual via script when needed

### Automated Weekly Workflow
1. **Saturday 10am ET** - Stock Universe Population (automated via cron)
   - Runs `scripts/populate-universe-v2.js`
   - Fetches stocks from FMP company-screener API
   - Criteria: Top 7 stocks per industry, $7B+ market cap, US exchanges only
   - Updates `stock_universe` table (~379 stocks)

2. **Saturday 3pm ET** - Fundamental Screening (automated via cron)
   - Analyzes all 379 stocks from stock_universe
   - 6 long pathways: deepValue, highGrowth, inflection, cashMachine, qarp, turnaround
   - 3 short pathways: overvalued, deteriorating, overextended
   - Thresholds: LONG ≥38, SHORT ≥50
   - Output: `saturday_watchlist` table (~220 longs, ~40 shorts expected)

3. **After Screening Completes** - Stock Profile Building (automated trigger)
   - Targets stocks in saturday_watchlist only
   - Profile staleness logic:
     - No profile exists → Full build (20k tokens, ~3-7 min per stock)
     - Profile exists + <12 days old → Skip (profile is fresh)
     - Profile exists + ≥12 days old → Incremental update (5k tokens, catalysts/risks only)
   - Endpoint: `/api/trigger-profile-build-watchlist`
   - Delay: 3 seconds between profiles to avoid rate limiting

4. **Sunday 9pm ET** - Weekly Portfolio Review (automated via cron)
   - Reviews current holdings performance
   - Analyzes top candidates from saturday_watchlist
   - Provides strategic recommendations

5. **Daily Analysis** (10am, 2pm ET Mon-Fri) - 4-phase Opus analysis
   - Phase 1: Pre-ranking (screens 15-20 longs + 15-20 shorts)
   - Phase 2: Long analysis (50k token thinking budget)
   - Phase 3: Short analysis (50k token thinking budget)
   - Phase 4: Portfolio construction (20k token thinking budget, 0-3 per sub-sector)

6. **Trade Approval** - Human-in-the-loop queue
   - Trades parsed from Phase 4 output
   - Email notification sent
   - User approves/rejects via `/approvals` dashboard
   - Approved trades executed every 5 minutes (9am-4pm)

### Rate Limiting Strategy
- **FMP API:** 300 calls/minute limit
  - Screening: Batch size 5, 10-second delay between batches (240 calls/min)
  - Profile building: 3-second delay between stocks
  - Individual calls: 400ms delay enforced in `fmp.js`

### Known Issues
1. **key_metrics_to_watch JSON parsing error** - Opus generates malformed JSON
   - Impact: Field is NULL in profiles, but other fields populate correctly
   - Fix: Add JSON validation/sanitization before saving (deferred)

2. **Duplicate profile building** - Multiple triggers can run simultaneously
   - Mitigation: Use `/api/trigger-profile-build-watchlist` (checks for existing profiles)
   - TODO: Add mutex/lock to prevent concurrent profile building processes

3. **Profile staleness threshold** - 12 days
   - Profiles <12 days old are skipped (considered fresh)
   - Profiles ≥12 days old get incremental updates (5k tokens, catalysts/risks only)

### API Endpoints (Active)
- `/api/trigger-saturday-screening` - Run fundamental screener
- `/api/trigger-profile-build-watchlist` - Build/update profiles for saturday_watchlist stocks
- `/api/trigger-daily-analysis` - Run 4-phase Opus analysis
- `/api/trigger-weekly-portfolio-review` - Weekly portfolio review
- `/api/trigger-premarket-scan` - Pre-market gap scan (9am daily)
- `/api/update-etb-status` - Update easy-to-borrow status for shorts (Tradier)
- `/api/trigger-eod-summary` - End-of-day summary (4:30pm daily)

### Cron Schedule (America/New_York)
| Time | Frequency | Job |
|------|-----------|-----|
| 9:00 AM | Mon-Fri | Pre-market gap scan |
| 10:00 AM | Mon-Fri | Daily analysis (4-phase) |
| 10:00 AM | Saturday | Stock universe population (FMP API) |
| 2:00 PM | Mon-Fri | Afternoon analysis |
| 3:00 PM | Saturday | Fundamental screening → saturday_watchlist |
| 3:00 PM | Friday | Earnings calendar refresh |
| 4:30 PM | Mon-Fri | End-of-day summary |
| 9:00 PM | Sunday | Weekly portfolio review |
| After screening | Saturday | Profile building (auto-triggered) |
| Every 5 min | 9am-4pm Mon-Fri | Process approved trades |
| Hourly | Always | Expire old trade approvals (24h) |

### Market Regime Allocations
- **BULL:** 65% long, 20% short, 15% cash
- **Transitional:** 45% long, 25% short, 30% cash
- **BEAR:** 30% long, 40% short, 30% cash

### Risk Limits
- Max position size: 12% (10% for shorts)
- Max sector allocation: 30%
- Max total short exposure: 20%
- Min cash reserve: 10%
- Max portfolio drawdown: 20%
- Max daily trades: 7
- Sub-sector constraint: 0-3 stocks per sub-sector (combined longs + shorts)

## Recent Changes (April 2026)

### Completed
- ✅ Relaxed screening thresholds (LONG: 40→38, SHORT: 55→50)
- ✅ Added tiered highGrowth scoring (30%+=40pts, 20-30%=25pts, 15-20%=15pts)
- ✅ Fixed FMP rate limiting (batch size 20→5, 10-second delays)
- ✅ Updated market regime allocations (bull market shorts: 10%→20%)
- ✅ Repopulated stock_universe from FMP API (523→379 stocks)
- ✅ Created `/api/trigger-profile-build-watchlist` endpoint
- ✅ Removed unused endpoints (clear-stock-universe)

### In Progress
- Profile building for 379 stocks in stock_universe (215/379 complete as of 2026-04-14)

### Deferred
- Fix key_metrics_to_watch JSON parsing error
- Update all 379 profiles with corrected key_metrics

## Development Workflow

### Fresh Start Sequence
1. Clean databases: `DELETE FROM trade_approvals, positions, trades, stock_profiles, saturday_watchlist, watchlist, stock_universe`
2. Populate stock universe: `node scripts/populate-universe-v2.js` (or wait for Saturday 10am cron)
3. Run Saturday screening: `curl -X POST https://whiskie-production.up.railway.app/api/trigger-saturday-screening` (or wait for Saturday 3pm cron)
4. Build profiles: `curl -X POST https://whiskie-production.up.railway.app/api/trigger-profile-build-watchlist` (or auto-triggered after screening)
5. Run weekly review: `curl -X POST https://whiskie-production.up.railway.app/api/trigger-weekly-portfolio-review` (or wait for Sunday 9pm cron)

### Testing Locally
```bash
# Test screening
node -e "import('./src/fundamental-screener.js').then(async (m) => { await m.default.runWeeklyScreen('full'); process.exit(0); })"

# Test profile building
node -e "import('./src/stock-profiles.js').then(async (m) => { await m.buildStockProfile('AAPL'); process.exit(0); })"

# Test 4-phase analysis
node test/test-4phase.js
```

### Database Queries
```sql
-- Check screening results
SELECT intent, pathway, COUNT(*) FROM saturday_watchlist WHERE status = 'active' GROUP BY intent, pathway;

-- Check profile status
SELECT COUNT(*) FROM stock_profiles;

-- Check stock universe
SELECT COUNT(*) FROM stock_universe WHERE status = 'active';

-- Sample profile
SELECT symbol, business_model, moats, risks, catalysts FROM stock_profiles WHERE symbol = 'AAPL';
```

## Code Quality Notes

### Strengths
- Comprehensive error handling in API endpoints
- Rate limiting properly implemented across FMP calls
- Sector-adjusted scoring in fundamental screener
- Incremental profile updates save API calls
- Extended thinking for deep analysis

### Areas for Improvement
1. **JSON Parsing** - Add validation for Opus-generated JSON fields
2. **Duplicate Prevention** - Ensure only one profile building process runs at a time
3. **Error Recovery** - Better handling of partial failures in batch operations
4. **Monitoring** - Add metrics for API usage, success rates, profile quality

### Technical Debt
- Multiple deprecated documentation files (see below)
- Some endpoints have mixed responsibilities (premarket-scan was confused with ETB update)
- Profile building logic split between buildStockProfile() and updateStockProfile()

## Documentation Cleanup Needed

### Files to Keep (Core Documentation)
- `CLAUDE.md` - Primary guidance for Claude Code (355 lines)
- `README.md` - User-facing setup guide (51 lines)
- `PROJECT_NOTES.md` - This file (current state, decisions, workflow)

### Files to Archive/Delete (Redundant/Outdated)
- `STOCK_UNIVERSE_AUDIT_APRIL_2026.md` (721 lines) - One-time audit, archive
- `SYSTEM_DOCUMENTATION.md` (455 lines) - Redundant with CLAUDE.md
- `CLAUDE_NOTES.md` (389 lines) - Merge into CLAUDE.md or delete
- `PATHWAY_EXIT_STRATEGIES.md` (362 lines) - Implementation complete, archive
- `WORKFLOW.md` (326 lines) - Redundant with CLAUDE.md
- `docs/fundamental_screener_criteria.md` (326 lines) - Redundant with code comments
- `OPUS_DESIGN_REVIEW.md` (310 lines) - Historical, archive
- `AI_REVIEW_SUMMARY.md` (306 lines) - Historical, archive
- `current_strategy.md` (289 lines) - Merge into PROJECT_NOTES.md
- `FINAL_IMPLEMENTATION_REPORT.md` (281 lines) - Historical, archive
- `docs/BETA_PLAY_STRATEGY.md` (256 lines) - Historical, archive
- `DOCS.md` (256 lines) - Redundant with CLAUDE.md
- `IMPLEMENTATION_COMPLETE.md` (249 lines) - Historical, archive
- `opus-screening-recommendations-v2.md` (214 lines) - Implemented, archive
- `opus-screening-recommendations.md` (196 lines) - Superseded by v2, delete
- `IMPLEMENTATION_STATUS.md` (185 lines) - Outdated, delete
- `STRATEGIC_IMPROVEMENTS.md` (162 lines) - Merge into PROJECT_NOTES.md
- `opus-stock-profile-recommendations.md` (161 lines) - Implemented, archive
- `design-question.md` (161 lines) - Historical, delete
- `INTEGRATION_SUMMARY.md` (121 lines) - Historical, delete
- `PATHWAY_EXIT_STRATEGY_ANALYSIS.md` (100 lines) - Historical, delete
- `IMPLEMENTATION_SUMMARY.md` (72 lines) - Historical, delete
- `CHANGELOG.md` (48 lines) - Use git log instead, delete
- `docs/WHISKIE_INVESTMENT_STRATEGY.md` (335 lines) - Keep for reference

**Recommendation:** Archive historical docs to `docs/archive/`, keep only CLAUDE.md, README.md, PROJECT_NOTES.md, and WHISKIE_INVESTMENT_STRATEGY.md active.
