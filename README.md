# Whiskie - AI Trading Bot

**Autonomous AI-powered stock trading bot managing a $100,000 portfolio**

---

## 🎯 What is Whiskie?

Whiskie is an intelligent trading bot that uses Claude AI (Opus with extended thinking) to make professional investment decisions. It analyzes market data, news, economic indicators, and company fundamentals to build and manage a diversified stock portfolio.

**Key Features:**
- 🤖 AI-driven investment decisions using Claude Opus 4.6
- 📊 Multi-factor analysis (fundamentals, technicals, sentiment, timing)
- 🛡️ Built-in risk management with dynamic stop-loss automation
- 📧 Email alerts for trade execution
- 📈 Performance tracking vs S&P 500 benchmark
- 🧪 Paper trading mode (Tradier sandbox with $100k virtual funds)
- 🎯 Long/short capability with ETB verification
- 🔄 Dynamic order management (modify stops based on news/events)
- 📊 Advanced order types (limit, stop, stop-limit, OCO, OTOCO, trailing stop)

---

## 💼 Investment Strategy: Beta Play

**"The way to build superior long-term returns is through preservation of capital and home runs."** — Stanley Druckenmiller

### Portfolio Allocation:
- **70-80% Long Exposure:** Quality stocks with asymmetric upside potential
- **0-30% Short Exposure:** Opportunistic shorts in overvalued/deteriorating names
- **10-20% Cash:** Dry powder for opportunities and risk buffer

### Position Sizing:
- **Standard long:** 10% of portfolio
- **High conviction long:** up to 15%
- **Standard short:** 5-10% of portfolio
- **Max single short:** 10%
- **Max total shorts:** 30%

### Stock Universe:
- **~365 stocks** across 41 sub-industries
- Large-cap ($10B+) and mid-cap ($2B-10B) only
- US-listed NYSE/NASDAQ stocks
- Covers all 11 GICS sectors
- ETB (Easy-to-Borrow) status tracked for shorting

See [BETA_PLAY_STRATEGY.md](docs/BETA_PLAY_STRATEGY.md) for complete strategy documentation.

---

## 🏗️ How It Works

### Automated Trading Schedule:
1. **9:00 AM ET** - Pre-market gap scan (identifies overnight movers)
2. **10:00 AM ET** - Morning analysis (full trading analysis after market settles)
3. **2:00 PM ET** - Afternoon analysis (full trading analysis, 2 hours before close)
4. **4:30 PM ET** - End-of-day summary (daily performance report)

### Analysis Workflow:
1. **Portfolio Sync:** Fetch positions and account data from Tradier
2. **Market Data:** Get quotes, intraday momentum, block trades, options sentiment
3. **News Analysis:** Tavily search for stock-specific, sector, and macro news
4. **AI Decision:** Claude Opus with extended thinking (50k token budget)
5. **Trade Execution:** Place orders with protective stops via Tradier API
6. **Order Management:** Monitor and modify stops based on news/events

### Deep Analysis Triggers:
- Positions < 10 OR cash > 25%
- Major market events or volatility spikes
- Earnings announcements for held positions
- Weekly performance review (Sundays)

---

## 🔧 Technology Stack

- **AI:** Claude Opus 4.6 with extended thinking (50k token budget)
- **Trading API:** Tradier (sandbox for paper trading, 15-min delayed data)
- **News:** Tavily API (advanced search depth)
- **Backend:** Node.js with ES modules
- **Database:** PostgreSQL (Railway)
- **Hosting:** Railway (auto-deploy from GitHub)
- **Scheduling:** Node-cron (3x daily during market hours)

---

## 🚀 Getting Started

### Prerequisites:
- Node.js 20+
- PostgreSQL database
- Tradier account (sandbox for paper trading)
- Anthropic API key (Claude Opus)
- Tavily API key

### Installation:
```bash
# Clone or navigate to project
cd /Users/sshanoor/ClaudeProjects/Whiskie

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# Initialize database
npm run db:init

# Populate stock universe
npm run populate-stocks

# Update ETB status for shorting
npm run update-etb

# Start bot (runs 24/7)
npm start
```

---

## 📊 Advanced Features

### Order Types:
- **Market orders:** Immediate execution (emergency exits only)
- **Limit orders:** Better entry prices (default for entries)
- **Stop-loss orders:** Automatic risk management
- **Stop-limit orders:** Controlled exit prices
- **OCO (One-Cancels-Other):** Bracket orders with stop + take-profit
- **OTOCO (One-Triggers-OCO):** Entry order that triggers protective bracket
- **Trailing stops:** Lock in profits on winning positions
- **Extended hours:** Pre-market and after-hours trading

### Dynamic Order Management:
- AI analyzes news and modifies stop-loss/take-profit levels
- Tighten stops before earnings if profitable
- Widen stops if thesis strengthens
- Emergency market sell if thesis breaks
- Automatic order modification history tracking

### Shorting Capability:
- ETB (Easy-to-Borrow) verification via Tradier API
- Mid/large-cap only (market cap > $2B)
- 10% max per short position
- 30% max total short exposure
- Inverse stop-loss logic (triggers on price RISE)
- Required stop-loss for all shorts

### Market Timing:
- Avoids first 15 minutes (high volatility)
- Avoids last 15 minutes (closing auction)
- Avoids lunch hour (low liquidity)
- Intraday momentum analysis (2-hour window)
- Block trade detection (institutional activity)

### Performance Learning:
- Analyzes gain/loss reports from Tradier
- Identifies winning vs losing patterns
- Tracks hold duration optimization
- Detects repeated mistakes
- Compares current positions to historical performance

---

## ⚠️ Safety Features

### Hard-Coded Limits (Cannot Be Overridden):
- **Max 5 trades per day**
- **Max $15,000 per single trade** (15% of $100k)
- **Max $50,000 daily exposure change**
- **Max 10% per short position**
- **Max 30% total short exposure**
- **Stop-loss REQUIRED for all shorts**

### AI Guardrails:
- All trades logged with full reasoning
- Major decisions require Opus + extended thinking
- Trade safeguard validates every order
- Position validation prevents accidental shorts
- ETB verification before shorting

---

## 📈 Performance Metrics

The bot tracks:
- **Total Return:** Portfolio value change over time
- **vs S&P 500:** Benchmark comparison
- **Win Rate:** Percentage of profitable trades
- **Profit Factor:** Winners vs losers ratio
- **Max Drawdown:** Largest peak-to-trough decline
- **Sharpe Ratio:** Risk-adjusted returns
- **Long/Short Exposure:** Current positioning

---

## 📝 Documentation

- **[README.md](README.md)** - This file (overview and setup)
- **[BETA_PLAY_STRATEGY.md](docs/BETA_PLAY_STRATEGY.md)** - Complete investment strategy
- **[WHISKIE_MASTER_DOCUMENTATION.md](docs/WHISKIE_MASTER_DOCUMENTATION.md)** - Technical documentation
- **[CLAUDE_NOTES.md](CLAUDE_NOTES.md)** - Developer notes for future sessions

---

## 🔗 Scripts

```bash
# Populate stock universe from sub-industry-data.js
npm run populate-stocks

# Update ETB (Easy-to-Borrow) status for shorting
npm run update-etb

# Start bot (runs 24/7 with cron schedule)
npm start

# Initialize database schema
npm run db:init
```

---

## 📞 Support

For questions or issues, refer to documentation files or check the codebase.

---

**⚠️ Disclaimer:** This bot uses paper trading (Tradier sandbox with $100k virtual funds). Market data is delayed by 15 minutes. Always understand the strategy before deploying with real money. Past performance does not guarantee future results.
