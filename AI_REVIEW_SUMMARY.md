# Whiskie Trading Bot - AI Review Summary

**Generated:** 2026-04-14  
**Purpose:** Comprehensive overview for AI model review

---

## Executive Summary

Whiskie is an autonomous AI portfolio manager that uses Claude Opus 4.6 with extended thinking to manage a $100k long/short equity portfolio. The system aims to **beat S&P 500 by 5-10% annually** through superior stock selection, sector rotation, and pathway-specific exit strategies.

**Key Innovation:** Different investment pathways (deepValue, highGrowth, value_dip, etc.) have different time horizons and exit strategies. A "value dip" exits at +20% in 3-12 months, while "deepValue" holds for 2-5 years targeting 2-3x returns.

---

## System Architecture

### 4-Phase Analysis Pipeline

**Phase 1: Pre-Ranking** (1-2 min)
- Screens 407-stock curated universe + saturday_watchlist
- Live filtering: volume ($50M min), spread (0.5% max), price ($5 min)
- Sector-adjusted momentum scoring (Tech: 2.5% move, Utilities: 1.5%)
- Earnings calendar integration (-3 to +7 days)
- Output: 12-15 long + 5-8 short candidates

**Phase 2: Long Analysis** (3-5 min, 35k token budget)
- Opus extended thinking analysis of long candidates
- References stock profiles (saves ~15k tokens per stock)
- Evaluates: fundamentals, technicals, catalysts, R/R
- Applies 0-3 per sub-sector constraint
- Output: BUY or PASS decisions with reasoning

**Phase 3: Short Analysis** (3-5 min, 35k token budget)
- Opus extended thinking analysis of short candidates
- Evaluates: overvaluation, deterioration, technicals
- Checks: ETB status, IV filter (80% max), squeeze risk
- Output: SHORT or PASS decisions with reasoning

**Phase 4: Portfolio Construction** (1-2 min, 45k token budget)
- **PRIMARY GOAL: Beat S&P 500 by 5-10% annually**
- Combines Phase 2 & 3 insights
- Market regime allocation (bull/bear/neutral)
- 0-3 per sub-sector constraint (longs + shorts combined)
- Position sizing: conviction + volatility based
- Pathway-specific exit strategies
- Output: 10-12 final positions (7-8 longs, 2-4 shorts)

---

## Pathway-Specific Exit Strategies

### The Problem
User concern: "I like MSFT, believe it's 2x-3x in future, plan to hold multiple years. Whiskie will set a target that hits in 6 months and miss future highs."

### The Solution
Different pathways have different exit strategies:

| Pathway | Time Horizon | Take-Profit | Stop-Loss | Example |
|---------|--------------|-------------|-----------|---------|
| **deepValue** | 2-5 years | None (hold for thesis) | -15% | MSFT at $280 believing intrinsic value is $560. Trim 25% at +100%, 25% at +200%, trail rest |
| **value_dip** | 3-12 months | +20% (fair value) | -8% | MSFT drops $420→$350 on rotation. Exit at $420 recovery |
| **highGrowth** | 6-18 months | +50% | -12% | NVDA during AI boom. Trim 33% at +50%, 33% at +100% |
| **turnaround** | 2-4 years | None (hold for transformation) | -20% | Intel foundry transformation. Hold through volatility |
| **cashMachine** | 2-4 years | None (hold for income) | -12% or dividend cut | AT&T for 7% yield. Hold for income |

**Key Principle:** Exit strategy must match investment thesis. A "dip buy" is not a "long-term hold" - they're different theses requiring different exits.

See `PATHWAY_EXIT_STRATEGIES.md` for complete rules.

---

## Stock Profile System

Avoids redundant research by maintaining comprehensive stock dossiers:

**Biweekly Deep Research** (Saturday 10am, even weeks)
- Builds detailed profiles for watchlist stocks
- Includes: business_model, moats, competitive_advantages, fundamentals, risks, catalysts
- Saves ~15k tokens per stock in daily analysis

**Daily Incremental Updates**
- Fresh profiles (<14 days): quick incremental updates
- Stale profiles (>14 days): deeper refresh
- First-time stocks: full deep dive (20k tokens)

