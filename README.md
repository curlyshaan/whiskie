# Whiskie - AI Portfolio Manager

Autonomous trading bot using Claude Opus with extended thinking for long/short equity portfolio management.

## Quick Start

```bash
npm install
cp .env.example .env  # Configure environment variables
npm start             # Start bot (runs on port 8080)
```

## What is Whiskie?

Whiskie is an AI-powered trading system that:
- Screens 377+ stocks weekly using fundamental analysis (6 long + 3 short pathways)
- Performs deep research with Claude Opus extended thinking (50k token budget)
- Generates trade recommendations with human-in-the-loop approval
- Manages long/short equity portfolio with sector diversification constraints
- Adapts to market regimes (VIX-based risk management)

**Key Features:**
- **Saturday Watchlist System**: Weekly universe refresh + fundamental screening
- **4-Phase Analysis**: Pre-ranking → Long Analysis → Short Analysis → Portfolio Construction
- **Stock Profiles**: Comprehensive research dossiers with 12-day staleness checks
- **Trade Approval Queue**: Human oversight before execution
- **Sector Constraints**: 0-3 stocks per sub-sector (combined longs + shorts)

## Architecture Overview

### Weekly Cycle (Saturday)

**10:00 AM ET - Stock Universe Refresh**
- Runs `populate-universe-v2.js` via cron
- Fetches top 7 stocks per industry from FMP ($7B+ market cap)
- Populates `stock_universe` table (~377 stocks)

**3:00 PM ET - Fundamental Screening**
- Screens all 377 stocks using sector-adjusted thresholds
- 6 long pathways: deepValue, highGrowth, inflection, cashMachine, qarp, turnaround
- 3 short pathways: overvalued, deteriorating, overextended
- Populates `saturday_watchlist` with intent/pathway tags

### Daily Cycle (Mon-Fri)

**10:00 AM & 2:00 PM ET - Analysis**
1. **Pre-ranking**: Filters saturday_watchlist by volume/spread/price
2. **Phase 2 (Long Analysis)**: Opus deep dive on long candidates (50k token thinking)
3. **Phase 3 (Short Analysis)**: Opus deep dive on short candidates (50k token thinking)
4. **Phase 4 (Portfolio Construction)**: Builds final portfolio with sector constraints (20k token thinking)
5. **Trade Approval**: Recommendations queued for human review

**Trade Execution**
- Every 45 minutes (9am-4pm): Process approved trades
- OCO orders (stop-loss + take-profit) placed automatically

## Data Sources

**FMP (Financial Modeling Prep)** - Primary data source
- 300 calls/minute, unlimited daily
- Always use `/stable` endpoint (not `/api/v3`)
- Key endpoints: ratios-ttm, key-metrics-ttm, financial-growth, technical-indicators
- No caching (fast enough without it)

**Tradier** - Real-time quotes and execution
- Paper trading sandbox vs production (controlled by `NODE_ENV`)

**Tavily** - News search for fundamental analysis

**Yahoo Finance** - Short interest data (FMP doesn't provide)

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

## Common Commands

```bash
# Development
npm start              # Start bot
npm run dev            # Start with nodemon (auto-restart)

# Database
npm run db:init        # Initialize schema
npm run db:reset       # Reset all tables (destructive)

# Stock Universe
node scripts/populate-universe-v2.js  # Populate from FMP (manual)

# Testing
node test/test-4phase.js              # Test 4-phase analysis
node test/test-fmp.js                 # Test FMP integration
```

## Deployment

Deployed on Railway with auto-deploy from `main` branch.

**Railway configuration:**
- Build command: (none, uses package.json)
- Start command: `npm start`
- Environment: Set all variables from `.env`
- Database: PostgreSQL addon attached

**Manual deploy:**
```bash
git push origin main  # Triggers Railway deploy
```

## Key Constraints

**Position Sizing:**
- Max 15% per position
- Max 25% per sector
- Min 3% cash reserve

**Trading Limits:**
- Max 3 trades per day
- Max 20% portfolio drawdown

**Sector Constraint:**
- 0-3 stocks per sub-sector (combined longs + shorts)
- Enforced in Phase 4 portfolio construction

**Trade Approval:**
- 24-hour auto-expiration on pending approvals
- Email notification on new approvals
- Rejection feedback logged for learning

## Documentation

- `ARCHITECTURE.md` - Detailed system design, data flow, cron schedule
- `CLAUDE.md` - Guidance for future Claude Code sessions
- `CHANGELOG.md` - Version history and changes

## Support

For issues or questions:
- GitHub: [curlyshaan/whiskie](https://github.com/curlyshaan/whiskie)
- Email: Alert email configured in `.env`

---

**⚠️ Disclaimer:** Paper trading mode by default. Understand the strategy before deploying with real money.
