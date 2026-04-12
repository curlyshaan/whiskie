# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

```bash
npm install
cp .env.example .env  # Configure environment variables
npm start             # Start bot (runs on port 8080)
```

## Common Commands

```bash
# Development
npm start              # Start bot in current mode (paper/production)
npm run dev            # Start with nodemon (auto-restart)
npm run start:paper    # Explicitly run in paper trading mode
npm run start:live     # Run in production mode

# Database
npm run db:init        # Initialize database schema
npm run db:reset       # Reset all tables (destructive)

# Scripts
npm run populate-stocks    # Populate stock universe
npm run update-etb         # Update easy-to-borrow status

# Testing
node test/test-4phase.js           # Test 4-phase analysis system
node test/test-fmp.js              # Test FMP API integration
node test/test-yahoo-finance.js    # Test Yahoo Finance integration
node test/test-analysis.js         # Test full analysis workflow
```

## Architecture Overview

### 4-Phase Analysis System

Whiskie uses a multi-phase approach to separate screening from deep analysis:

1. **Phase 1: Pre-ranking** (1-2 min)
   - Screens 15-20 long candidates + 15-20 short candidates
   - Sources: fundamental screeners, quality watchlist, overvalued watchlist
   - Fast filtering to identify promising stocks

2. **Phase 2: Long Analysis** (3-5 min, 50k token thinking budget)
   - Deep Opus analysis of long candidates
   - Uses extended thinking for thorough evaluation
   - Considers fundamentals, technicals, catalysts, risks

3. **Phase 3: Short Analysis** (3-5 min, 50k token thinking budget)
   - Deep Opus analysis of short candidates
   - Extended thinking for comprehensive short thesis
   - Evaluates overvaluation, deteriorating fundamentals, technical weakness

4. **Phase 4: Portfolio Construction** (1-2 min, 20k token thinking budget)
   - Builds final portfolio with 0-3 stocks per sub-sector constraint
   - Balances conviction, diversification, risk
   - Outputs trade recommendations in parseable format

### Stock Profile System

Avoids redundant research by maintaining comprehensive stock dossiers:

- **Biweekly deep research** (Saturday 10am, even weeks only)
  - Builds detailed profiles for watchlist stocks
  - Includes: business_model, moats, competitive_advantages, fundamentals, risks, catalysts
  - Manual trigger: `POST /api/trigger-deep-research`

- **Daily incremental updates**
  - Fresh profiles (<14 days old): quick incremental updates
  - Stale profiles (>14 days old): deeper refresh
  - First-time stocks: full deep dive (20k tokens)

- **Profile structure** (in `stock_profiles` table):
  - `business_model`: What the company does, revenue model
  - `moats`: Competitive advantages and barriers to entry
  - `competitive_advantages`: Specific strengths vs competitors
  - `fundamentals`: Financial metrics (JSON)
  - `risks`: Key risks and concerns
  - `catalysts`: Upcoming events or trends
  - `last_updated`: Timestamp for staleness check
  - `profile_version`: Increments on each update

### Trade Approval Queue

Human-in-the-loop system for trade execution:

1. Bot generates trade recommendations in Phase 4
2. Trades parsed and queued as "pending_approval" in `trade_approvals` table
3. Email sent to user with trade details
4. User reviews via web UI at `/approvals`
5. User approves or rejects with optional feedback
6. Approved trades executed by `trade-executor.js`
7. Rejected trades logged for learning

**Trade format** (must match for parsing):
```
EXECUTE_BUY: SYMBOL | QTY | ENTRY | STOP | TARGET
EXECUTE_SHORT: SYMBOL | QTY | ENTRY | STOP | TARGET
```

### Data Source Strategy

**FMP (Financial Modeling Prep)**:
- Single paid API key with 300 calls/minute (unlimited daily)
- **Tiered cache strategy** (optimized for data volatility):
  - **1-day cache (TTM tier)**: TTM ratios, technical indicators (price-dependent data)
  - **45-day cache (QUARTERLY tier)**: Quarterly statements, growth rates (updates at earnings)
  - **90-day cache (ANNUAL tier)**: Company profiles, sector data (rarely changes)
