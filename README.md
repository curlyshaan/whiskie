# Whiskie - AI Portfolio Manager

Autonomous trading bot powered by Claude Opus 4 with extended thinking. Manages a $100k portfolio using dynamic risk management, GICS asset class allocation, and VIX regime adaptation.

## Quick Start

```bash
npm install
cp .env.example .env
# Configure environment variables
npm start
```

## Core Features

### 1. GICS Asset Class Allocation
- **11 GICS sectors** with 350+ stocks (replaces 41 sub-industries)
- **Dynamic limits**: Base × Rate Environment × VIX Regime
- **Example**: Technology 30% base → 36% (low rates) → 27% (elevated VIX)
- **Hard caps**: 40% max per asset class, 4 stocks max per class
- **Prevents concentration**: No more 60% tech via 30% semiconductors + 30% software

### 2. VIX Regime Adaptation
- **CALM** (VIX <15): 110% position sizes, 30% asset class limits
- **NORMAL** (VIX 15-20): 100% position sizes, 30% limits
- **ELEVATED** (VIX 20-28): 75% position sizes, 25% limits
- **FEAR** (VIX 28-35): 50% position sizes, defensive mode
- **PANIC** (VIX >35): 25% position sizes, no new positions

### 3. Intelligent Order Routing
- **Market open**: Market buy → OCO (stop-loss + take-profit)
- **Market closed**: OTOCO (limit buy triggers OCO when filled)
- Prevents "OCO rejected" errors outside trading hours

### 4. Two-Phase Deep Analysis
- **Phase 1**: Opus identifies 15-20 stocks to analyze (2-3 min)
- **Phase 2**: Opus makes final trade decisions with real-time prices (3-5 min)
- Extended thinking with 50,000 token budget

### 5. Risk Management
- Max 12% per position (10% for shorts)
- 10% minimum cash reserve
- Stop-losses: 12-20% based on stock type
- Correlation analysis prevents overconcentration

## Schedule

**Market Hours (Mon-Fri)**
- 10:00 AM ET - Morning analysis + trade execution
- 2:00 PM ET - Afternoon analysis + trade execution
- 4:30 PM ET - Daily summary email

**Weekly**
- Friday 3:00 PM ET - Earnings calendar refresh
- Sunday 9:00 PM ET - Deep weekly review (Opus)

## Environment Variables

```bash
# Trading
TRADIER_SANDBOX_API_KEY=your_key
TRADIER_SANDBOX_ACCOUNT_ID=your_account
NODE_ENV=paper  # paper or production

# AI
ANTHROPIC_API_KEY=your_key

# Email
RESEND_API_KEY=your_key
ALERT_EMAIL=your@email.com

# Database
DATABASE_URL=postgresql://...

# Risk Limits
MAX_POSITION_SIZE=0.12
MAX_TOTAL_SHORT_EXPOSURE=0.25
MIN_CASH_RESERVE=0.10
RATE_ENVIRONMENT=NEUTRAL_RATES  # LOW_RATES, NEUTRAL_RATES, HIGH_RATES
```

## Database Setup

```bash
# Fresh start (recommended for asset class migration)
psql $DATABASE_URL -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npm start  # Auto-creates tables with asset_class columns
```

## Architecture

```
src/
├── index.js              # Main bot orchestration
├── claude.js             # Claude API with extended thinking
├── tradier.js            # Trading API (OCO/OTOCO routing)
├── risk-manager.js       # Position sizing, stop-losses
├── allocation-manager.js # Dynamic asset class limits
├── asset-class-data.js   # GICS mappings + multipliers (350+ stocks)
├── vix-regime.js         # Volatility-based adjustments
├── analysis.js           # Technical indicators
├── sector-rotation.js    # Relative strength tracking
└── db.js                 # PostgreSQL operations
```

## GICS Asset Classes (350+ Stocks)

- **Technology** (~70 stocks): NVDA, TSM, MSFT, ORCL, PANW, CRWD, etc.
- **Communication Services** (~30): META, GOOGL, NFLX, DIS, etc.
- **Healthcare** (~50): LLY, ABBV, UNH, TMO, VRTX, etc.
- **Financials** (~50): JPM, BAC, V, MA, BLK, etc.
- **Industrials** (~40): RTX, BA, CAT, UNP, etc.
- **Consumer Discretionary** (~40): AMZN, TSLA, HD, MCD, etc.
- **Consumer Staples** (~30): WMT, COST, PG, KO, etc.
- **Energy** (~20): XOM, CVX, COP, SLB, etc.
- **Utilities** (~15): NEE, DUK, SO, etc.
- **Real Estate** (~15): PLD, AMT, EQIX, etc.
- **Materials** (~15): LIN, APD, NUE, etc.

## Rate Environment Multipliers

- **LOW_RATES** (<3%): Tech +20%, Financials -15%, Real Estate +0%
- **NEUTRAL_RATES** (3-5%): All 1.0x (no adjustment)
- **HIGH_RATES** (>5%): Tech -20%, Financials +25%, Real Estate -30%

## Cash Management

- **FLUSH** (>12%): Full deployment flexibility
- **NORMAL** (5-12%): Prefer not to drop below 5%
- **DEPLOYED** (<5%): Evaluate rotation candidates before new buys
- **ZERO** (0%): Rotate only, no new positions

## Manual Triggers

```bash
# Trigger analysis via API
curl -X POST https://your-app.railway.app/analyze

# Check portfolio status
curl https://your-app.railway.app/status
```

## Deployment (Railway)

```bash
# Connect to Railway
railway link

# Set environment variables
railway variables set ANTHROPIC_API_KEY=...

# Deploy
git push railway main
```

## Safety Features

- **Paper trading mode** by default (sandbox API)
- **Trade safeguards**: Max 3 trades/day, duplicate prevention
- **Stop-loss enforcement**: Automatic exit on breach
- **Correlation checks**: Warns on high correlation (>0.7)
- **Email alerts**: All trades, errors, daily summaries

## Monitoring

- **Dashboard**: http://localhost:8080 (when running locally)
- **Logs**: Railway dashboard or `railway logs`
- **Email**: Daily summaries + trade confirmations
- **Database**: Query positions, trades, analysis history

## Documentation

- **README.md** - This file (overview and quick start)
- **CLAUDE_NOTES.md** - Technical implementation details
- **current_strategy.md** - Investment strategy and philosophy

## Support

Issues: Create GitHub issue or check documentation files.

---

**⚠️ Disclaimer:** Paper trading mode by default. Market data delayed 15 minutes. Understand the strategy before deploying with real money.
