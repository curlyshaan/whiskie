# Whiskie Trading Bot - Complete Workflow

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     WHISKIE TRADING BOT                          │
│                  Autonomous AI Portfolio Manager                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    DATA SOURCES & INPUTS                         │
├─────────────────────────────────────────────────────────────────┤
│ • FMP API (fundamentals, earnings, technicals)                   │
│ • Tradier API (quotes, execution, ETB list)                      │
│ • Tavily API (news search)                                       │
│ • PostgreSQL (stock profiles, history, watchlists)               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    WEEKLY SCREENING CYCLE                        │
│                   (Saturday 9pm → Sunday 9pm)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  SATURDAY 9PM: Fundamental Screening                             │
│  ├─ Screen 407-stock curated universe                            │
│  ├─ Apply sector-adjusted scoring (6 long + 3 short pathways)    │
│  ├─ Score: deepValue, highGrowth, inflection, cashMachine,       │
│  │         qarp, turnaround (longs)                              │
│  │         overvalued, deteriorating, overextended (shorts)      │
│  └─ Store top 100 in saturday_watchlist table                    │
│                                                                   │
│  SUNDAY 9PM: Opus Screening                                      │
│  ├─ Analyze top 100 from saturday_watchlist                      │
│  ├─ Use Tavily news + stock profiles + catalyst analysis         │
│  ├─ Refine/rank candidates with Opus extended thinking           │
│  └─ Update saturday_watchlist with refined scores                │
│                                                                   │
│  SATURDAY 10AM (even weeks): Biweekly Deep Research              │
│  ├─ Build comprehensive stock profiles for watchlist stocks      │
│  ├─ Profile includes: business_model, moats, competitive_        │
│  │   advantages, fundamentals, risks, catalysts                  │
│  └─ Saves ~15k tokens per stock in daily analysis                │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    DAILY ANALYSIS CYCLE                          │
│                   (Mon-Fri 10am & 2pm ET)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  PHASE 1: Pre-Ranking (1-2 min)                                  │
│  ├─ Merge saturday_watchlist + stock_universe                    │
│  ├─ Live filtering: volume, spread, price checks                 │
│  ├─ Earnings calendar integration (-3 to +7 days)                │
│  ├─ Sector-adjusted momentum scoring                             │
│  │   • Tech: 2.5% move + 1.3x volume                             │
│  │   • Utilities: 1.5% move + 1.8x volume                        │
│  │   • Default: 2.0% move + 1.5x volume                          │
│  └─ Output: 12-15 long + 5-8 short candidates                    │
│                                                                   │
│  PHASE 2: Long Analysis (3-5 min, 35k token budget)              │
│  ├─ Fetch stock profiles for candidates                          │
│  ├─ Opus extended thinking analysis                              │
│  ├─ Evaluate: fundamentals, technicals, catalysts, R/R           │
│  ├─ Apply 0-3 per sub-sector constraint                          │
│  └─ Output: BUY or PASS decisions with reasoning                 │
│                                                                   │
│  PHASE 3: Short Analysis (3-5 min, 35k token budget)             │
│  ├─ Fetch stock profiles for short candidates                    │
│  ├─ Opus extended thinking analysis                              │
│  ├─ Evaluate: overvaluation, deterioration, technicals           │
│  ├─ Check: ETB status, IV filter (80% max), squeeze risk         │
│  └─ Output: SHORT or PASS decisions with reasoning               │
│                                                                   │
│  PHASE 4: Portfolio Construction (1-2 min, 45k token budget)     │
│  ├─ PRIMARY GOAL: Beat S&P 500 by 5-10% annually (minimum)      │
│  ├─ Combine Phase 2 & 3 insights                                 │
│  ├─ Apply market regime allocation (bull/bear/neutral)           │
│  ├─ Enforce 0-3 per sub-sector constraint (longs + shorts)       │
│  ├─ Position sizing: conviction + volatility based               │
│  ├─ Diversification: max 30% per sector                          │
│  ├─ Pathway-specific exit strategies (value_dip vs deepValue)    │
│  └─ Output: 10-12 final positions (7-8 longs, 2-4 shorts)        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    TRADE APPROVAL QUEUE                          │
├─────────────────────────────────────────────────────────────────┤
│  1. Parse EXECUTE_BUY/EXECUTE_SHORT commands                     │
│  2. Extract reasoning from Phase 2/3 analyses                    │
│  3. Queue trades as "pending_approval" in database               │
│  4. Send batch email notification to user                        │
│  5. User reviews via web UI: /approvals                          │
│  6. User approves or rejects with optional feedback              │
│  7. Approved trades → trade-executor.js                          │
│  8. Rejected trades → logged for learning                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    TRADE EXECUTION                               │
├─────────────────────────────────────────────────────────────────┤
│  • Execute via Tradier API (paper or production)                 │
│  • OCO orders: entry limit + stop loss + take profit             │
│  • Position tracking in database                                 │
│  • Order reconciliation (hourly)                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    ONGOING MONITORING                            │
├─────────────────────────────────────────────────────────────────┤
│  • Trim opportunities (>20% gain)                                │
│  • Tax optimization (long-term vs short-term)                    │
│  • Trailing stops (activate at +15%, trail at -8%)               │
│  • Earnings alerts (5 days before)                               │
│  • Order modifications (stop adjustments)                        │
│  • Days held tracking (for tax planning)                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    LEARNING & FEEDBACK                           │
├─────────────────────────────────────────────────────────────────┤
│  • Save stock analyses to trend learning database                │
│  • Track analysis outcomes (correct/incorrect/partial)           │
│  • Daily trend learning (pattern detection)                      │
│  • Weekly strategic learning (performance review)                │
│  • Apply insights to future analyses                             │
└─────────────────────────────────────────────────────────────────┘
```

## Key Data Flows

### 1. Stock Universe → Candidates → Trades

```
407 stocks (stock_universe)
    ↓