**Profile Structure:**
```javascript
{
  symbol: 'MSFT',
  business_model: 'Cloud computing, productivity software...',
  moats: 'Network effects, switching costs...',
  competitive_advantages: 'Azure scale, Office dominance...',
  fundamentals: { pe: 28, roe: 0.42, ... },
  risks: 'Regulatory scrutiny, cloud competition...',
  catalysts: 'AI monetization, Azure growth...',
  last_updated: '2026-04-10',
  profile_version: 3
}
```

---

## Trade Approval Queue

Human-in-the-loop system for trade execution:

1. Bot generates trade recommendations in Phase 4
2. Trades parsed and queued as "pending_approval" in database
3. Email sent to user with trade details
4. User reviews via web UI at `/approvals`
5. User approves or rejects with optional feedback
6. Approved trades executed by `trade-executor.js`
7. Rejected trades logged for learning

**Trade Format:**
```
EXECUTE_BUY: MSFT | 26 | 420.00 | 395.00 | 500.00 | deepValue | value_dip
EXECUTE_SHORT: NET | 45 | 177.72 | 186.60 | 151.06 | overvalued | short_overvalued
```

---

## Data Sources

**FMP (Financial Modeling Prep)**
- Single paid API key with 300 calls/minute
- Always use `/stable` endpoint (not `/api/v3`)
- Key endpoints: ratios-ttm, key-metrics-ttm, financial-growth, technical-indicators
- No caching - FMP is fast enough

**Tradier**
- Real-time quotes and order execution
- Paper trading sandbox vs production
- ETB (Easy-to-Borrow) list for short eligibility

**Tavily**
- News search for fundamental analysis
- Used in stock profile generation

**PostgreSQL (Railway)**
- Stock universe, profiles, history, watchlists
- Trade approvals, positions, analyses

---

## Risk Management

### VIX Regime Detection
- **NORMAL** (VIX < 20): Standard sizing (100%)
- **ELEVATED** (VIX 20-30): Reduced sizing (75%)
- **HIGH** (VIX > 30): Conservative sizing (50%)

### Market Regime Allocation
- **BULL** (SPY > rising 200MA): 70% long, 10% short, 20% cash
- **BEAR** (SPY < declining 200MA): 30% long, 60% short, 10% cash
- **NEUTRAL** (mixed signals): 50% long, 50% short

### Short Position Safety
- ETB verification required
- IV filter: 80% max (blocks meme stocks)
- Market cap: $2B minimum
- Stop-loss REQUIRED (5-8% above entry)
- Squeeze history check (>50% move in past 6 months)

### Position Sizing
- Max 12% per position
- Max 25% per sector
- Min 3% cash reserve
- 0-3 stocks per sub-sector (longs + shorts combined)

---

## Cron Schedule (America/New_York)

| Time | Frequency | Job |
|------|-----------|-----|
| 9:00 AM | Mon-Fri | Pre-market gap scan |
| 10:00 AM | Mon-Fri | Daily analysis (4-phase) |
| 2:00 PM | Mon-Fri | Afternoon analysis |
| 4:30 PM | Mon-Fri | End-of-day summary |
| 3:00 PM | Friday | Earnings calendar refresh |
| 9:00 PM | Saturday | Fundamental screening |
| 10:00 AM | Saturday (even weeks) | Biweekly deep stock research |
| 9:00 PM | Sunday | Opus screening + weekly review |
| Every 5 min | 9am-4pm Mon-Fri | Process approved trades |
| Hourly | Always | Expire old trade approvals (24h) |

---

## Key Constraints

### Trading Limits
- Max 3 trades per day
- Max 20% portfolio drawdown
- 24-hour auto-expiration on pending approvals

### Sector Constraint
- **0-3 stocks per sub-sector** (combined longs + shorts)
- Enforced in Phase 4 portfolio construction
- Prevents over-concentration in single industries

### Earnings Calendar
- **LONGS:** Exclude if earnings in next 3 days (imminent risk)
- **LONGS:** Allow if earnings -1 to -3 days (post-earnings dip opportunity)
- **SHORTS:** Boost if earnings in next 3 days (+15 score for IV spike)

---