- Key endpoints:
  - `/stable/ratios-ttm` - Current P/E, PEG, margins, ROE (TTM)
  - `/stable/key-metrics-ttm` - ROIC, Graham number, EV ratios (TTM)
  - `/stable/financial-growth?period=quarter` - True YoY growth rates
  - `/stable/income-statement?period=quarter` - Quarterly financials
  - `/stable/technical-indicators/ema` - 50/200 EMA
  - `/stable/technical-indicators/rsi` - RSI(14)
  - `/stable/earning-calendar` - Upcoming earnings dates
- Cache managed by `fmp-cache.js` with automatic tier-based expiration
- API key: `FMP_API_KEY_1`

**Yahoo Finance**:
- Short interest data (FMP doesn't provide this)
- Fallback for historical data
- Rate-limited, use sparingly

**Tradier**:
- Real-time quotes and order execution
- Paper trading sandbox vs production
- Controlled by `NODE_ENV` (paper/production)

**Tavily**:
- News search for fundamental analysis
- Used in stock profile generation

### Cron Schedule (America/New_York)

| Time | Frequency | Job |
|------|-----------|-----|
| 9:00 AM | Mon-Fri | Pre-market gap scan |
| 10:00 AM | Mon-Fri | Daily analysis (4-phase) |
| 2:00 PM | Mon-Fri | Afternoon analysis |
| 4:30 PM | Mon-Fri | End-of-day summary |
| 3:00 PM | Friday | Earnings calendar refresh |
| 9:00 PM | Saturday | Fundamental screening (first half) |
| 10:00 AM | Saturday (even weeks) | Biweekly deep stock research |
| 9:00 PM | Sunday | Full weekly screening + review |
| Every 5 min | 9am-4pm Mon-Fri | Process approved trades |
| Hourly | Always | Expire old trade approvals (24h) |

## Key Files and Modules

### Core Orchestration
- `src/index.js` - Main bot orchestration, cron scheduling, API server
- `src/dashboard.js` - Web UI for approvals and monitoring

### AI Integration
- `src/claude.js` - Claude API wrapper (via Quatarly)
  - `MODELS.OPUS` = 'claude-opus-4-6-thinking' (primary model)
  - Extended thinking enabled for Phases 2, 3, 4
  - Temperature 1.0 for thinking, 0.1 for non-thinking calls

### Data Sources
- `src/fmp.js` - FMP API with 3-key rotation
- `src/fmp-cache.js` - 90-day caching layer for FMP
- `src/yahoo-finance.js` - Yahoo Finance integration
- `src/tradier.js` - Tradier API for quotes and execution
- `src/tavily.js` - Tavily news search

### Analysis Pipeline
- `src/pre-ranking.js` - Phase 1 screening
- `src/opus-screener.js` - Phases 2, 3, 4 orchestration
- `src/stock-profiles.js` - Stock profile management
- `src/fundamental-screener.js` - Value screening
- `src/quality-screener.js` - Quality stock identification
- `src/overvalued-screener.js` - Short candidate screening

### Trade Management
- `src/trade-approval.js` - Approval queue management
- `src/trade-executor.js` - Execute approved trades
- `src/order-manager.js` - OCO order management
- `src/short-manager.js` - Short position handling

### Risk & Analysis
- `src/risk-manager.js` - Position sizing, sector limits
- `src/vix-regime.js` - Market regime detection
- `src/correlation-analysis.js` - Portfolio correlation
- `src/sector-rotation.js` - Sector momentum tracking
- `src/performance-analyzer.js` - Performance metrics
- `src/weekly-review.js` - Weekly portfolio review

### Database
- `src/db.js` - PostgreSQL connection pool and schema
- Key tables: `trades`, `positions`, `portfolio_snapshots`, `analyses`, `trade_approvals`, `stock_profiles`, `watchlist`, `value_watchlist`, `quality_watchlist`, `overvalued_watchlist`

## Environment Variables

Required in `.env`:

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

## Key Design Decisions

### Why 4-phase analysis?
Separates fast screening (Phase 1) from deep analysis (Phases 2-3), allowing different thinking budgets per phase. Phase 4 synthesizes into final portfolio with sector constraints.

### Why stock profiles?
First analysis of a stock is deep (20k tokens), subsequent analyses reference the profile for fast incremental updates. Biweekly refresh keeps profiles current. Avoids redundant research.

### Why 0-3 per sub-sector?
Prevents over-concentration in single industries while allowing flexibility. 0 = skip weak sectors, 3 = max conviction. Applies across both longs AND shorts combined.

### Why FMP + Yahoo Finance?
FMP provides comprehensive fundamentals with 3-key rotation for 750 calls/day. Yahoo provides free historical data and short interest. Complementary strengths, cost-effective.

### Why trade approval queue?
Human oversight before execution prevents runaway trading. Allows rejection with feedback for learning. Critical safety mechanism.

### Why extended thinking?
Opus with extended thinking (50k token budget) produces more thorough analysis than standard calls. Used in Phases 2, 3, 4 where deep reasoning is critical. Takes 3-7 minutes but worth it.

## Troubleshooting

### Trades not appearing in approval queue
- Check Phase 4 output format matches: `EXECUTE_BUY: SYMBOL | QTY | ENTRY | STOP | TARGET`
- Verify parser in `trade-approval.js` function `extractTradeRecommendations()`
- Check logs for parsing errors

### FMP rate limits hit
- System auto-rotates between 3 keys (250 calls each = 750/day)
- Check usage: `fmp.getUsageStats()`
- Cache is 90 days, should minimize calls
- If still hitting limits, add more keys or reduce analysis frequency

### Database connection issues
- Verify `DATABASE_URL` in `.env`
- Check Railway database is running (if deployed)
- Connection pool settings in `db.js` (max: 20, timeout: 2s)

### Analysis too fast (not using full thinking budget)
- Prompts use natural language ("take your time, don't rush")
- Stock profiles reduce redundant research (by design)
- First-time stocks get full deep dive
- Check `enableThinking` and `thinkingBudget` parameters in claude.js calls

### Port 8080 already in use
```bash
lsof -ti:8080 | xargs kill
```

## Deployment

Deployed on Railway with auto-deploy from `main` branch.

**Railway configuration**:
- Build command: (none, uses package.json)
- Start command: `npm start`
- Environment: Set all variables from `.env.example`
- Database: PostgreSQL addon attached

**Manual deploy**:
```bash
git push origin main  # Triggers Railway deploy
```

**View logs**:
```bash
railway logs
```

## Testing Strategy

Test files in `test/` directory:
- `test-4phase.js` - Full 4-phase analysis workflow
- `test-fmp.js` - FMP API integration and caching
- `test-yahoo-finance.js` - Yahoo Finance data fetching
- `test-analysis.js` - Analysis engine components
- `test-full-analysis.js` - End-to-end analysis test

Run tests individually with `node test/<filename>.js`

## API Endpoints

**Dashboard**:
- `GET /` - Main dashboard (portfolio, positions, recent trades)
- `GET /approvals` - Trade approval queue UI

**Trade Approvals**:
- `POST /api/approvals/:id/approve` - Approve pending trade
- `POST /api/approvals/:id/reject` - Reject pending trade

**Manual Triggers**:
- `POST /api/trigger-deep-research` - Run biweekly deep stock research
- `POST /analyze` - Trigger analysis manually (bypasses cron)

## Important Constraints

**Position Sizing**:
- Max 15% per position (`MAX_POSITION_SIZE`)
- Max 25% per sector (`MAX_SECTOR_ALLOCATION`)
- Min 3% cash reserve (`MIN_CASH_RESERVE`)

**Trading Limits**:
- Max 3 trades per day (`MAX_DAILY_TRADES`)
- Max 20% portfolio drawdown (`MAX_PORTFOLIO_DRAWDOWN`)

**Sector Constraint**:
- 0-3 stocks per sub-sector (combined longs + shorts)
- Enforced in Phase 4 portfolio construction

**Trade Approval**:
- 24-hour auto-expiration on pending approvals
- Email notification on new approvals
- Rejection feedback logged for learning