saturday_watchlist (100 stocks with pathways)
    ↓
Pre-ranking (12-15 longs, 5-8 shorts)
    ↓
Phase 2/3 Analysis (BUY/SHORT decisions)
    ↓
Phase 4 Construction (10-12 final positions)
    ↓
Trade Approval Queue
    ↓
Execution
```

### 2. Stock Profile System

```
Biweekly Deep Research (Saturday 10am, even weeks)
    ↓
Comprehensive profiles stored in stock_profiles table
    ↓
Daily Analysis references profiles (saves ~15k tokens/stock)
    ↓
Incremental updates for fresh profiles (<14 days)
    ↓
Deep refresh for stale profiles (>14 days)
```

### 3. Earnings Calendar Integration

```
FMP Earnings Calendar API
    ↓
Track earnings -3 to +7 days
    ↓
LONGS: Exclude if earnings in next 3 days (imminent risk)
        Allow if earnings -1 to -3 days (post-earnings dip opportunity)
    ↓
SHORTS: Boost if earnings in next 3 days (+15 score for IV spike)
```

### 4. Sector-Adjusted Momentum

```
Pre-ranking fetches live quotes
    ↓
Calculate: price change %, volume surge
    ↓
Get sector-specific thresholds from sector-config.js
    ↓
Tech: 2.5% move + 1.3x volume (higher threshold)
Utilities: 1.5% move + 1.8x volume (lower move, higher volume)
Default: 2.0% move + 1.5x volume
    ↓
