# Whiskie Trading Bot - Complete System Documentation

**Last Updated**: 2026-04-12  
**Version**: 2.0 (Post-Opus Review)

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Safety Systems](#safety-systems)
4. [Screening Logic](#screening-logic)
5. [Weekly Schedule](#weekly-schedule)
6. [Database Schema](#database-schema)
7. [API Endpoints](#api-endpoints)
8. [Configuration](#configuration)
9. [Deployment](#deployment)

---

## System Overview

Whiskie is an autonomous AI portfolio manager that combines algorithmic screening with deep Claude Opus analysis to identify long and short equity opportunities.

**Key Features**:
- 6 independent long pathways (Deep Value, High Growth, Inflection, Cash Machine, QARP, Turnaround)
- Strict short safety checks (15% short float, days-to-cover, IV percentile, squeeze history)
- Circuit breaker system (5 trades/day, 5% weekly loss limit)
- Earnings guard (blocks trades 3 days before earnings)
- Trade approval queue (human-in-the-loop)
- Stock profile system (biweekly deep research, daily incremental updates)
- 4-phase Opus analysis (Pre-ranking → Long → Short → Portfolio Construction)

---

## Architecture

### Data Flow

```
Saturday 3pm: Fundamental Screening (407 stocks)
    ↓
Quality Watchlist (15-20 longs) + Overvalued Watchlist (10-15 shorts)
    ↓
Daily 10am/2pm: 4-Phase Opus Analysis
    ↓
Trade Recommendations → Approval Queue
    ↓
User Approves → Trade Executor (every 5 min)
    ↓
Circuit Breaker + Earnings Guard + Short Safety Checks
    ↓
Execution via Tradier (OCO orders with stop loss/take profit)
```

### Key Modules

**Screening**:
- `fundamental-screener.js` - Combined long + short screening (6 pathways)
- `stock-profiles.js` - Deep research system (20k tokens, biweekly refresh)
- `fmp-cache.js` - Tiered caching (TTM 1-day, Quarterly 45-day, Annual 90-day)

**Safety**:
- `circuit-breaker.js` - Max trades/day, max weekly loss
- `earnings-guard.js` - Blocks trades 3 days before earnings
- `short-manager.js` - Enhanced meme stock protection
- `data-validator.js` - FMP data validation

**Analysis**:
- `opus-screener.js` - 4-phase analysis orchestration
- `pre-ranking.js` - Phase 1 candidate selection
- `claude.js` - Extended thinking API wrapper

**Execution**:
- `trade-executor.js` - Processes approved trades
- `trade-approval.js` - Approval queue management
- `order-manager.js` - OCO order tracking

---

## Safety Systems

### 1. Circuit Breaker

**Thresholds**:
- Max 5 trades per day
- Max 5% weekly loss

**Behavior**:
- Trips automatically when limits exceeded
- Sends email alert
- Blocks all trade execution
- Requires manual reset

**Files**: `src/circuit-breaker.js`, integrated in `trade-executor.js`

### 2. Earnings Guard

**Rules**:
- Blocks trades 3 days before earnings
- Checks `earnings_calendar` table
- Non-blocking if table missing (graceful degradation)

**Files**: `src/earnings-guard.js`, integrated in `trade-executor.js`

### 3. Short Safety Checks

**Screening Time** (Saturday 3pm):
- Short float <15% (reduced from 20%)
- Market cap >$2B
- Volume >$20M/day

**Execution Time** (every 5 min):
- Days to cover <5 (hard block), ≥4 triggers 8% position limit
- IV <80% absolute
- IV percentile <90% (relative to 1-year history)
- Borrow fee <10% annually (if available)
- No recent squeeze (>50% move in past 6 months)
- ETB (easy-to-borrow) verification

**Files**: `src/short-manager.js`, `src/fundamental-screener.js`

### 4. Position Monitoring

**Decision**: Continuous 15-minute monitoring REJECTED by user

**Rationale**:
- OCO orders at broker level handle stop losses automatically
- Resource constraints (API calls every 15 min)
- EOD summary provides backup monitoring

**Current Approach**: Rely on broker-level OCO orders + EOD summary at 4:30pm

---

## Screening Logic

### Long Pathways (Pass if ANY ≥35)

#### 1. Deep Value
- P/E <15, P/B <1.5, PEG <1
- Debt/Equity <0.5
- Positive FCF, ROIC >15%

#### 2. High Growth
- Revenue growth >30%, earnings growth >25%
- Valuation ignored
- Q-over-Q acceleration bonus

#### 3. Inflection Point
- Sequential acceleration (Q-over-Q revenue/earnings)
- Margin expansion
- Catches NVDA-type stocks at turning points

#### 4. Cash Machine
- FCF yield >8%
- Growing FCF (faster than revenue)
- Low debt, high ROIC

#### 5. QARP (Quality at Reasonable Price) - NEW
- ROIC >15%, ROE >20%
- P/E 15-25 (reasonable, not cheap)
- Consistent earnings growth
- Catches high-quality compounders at fair valuations

#### 6. Turnaround - NEW
- Margin expansion (>3pp improvement)
- Revenue stabilization (after decline)
- FCF turning positive
- Still cheap despite improvements
- Catches stocks at inflection points before turnaround is obvious

### Short Criteria (Must hit ALL 3, score ≥60)

#### 1. Extreme Valuation
- PEG >3, P/E >1.5x sector ceiling
- P/S >2x sector median

#### 2. Deteriorating Fundamentals
- Revenue deceleration (Q-over-Q)
- Margin compression
- FCF declining

#### 3. Safety Check
- Short float <15%
- Days to cover <5
- Market cap >$2B
- Volume >$20M/day

---

## Weekly Schedule

### Saturday 3:00 PM ET - Fundamental Screening
- Screens all 407 stocks in single pass
- Generates quality_watchlist (longs) + overvalued_watchlist (shorts)
- Duration: ~3.5 minutes
- Rate limit: 500ms delay between stocks

### Saturday 10:00 AM ET (Even Weeks) - Biweekly Deep Research
- Builds comprehensive stock profiles for watchlist stocks
- 20k token Opus research per stock
- Includes: business model, moats, competitive advantages, risks, catalysts
- Quality filtering: skips penny stocks, low volume, low market cap

### Sunday 9:00 PM ET - Weekly Portfolio Review
- Deep reflection on holdings, performance, lessons learned
- 20k token Opus thinking budget
- Analyzes positions, trades, watchlists
- Saves insights to learning_insights table

### Monday-Friday

**9:00 AM** - Pre-market gap scan  
**10:00 AM** - Morning analysis (4-phase)  
**2:00 PM** - Afternoon analysis (4-phase)  
**4:30 PM** - End-of-day summary  
**Every 5 min (9am-4pm)** - Process approved trades  
**Hourly** - Expire old trade approvals (24h)

---

## Database Schema

### Core Tables

**trades** - Historical trade log  
**positions** - Current holdings (longs + shorts)  
**portfolio_snapshots** - Daily portfolio value  
**trade_approvals** - Pending/approved/rejected trades  
**stock_profiles** - Comprehensive stock dossiers  
**quality_watchlist** - Long candidates  
**overvalued_watchlist** - Short candidates  
**circuit_breaker_events** - Circuit breaker trips/resets  
**earnings_calendar** - Upcoming earnings dates  
**learning_insights** - Weekly review insights

### Key Columns

**stock_profiles**:
- business_model, moats, competitive_advantages
- fundamentals (JSON), risks, catalysts
- quality_flag, skip_reason
- last_updated, profile_version

**quality_watchlist**:
- symbol, asset_class, sector
- score, pathway, metrics (JSON)
- reasons, price, status

**circuit_breaker_events**:
- reason, tripped_at, reset_at

---

## API Endpoints

### Dashboard
- `GET /` - Main dashboard
- `GET /approvals` - Trade approval queue UI

### Trade Approvals
- `POST /api/approvals/:id/approve` - Approve trade
- `POST /api/approvals/:id/reject` - Reject trade

### Manual Triggers
- `POST /api/trigger-deep-research` - Run biweekly deep research
- `POST /api/trigger-batch-profiles/:batchNumber` - Build profiles (batches 1-8)
- `POST /api/trigger-weekly-portfolio-review` - Run weekly review
- `POST /analyze` - Trigger analysis manually

---

## Configuration

### Environment Variables

```bash
# AI (via Quatarly)
QUATARLY_API_KEY=qua-xxx
QUATARLY_BASE_URL=https://api.quatarly.cloud/

# Trading
TRADIER_API_KEY=xxx
TRADIER_ACCOUNT_ID=xxx
NODE_ENV=paper  # or production

# Data
FMP_API_KEY_1=xxx
FMP_API_KEY_2=xxx
FMP_API_KEY_3=xxx
TAVILY_API_KEY=xxx

# Database
DATABASE_URL=postgresql://user:pass@host:5432/whiskie

# Email
RESEND_API_KEY=xxx
RESEND_FROM_EMAIL=whiskie@domain.com
ALERT_EMAIL=your@email.com

# Portfolio
INITIAL_CAPITAL=100000
```

### Safety Thresholds

**Circuit Breaker** (`circuit-breaker.js`):
```javascript
MAX_DAILY_TRADES = 5
MAX_WEEKLY_LOSS_PCT = 0.05  // 5%
```

**Short Safety** (`short-manager.js`):
```javascript
MAX_SHORT_FLOAT = 0.15              // 15%
MAX_DAYS_TO_COVER = 5               // Hard block
ELEVATED_DAYS_TO_COVER = 4          // 8% position limit
MAX_IV_THRESHOLD = 0.80             // 80% absolute
MAX_IV_PERCENTILE = 0.90            // 90th percentile
MAX_BORROW_FEE = 0.10               // 10% annually
SQUEEZE_LOOKBACK_DAYS = 180         // 6 months
```

**Earnings Guard** (`earnings-guard.js`):
```javascript
BLOCK_DAYS_BEFORE = 3  // Block trades 3 days before earnings
```

**Position Sizing** (`risk-manager.js`):
```javascript
MAX_POSITION_SIZE = 0.15            // 15% per position
MAX_SECTOR_ALLOCATION = 0.25        // 25% per sector
MIN_CASH_RESERVE = 0.03             // 3% cash
MAX_DAILY_TRADES = 5                // Circuit breaker
MAX_PORTFOLIO_DRAWDOWN = 0.20       // 20% max drawdown
```

---

## Deployment

### Railway Configuration

**Build Command**: (none, uses package.json)  
**Start Command**: `npm start`  
**Environment**: Set all variables from `.env.example`  
**Database**: PostgreSQL addon attached

### Manual Deploy

```bash
git push origin main  # Triggers Railway deploy
```

### View Logs

```bash
railway logs
```

---

## Key Design Decisions

### Why 6 long pathways?
Catches diverse opportunities:
- Deep Value: Traditional Buffett stocks
- High Growth: Momentum plays
- Inflection Point: Catches NVDA-type stocks at turning points
- Cash Machine: Dividend/FCF plays
- QARP: High-quality compounders at fair valuations
- Turnaround: Improving metrics before turnaround is obvious

### Why strict short criteria (ALL must pass)?
Shorts are riskier than longs (unlimited downside). Requiring ALL 3 criteria (overvaluation + deterioration + safety) ensures high-conviction shorts only.

### Why combined long + short screening?
User insight: Overvalued stocks were being missed because they were screened AFTER long screening. Combined approach ensures every stock is evaluated for both long and short potential in single pass.

### Why stock profiles?
First analysis of a stock is deep (20k tokens), subsequent analyses reference the profile for fast incremental updates. Biweekly refresh keeps profiles current. Avoids redundant research.

### Why trade approval queue?
Human oversight before execution prevents runaway trading. Allows rejection with feedback for learning. Critical safety mechanism.

### Why no continuous position monitoring?
User decision: OCO orders at broker level handle stop losses automatically. Continuous monitoring adds resource overhead without significant safety benefit. EOD summary provides backup monitoring.

---

## Troubleshooting

### Circuit Breaker Tripped
1. Check reason: `SELECT * FROM circuit_breaker_events WHERE reset_at IS NULL`
2. Review recent trades: `SELECT * FROM trades WHERE DATE(executed_at) = CURRENT_DATE`
3. Manual reset: Call `circuitBreaker.reset()` or via API endpoint

### Trades Not Executing
1. Check circuit breaker status
2. Check earnings blackout: `SELECT * FROM earnings_calendar WHERE symbol = 'XXX'`
3. Check short safety (if short): Review `short-manager.js` logs
4. Check approval queue: `SELECT * FROM trade_approvals WHERE status = 'approved'`

### FMP Rate Limits
- System auto-rotates between 3 keys (300 calls/min each = 900/min total)
- Check usage: `fmp.getUsageStats()`
- Cache is tiered (1-90 days), should minimize calls

### Database Connection Issues
- Verify `DATABASE_URL` in `.env`
- Check Railway database is running
- Connection pool settings in `db.js` (max: 20, timeout: 2s)

---

## Recent Changes (2026-04-12)

### Implemented (Opus Review)
1. ✅ Circuit breaker system (5 trades/day, 5% weekly loss)
2. ✅ Earnings guard (3-day blackout)
3. ✅ Enhanced short safety (5 new checks)
4. ✅ Two new long pathways (QARP, Turnaround)
5. ✅ Data validation layer
6. ✅ Database schema updates

### Rejected
- ❌ Continuous position monitoring (15-min intervals) - User rejected due to resource constraints and reliance on OCO orders

### Pending (Medium Priority)
- Correlation analysis in Phase 4
- Portfolio risk metrics (beta, Sharpe, max drawdown)
- Learning feedback loop
- Phase 4 token budget adjustment (20k → 45k)
- Exit liquidity analysis
- Order status reconciliation
- Macro regime detection
- Corporate action handling
- Partial fill logic
- Quarterly universe review
- Limit orders with buffer
- Event-driven profile refresh

---

## Support

**Issues**: https://github.com/anthropics/claude-code/issues  
**Documentation**: See `CLAUDE.md`, `OPUS_DESIGN_REVIEW.md`, `IMPLEMENTATION_SUMMARY.md`  
**Email Alerts**: Configured via `RESEND_API_KEY` and `ALERT_EMAIL`

---

**End of Documentation**
