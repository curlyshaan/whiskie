# Whiskie - AI Trading Bot Master Documentation

**Version:** 1.0 (Production)  
**Last Updated:** April 6, 2026  
**Environment:** Paper Trading (Tradier Sandbox)  
**Deployment:** Railway (https://whiskie-production.up.railway.app)

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Features](#core-features)
4. [AI Decision Engine](#ai-decision-engine)
5. [Risk Management](#risk-management)
6. [Trading Rules & Limits](#trading-rules--limits)
7. [Scheduled Operations](#scheduled-operations)
8. [Database Schema](#database-schema)
9. [API Endpoints](#api-endpoints)
10. [Email Notifications](#email-notifications)
11. [Configuration](#configuration)
12. [Deployment](#deployment)
13. [Monitoring & Logs](#monitoring--logs)

---

## Overview

Whiskie is an autonomous AI-powered trading bot that manages a $100,000 paper trading portfolio using Claude Opus 4.6 with extended thinking. The bot analyzes market conditions, executes trades, manages risk, and provides detailed reporting.

**Key Capabilities:**
- Autonomous portfolio management with AI decision-making
- Multi-factor analysis (fundamentals, technicals, news, macro)
- Automated risk management (stop-loss, take-profit, position sizing)
- Real-time market monitoring and trade execution
- Comprehensive logging and email notifications
- Tax-optimized trading strategies

---

## Architecture

### Technology Stack

**Backend:**
- Node.js 18+ with ES modules
- Express.js for API server
- PostgreSQL for data persistence
- node-cron for scheduled tasks

**AI & Analysis:**
- Claude Opus 4.6 (extended thinking, 50k token budget)
- Tavily API for news and market research
- Custom technical analysis engine

**Trading & Market Data:**
- Tradier API (sandbox for paper trading)
- Real-time quotes and market data
- Order execution and position management

**Deployment:**
- Railway (auto-deploy from GitHub)
- Environment-based configuration
- Automatic restarts and health checks

### Project Structure

```
Whiskie/
├── src/
│   ├── index.js              # Main bot orchestration
│   ├── analysis.js           # Portfolio analysis engine
│   ├── claude.js             # Claude API wrapper
│   ├── tradier.js            # Tradier API wrapper
│   ├── tavily.js             # News/research API
│   ├── risk-manager.js       # Risk management rules
│   ├── trade-safeguard.js    # Trade validation
│   ├── email.js              # Email notifications
│   ├── dashboard.js          # Web dashboard
│   ├── db.js                 # Database operations
│   ├── utils.js              # Utility functions
│   ├── earnings.js           # Earnings calendar (deprecated)
│   ├── earnings-analysis.js  # Earnings day analysis
│   ├── trimming.js           # Take-profit logic
│   ├── tax-optimizer.js      # Tax-loss harvesting
│   ├── trailing-stops.js     # Trailing stop management
│   ├── weekly-review.js      # Weekly Opus review
│   └── sub-industry-data.js  # 388 stock universe
├── fetch-earnings.py         # Python earnings fetcher
├── .env                      # Environment variables
└── package.json              # Dependencies
```

---

## Core Features

### 1. Autonomous Trading
- **Daily Analysis:** 3 analysis runs per day (10am, 12:30pm, 3:30pm ET)
- **Trade Execution:** Automatic order placement via Tradier API
- **Position Management:** Real-time monitoring of all holdings
- **Risk Controls:** Hard-coded limits enforced before every trade

### 2. Multi-Factor Analysis
- **Fundamentals:** Revenue, earnings, debt, valuation metrics
- **Technicals:** SMA50, SMA200, RSI, trend analysis
- **News:** Real-time news sentiment via Tavily
- **Macro:** Market indices (SPY, QQQ, VIX), sector rotation

### 3. Portfolio Management
- **Universe:** 388 stocks across 40 sub-industries
- **Diversification:** Max 12 positions, max 15% per position
- **Sector Limits:** Max 25% allocation per sector
- **Cash Reserve:** Minimum 3% cash at all times

### 4. Risk Management
- **Stop-Loss:** Automatic triggers based on stock type (10-20%)
- **Take-Profit:** Tiered trimming at +15%, +25%, +40%
- **Position Sizing:** Risk-adjusted based on stock volatility
- **Defensive Mode:** Activated at 15% portfolio drawdown

### 5. Tax Optimization
- **Long-Term Tracking:** Monitors days held for capital gains
- **Tax-Loss Harvesting:** Identifies loss-selling opportunities
- **Lot Management:** Separate tracking for long-term vs swing trades

### 6. Earnings Analysis
- **Calendar:** 365/388 stocks with earnings dates (94% coverage)
- **Pre-Earnings:** Analysis 1-2 days before earnings
- **Position Adjustment:** Trim/hold recommendations

---

## AI Decision Engine

### Claude Opus 4.6 Configuration

**Model:** `claude-opus-4-6-thinking`  
**Temperature:** 0.1 (focused, consistent decisions)  
**Max Tokens:** 16,000 output  
**Extended Thinking:** 50,000 token budget (3-7 minute analysis)

### Two-Phase Analysis Process

**Phase 1: Market Context & Stock Identification**
- Fetch market indices (SPY, QQQ, VIX, TLT, GLD)
- Fetch current portfolio positions
- Ask Opus to identify promising sub-industries
- Extract stock tickers from Opus response

**Phase 2: Deep Analysis with Current Prices**
- Fetch real-time quotes for identified stocks
- Provide Opus with current prices (emphasized as REAL-TIME)
- Request specific trade recommendations with:
  - Exact quantity and entry price
  - Stop-loss and take-profit levels
  - Full reasoning (fundamentals + technicals + macro)

### Decision Types Logged

- `deep-analysis` - Full portfolio review with Opus
- `stop-loss` - Stop-loss trigger evaluation
- `take-profit` - Take-profit opportunity
- `position-review` - Position down 20%+ review
- `earnings-analysis` - Pre-earnings position review
- `tax-optimization` - Tax-loss harvesting opportunity

---

## Risk Management

### Hard-Coded Safety Limits

**Position Sizing:**
- Index ETFs: 15% max
- Mega-cap: 12% max
- Large-cap: 10% max
- Mid-cap: 8% max
- Opportunistic: 5% max

**Portfolio Limits:**
- Max 12 positions total
- Max 25% per sector
- Min 3% cash reserve
- Max 3 trades per day
- Max $15,000 per trade
- Max $30,000 daily exposure

**Stop-Loss Levels (by stock type):**
- Index ETFs: -12%
- Blue-chip: -12%
- Large-cap: -15%
- Mid-cap: -18%
- Opportunistic: -20%

**Take-Profit Tiers:**
- First trim: +15% (sell 25%)
- Second trim: +25% (sell 25%)
- Third trim: +40% (sell 25%)

### Defensive Mode

**Trigger:** Portfolio down 15% or more

**Actions:**
- Reduce new position sizes by 50%
- Tighten stop-losses by 20%
- Increase cash reserve to 10%
- Focus on defensive sectors
- Avoid new opportunistic positions

---

## Trading Rules & Limits

### Trade Validation (trade-safeguard.js)

Every trade must pass these checks:

1. **Daily Trade Count:** Max 3 trades per day
2. **Single Trade Value:** Max $15,000 per trade
3. **Daily Exposure:** Max $30,000 total daily trades
4. **Sell Validation:** Must own the position being sold
5. **Quantity Check:** Sell quantity ≤ current holdings

### Order Execution

**Order Type:** Market orders (immediate execution)  
**Duration:** Day orders (expire at market close)  
**Validation:** Pre-trade risk checks + post-trade confirmation

**Safety Features:**
- Hardcoded sandbox URL (prevents accidental live trading)
- Runtime assertion check on startup
- Retry logic with exponential backoff (2s, 5s, 15s)

---

## Scheduled Operations

### Daily Schedule (Monday-Friday, ET)

**6:00 AM** - Update days held (tax tracking)
- Updates `days_held` for all position lots
- Calculates `days_to_long_term` (365 days)

**10:00 AM** - Morning Analysis
- Full portfolio analysis with Opus
- Stop-loss checks
- Take-profit checks
- Trim opportunities
- Tax optimization
- Trailing stop activation
- Earnings day analysis

**12:30 PM** - Mid-Day Check
- Same as morning analysis
- Monitors intraday price movements

**3:30 PM** - Before Close
- Same as morning analysis
- Final opportunity to act before market close

**4:30 PM** - End of Day Summary
- Daily portfolio summary email
- Auto-shutdown (saves costs)

### Weekly Schedule

**Friday 3:00 PM ET** - Earnings Calendar Refresh
- Runs `python3 fetch-earnings.py`
- Updates 365/388 stocks with earnings dates
- Uses yfinance library for reliable data

**Sunday 9:00 PM ET** - Weekly Portfolio Review
- Deep Opus analysis of weekly performance
- Strategic recommendations for next week
- Sector rotation analysis

---

## Database Schema

### Tables

**trades** - All executed trades
```sql
id, symbol, action, quantity, price, total_value, 
order_id, status, reasoning, executed_at
```

**positions** - Current holdings
```sql
id, symbol, quantity, cost_basis, current_price, sector, 
stock_type, entry_date, trimmed_1, trimmed_2, trimmed_3,
stop_loss, take_profit, investment_type, total_lots,
long_term_lots, swing_lots, thesis, days_to_long_term,
next_earnings_date, trim_history, updated_at
```

**ai_decisions** - All AI analysis and reasoning
```sql
id, decision_type, symbol, recommendation, reasoning,
model_used, confidence, executed, input_tokens,
output_tokens, total_tokens, cost_estimate,
duration_seconds, created_at
```

**alerts** - All alerts sent
```sql
id, alert_type, symbol, message, severity, sent_at
```

**portfolio_snapshots** - Daily portfolio value
```sql
id, total_value, cash, positions_value, daily_change,
total_return, sp500_return, snapshot_date, created_at
```

**earnings_calendar** - Upcoming earnings dates
```sql
id, symbol, earnings_date, earnings_time, 
source, last_updated
```

**watchlist** - Stocks to monitor
```sql
id, symbol, sub_industry, current_price, target_entry_price,
target_exit_price, why_watching, why_not_buying_now,
status, added_date, last_reviewed, price_when_added,
highest_price, lowest_price
```

**position_lots** - Individual lot tracking
```sql
id, symbol, lot_type, quantity, cost_basis, current_price,
entry_date, stop_loss, take_profit, oco_order_id, thesis,
trim_level, days_held, days_to_long_term, 
trailing_stop_active, last_reviewed, created_at
```

---

## API Endpoints

### Dashboard Routes

**GET /** - Main dashboard
- Today's analyses
- Current positions
- Recent trades
- Portfolio snapshot

**GET /logs** - Detailed system logs
- AI decisions with token usage
- Trade executions with order IDs
- Alerts with severity levels
- Auto-refreshes every 2 minutes

**GET /api/latest** - Latest analysis (JSON)

**GET /api/today** - All today's analyses (JSON)

**GET /api/watchlist** - Watchlist with earnings dates (JSON)

**POST /analyze** - Manual analysis trigger
- Runs full daily analysis immediately
- Returns status message

---

## Email Notifications

### Email Types

**Trade Recommendations** - Requires approval
- Action, symbol, quantity, price
- Stop-loss and take-profit levels
- AI reasoning
- Dashboard link for approval
- 10-minute expiration

**Trade Confirmations** - Execution confirmation
- Trade details and order ID
- Final execution price
- Risk management levels

**Position Alerts** - Position down 20%+
- Current loss percentage
- AI analysis and recommendation

**Stop-Loss Alerts** - Stop-loss triggered
- Position details
- Sell recommendation

**Daily Summary** - End of day (4:30 PM ET)
- Portfolio value and daily change
- Top performers
- Positions needing attention
- AI recommendations

**Weekly Report** - Sunday evening
- Weekly performance vs S&P 500
- Trade statistics and win rate
- Sector performance
- AI insights and next week strategy

**Error Alerts** - System errors
- Error context and stack trace
- Timestamp

### Email Configuration

**Provider:** Gmail SMTP (port 587, STARTTLS)  
**Retry Logic:** 3 attempts with 5-second delay  
**Timeout:** 60s connection, 30s greeting, 60s socket

---

## Configuration

### Environment Variables

```bash
# Trading
NODE_ENV=paper
TRADIER_SANDBOX_API_KEY=your_key
TRADIER_SANDBOX_ACCOUNT_ID=your_account
INITIAL_CAPITAL=100000

# AI
QUATARLY_API_KEY=your_claude_key
QUATARLY_BASE_URL=https://api.anthropic.com
TAVILY_API_KEY=your_tavily_key

# Database
DATABASE_URL=postgresql://user:pass@host:5432/db

# Email
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
EMAIL_FROM=your_email@gmail.com
ALERT_EMAIL=recipient@email.com

# Dashboard
DASHBOARD_URL=https://whiskie-production.up.railway.app

# Risk Limits (optional, defaults shown)
MAX_POSITION_SIZE=0.15
MAX_DAILY_TRADES=3
MAX_PORTFOLIO_DRAWDOWN=0.20
MIN_CASH_RESERVE=0.03
MAX_SECTOR_ALLOCATION=0.25
```

---

## Deployment

### Railway Configuration

**Build Command:** `npm install`  
**Start Command:** `node src/index.js`  
**Auto-Deploy:** Enabled (pushes to main branch)  
**Health Check:** HTTP endpoint on PORT

### Deployment Process

1. Push code to GitHub main branch
2. Railway detects changes and triggers build
3. Installs dependencies
4. Starts application
5. Runs database initialization
6. Schedules cron jobs
7. Bot begins operation

### Post-Deployment Verification

- Check Railway logs for startup messages
- Verify cron jobs are scheduled
- Test dashboard at production URL
- Confirm database connection
- Validate email configuration

---

## Monitoring & Logs

### Dashboard Access

**Main Dashboard:** https://whiskie-production.up.railway.app  
**Logs Page:** https://whiskie-production.up.railway.app/logs

### Log Categories

**AI Decisions:**
- Decision type and symbol
- Recommendation text (first 200 chars)
- Model used and token count
- Timestamp

**Trade Executions:**
- Action, symbol, quantity, price
- Total value and status
- Order ID
- Reasoning (first 150 chars)

**Alerts:**
- Alert type and symbol
- Message and severity
- Timestamp

### Railway Logs

Access via Railway dashboard for:
- Application startup logs
- Cron job execution
- Error stack traces
- API request logs

---

## Key Features Summary

### ✅ Implemented & Working

1. **Autonomous Trading** - Daily analysis and execution
2. **Risk Management** - Stop-loss, take-profit, position sizing
3. **AI Decision Engine** - Claude Opus with extended thinking
4. **Multi-Factor Analysis** - Fundamentals, technicals, news, macro
5. **Email Notifications** - All trade and alert types
6. **Dashboard** - Real-time portfolio view with logs
7. **Earnings Calendar** - 365/388 stocks (94% coverage)
8. **Tax Optimization** - Long-term tracking and loss harvesting
9. **Trailing Stops** - Automatic activation and updates
10. **Weekly Review** - Deep Opus analysis every Sunday
11. **Trade Safeguards** - Hard-coded limits enforced
12. **Database Persistence** - All trades, decisions, alerts logged
13. **Markdown Rendering** - Proper formatting including tables
14. **Thinking Block Stripping** - Clean analysis output

### 🎯 Production Ready

- All critical bugs fixed
- Cost basis calculations correct
- Stop-loss logic validated
- Email system operational
- Earnings calendar populated
- Dashboard fully functional
- Logs endpoint available
- Cron jobs scheduled
- Safety limits enforced

---

## Version History

**v1.0 (April 6, 2026)** - Production Release
- Fixed cost basis calculation (Tradier returns total cost)
- Fixed yfinance earnings fetcher (365/388 stocks)
- Added /logs endpoint for detailed monitoring
- Fixed markdown table rendering
- Added Friday 3pm earnings refresh cron
- Stripped thinking blocks from analysis output
- Improved dashboard markdown formatting
- All safety checks and limits enforced

---

## Support & Maintenance

### Regular Maintenance

- **Weekly:** Review earnings calendar accuracy
- **Monthly:** Audit trade performance and AI decisions
- **Quarterly:** Review and update stock universe

### Known Limitations

- Paper trading only (sandbox environment)
- No after-hours trading
- Market orders only (no limit orders)
- 388 stock universe (not full market)
- Email rate limits (Gmail SMTP)

### Future Enhancements (Not Implemented)

- Live trading mode (requires careful testing)
- Options trading
- Crypto integration
- Multi-account support
- Mobile app
- Real-time WebSocket updates
- Advanced charting

---

## Contact & Resources

**GitHub:** https://github.com/curlyshaan/whiskie  
**Dashboard:** https://whiskie-production.up.railway.app  
**Logs:** https://whiskie-production.up.railway.app/logs  
**Deployment:** Railway (auto-deploy enabled)

---

**Document Version:** 1.0  
**Last Updated:** April 6, 2026  
**Status:** Production - Fully Operational