## Technology Stack

**Backend:** Node.js + Express  
**Database:** PostgreSQL (Railway)  
**AI:** Claude Opus 4.6 (via Quatarly API)  
**APIs:** FMP, Tradier, Tavily, Resend  

**Key Modules:**
- `index.js` - Main orchestration + cron scheduling
- `pre-ranking.js` - Phase 1 screening
- `stock-profiles.js` - Profile management
- `pathway-exit-strategies.js` - Exit strategy rules
- `trade-approval.js` - Approval queue
- `trade-executor.js` - Execution engine
- `risk-manager.js` - Position sizing + limits
- `vix-regime.js` - Market regime detection
- `short-manager.js` - Short position handling

---

## Success Metrics

- **Analysis Speed:** 4-phase analysis in ~10 minutes
- **Token Efficiency:** Stock profiles save ~15k tokens per stock
- **Candidate Quality:** 10-12 final positions from 407-stock universe
- **Risk Management:** 0-3 per sub-sector, max 25% per sector
- **Human Oversight:** All trades require approval before execution
- **Performance Goal:** Beat S&P 500 by 5-10% annually (minimum)

---

## Recent Improvements

1. **Pathway-Specific Exit Strategies** (2026-04-14)
   - Different time horizons for different investment theses
   - deepValue holds 2-5 years, value_dip exits in 3-12 months
   - Trailing stops, trim levels, fundamental stops per pathway

2. **S&P 500 Benchmarking** (2026-04-14)
   - Added explicit goal to Phase 4: beat SPY by 5-10% annually
   - Not a ceiling - take concentrated bets where conviction is high
   - Optimize for Sharpe ratio, not just diversification

3. **Trade Approval Reasoning** (2026-04-13)
   - Fixed reasoning extraction from Phase 2/3 analyses
   - Dashboard now shows detailed reasoning instead of generic text
   - Example: "UNH showing strong FCF growth..." vs "Long position in UNH"

4. **Null Symbol Bug Fix** (2026-04-13)
   - Eliminated redundant Opus Phase 1 analysis
   - Now uses pre-ranking structured data directly as candidates
   - Fixed 33+ null symbol errors in stock_analysis_history table

---

## Open Questions for AI Review

1. **Consistency Between Runs**
   - User observed: Run 1 recommends BE, UNH, NVDA, PANW. Run 2 recommends MSFT, AMD.
   - This is EXPECTED behavior due to live market data (quotes, volume, momentum change throughout day)
   - Earnings calendar changes daily (stocks move in/out of -3 to +7 day window)
   - 0-3 per sub-sector constraint means if one sub-sector fills up, others get excluded
   - Question: Is this acceptable or should there be more consistency?

2. **Pathway Implementation**
   - Pathway-specific exit strategies are designed but NOT YET IMPLEMENTED
   - Need to add `pathway` field to `positions` table
   - Need to modify `trade-executor.js` to set pathway-specific targets
   - Need to update daily monitoring to check pathway-specific exit conditions
   - Question: Should this be implemented before production deployment?

3. **Take-Profit Modification**
   - Current: Take-profit is fixed at entry, doesn't auto-update
   - If BE hits $215 (near $200 target), Opus can recommend raising target
   - But this requires new trade approval (not automatic)
   - Question: Should there be auto-adjustment rules or keep human-in-the-loop?

4. **Short Interest Data**
   - Short manager lacks short interest data (Yahoo Finance 401 errors)
   - Currently relies on ETB + IV filter (80% max) to avoid meme stocks
   - Days to Cover (DTC) data unavailable
   - Question: Is ETB + IV filter sufficient or should we find alternative data source?

---

## Documentation Files

- `WORKFLOW.md` - Complete system architecture and data flows
- `PATHWAY_EXIT_STRATEGIES.md` - Detailed exit rules per pathway
- `CLAUDE.md` - Developer guide for future Claude sessions
- `README.md` - User-facing setup and usage
- `AI_REVIEW_SUMMARY.md` - This file

---

**Status:** Production-ready with pathway exit strategies designed but not yet implemented.  
**Next Steps:** Implement pathway-specific exit logic, test in paper trading, deploy to production.