Score only if meets sector threshold
```

## Critical Constraints

### Position Sizing
- Max 12% per position
- Max 25% per sector
- Min 3% cash reserve

### Trading Limits
- Max 3 trades per day
- Max 20% portfolio drawdown

### Sector Constraint
- **0-3 stocks per sub-sector** (combined longs + shorts)
- Enforced in Phase 4 portfolio construction

### Trade Approval
- 24-hour auto-expiration on pending approvals
- Email notification on new approvals
- Rejection feedback logged for learning

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

## Pathway-Specific Exit Strategies

Different investment pathways require different exit strategies. A "value dip" is a 3-12 month trade expecting mean reversion, while "deepValue" is a 2-5 year hold expecting multi-bagger returns.

### Long Pathways

| Pathway | Time Horizon | Take-Profit | Stop-Loss | Trim Strategy |
|---------|--------------|-------------|-----------|---------------|
| **deepValue** | 2-5 years | None (hold for thesis) | -15% or fundamental break | 25% at +100%, 25% at +200% |
| **highGrowth** | 6-18 months | +50% | -12% | 33% at +50%, 33% at +100% |
| **inflection** | 3-9 months | +30% | -10% | 50% at +30% |
| **cashMachine** | 2-4 years | None (hold for income) | -12% or dividend cut | 25% at +50% (rebalance) |
| **qarp** | 1-3 years | +40% | -10% | 33% at +40%, 33% at +80% |
| **turnaround** | 2-4 years | None (hold for transformation) | -20% | 20% at +100%, 30% at +200% |
| **value_dip** | 3-12 months | +20% (fair value) | -8% | 50% at +15%, 50% at +25% |

### Short Pathways

| Pathway | Time Horizon | Take-Profit | Stop-Loss | Cover Strategy |
|---------|--------------|-------------|-----------|----------------|
| **overvalued** | 6-18 months | -25% | +15% | 50% at -25%, 50% at -40% |
| **deteriorating** | 6-12 months | -30% | +12% | 50% at -30% |
| **overextended** | 2-8 weeks | -8% | +6% | 100% at -8% (quick trade) |

### Key Principles

- **Exit matches thesis**: A "dip buy" exits at fair value recovery (~20%), not multi-year hold
- **Trailing stops**: Activate after initial gains to protect profits (e.g., deepValue trails at -25% after +100%)
- **Partial exits**: Lock in gains at milestones, let winners run with trailing stops
- **Fundamental stops**: Exit if thesis breaks (ROE drops >30%, dividend cut, transformation fails)
- **Pathway evolution**: inflection → turnaround if succeeds 2+ quarters, value_dip → deteriorating if doesn't recover

See `PATHWAY_EXIT_STRATEGIES.md` for detailed rules and implementation.

## Risk Management

### VIX Regime Detection
- **NORMAL** (VIX < 20): Standard position sizing (100%)
- **ELEVATED** (VIX 20-30): Reduced sizing (75%)
- **HIGH** (VIX > 30): Conservative sizing (50%)

### Market Regime Allocation
- **BULL** (SPY > rising 200MA): 70% long, 10% short, 20% cash
- **BEAR** (SPY < declining 200MA): 30% long, 60% short, 10% cash
- **NEUTRAL** (mixed signals): 50% long, 50% short

### Short Position Safety
- ETB (Easy-to-Borrow) verification required
- IV filter: 80% max (blocks meme stocks)
- Market cap: $2B minimum
- Stop-loss REQUIRED (5-8% above entry)

## Technology Stack

### Backend
- Node.js + Express
- PostgreSQL (Railway)
- Claude Opus 4.6 (via Quatarly API)

### APIs
- FMP (fundamentals, earnings, technicals)
- Tradier (quotes, execution)
- Tavily (news search)
- Resend (email notifications)

### Key Modules
- `index.js` - Main orchestration + cron scheduling
- `pre-ranking.js` - Phase 1 screening
- `fundamental-screener.js` - Saturday screening
- `opus-screener.js` - Sunday screening
- `stock-profiles.js` - Profile management
- `trade-approval.js` - Approval queue
- `trade-executor.js` - Execution engine
- `risk-manager.js` - Position sizing + limits
- `vix-regime.js` - Market regime detection

## Deployment

- **Platform**: Railway
- **Database**: PostgreSQL addon
- **Environment**: Paper trading (NODE_ENV=paper) or Production
- **Auto-deploy**: From GitHub main branch
- **Logs**: `railway logs`

## Web UI

- **Dashboard**: `/` - Portfolio, positions, recent trades
- **Approvals**: `/approvals` - Trade approval queue
- **Manual Trigger**: `POST /analyze` - Trigger analysis manually

## Success Metrics

- **Analysis Speed**: 4-phase analysis in ~4 minutes
- **Token Efficiency**: Stock profiles save ~15k tokens per stock
- **Candidate Quality**: 10-12 final positions from 407-stock universe
- **Risk Management**: 0-3 per sub-sector, max 25% per sector
- **Human Oversight**: All trades require approval before execution
