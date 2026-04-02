# Whiskie - AI Trading Bot

**Autonomous AI-powered stock trading bot managing a $100,000 portfolio**

---

## 🎯 What is Whiskie?

Whiskie is an intelligent trading bot that uses Claude AI (Opus with extended thinking) to make professional investment decisions. It analyzes market data, news, economic indicators, and company fundamentals to build and manage a diversified stock portfolio.

**Key Features:**
- 🤖 AI-driven investment decisions using Claude Opus
- 📊 Multi-factor analysis (70% fundamentals, 30% technicals)
- 🛡️ Built-in risk management and stop-loss automation
- 📧 Email alerts before every trade
- 📈 Performance tracking vs S&P 500 benchmark
- 🧪 Paper trading mode for testing strategies

---

## 💼 Investment Strategy

### Portfolio Allocation:
- **60% Core Foundation:** Stable blue-chips and index ETFs
- **25% Growth Satellite:** High-growth stocks
- **15% Opportunistic:** Tactical plays on market opportunities

### Risk Parameters:
- **Max positions:** 10-12 stocks
- **Max per position:** 15% of portfolio
- **Stop-loss:** 10-20% depending on stock type
- **Time horizon:** Months to years (not day trading)
- **Risk tolerance:** Moderate

### Sector Diversification:
- Technology: 20-22%
- Index ETFs: 16-18%
- Healthcare: 13-15%
- Financials: 10-12%
- Consumer Staples: 8-10%
- Industrials: 8-10%
- Energy: 6-8%
- Cash Reserve: 5%

---

## 🏗️ How It Works

1. **Daily Analysis (9 AM ET):**
   - Fetch portfolio from Tradier
   - Get market data and news
   - Analyze with Claude Sonnet (quick check)

2. **Deep Analysis (when needed):**
   - Major decisions trigger Claude Opus + extended thinking
   - Multi-factor analysis of fundamentals and technicals
   - Risk assessment and position sizing

3. **Trade Execution:**
   - Email you with trade recommendations
   - Wait for your approval
   - Execute approved trades via Tradier API
   - Log everything to database

4. **Performance Tracking:**
   - Daily portfolio value updates
   - Weekly performance reports
   - Monthly strategy reviews
   - Quarterly rebalancing

---

## 🔧 Technology Stack

- **AI:** Claude Opus 4-6 (with extended thinking)
- **Trading API:** Tradier (real-time data + execution)
- **News:** Tavily API
- **Economic Data:** FRED API (Federal Reserve)
- **Backend:** Node.js
- **Database:** PostgreSQL
- **Hosting:** Railway
- **Scheduling:** Cron jobs

---

## 🚀 Getting Started

### Prerequisites:
- Node.js 20+
- PostgreSQL database
- Tradier account (paper trading or live)
- Claude API key (via Quatarly)
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

# Start in paper trading mode
npm run start:paper
```

---

## 📊 Performance Metrics

The bot tracks:
- **Total Return:** Portfolio value change over time
- **vs S&P 500:** Benchmark comparison
- **Sharpe Ratio:** Risk-adjusted returns
- **Max Drawdown:** Largest peak-to-trough decline
- **Win Rate:** Percentage of profitable trades
- **Sector Performance:** Which sectors are outperforming

---

## ⚠️ Safety Features

### Hard-Coded Limits:
- Max 15% per position (cannot be overridden)
- Max 3 trades per day
- Max 20% portfolio drawdown triggers defensive mode
- Min 3% cash reserve at all times
- Max 25% in any single sector

### AI Guardrails:
- All trades require email approval initially
- Stop-losses are mental (not automatic) to avoid flash crashes
- Major decisions (>$10k) require Opus analysis
- Every decision is logged with full reasoning

---

## 📈 Current Status

**Phase:** Strategy Design Complete ✅  
**Next:** Infrastructure Setup  
**Model Used:** Claude Opus 4-6 with Extended Thinking  
**Budget:** $35/month for Claude API  

---

## 📝 Documentation

- **CLAUDE_NOTES.md** - Comprehensive technical notes for future sessions
- **INVESTMENT_STRATEGY.md** - Full strategy designed by Claude Opus
- **README.md** - This file

---

## 🔗 Related Projects

- **Nora** - AI investing learning assistant (educational tool, no real trades)
- **Whiskie** - AI trading bot (this project - real money, autonomous)

---

## ⚡ Quick Commands

```bash
# Paper trading mode (test with fake money)
npm run start:paper

# Live trading mode (real money - use with caution!)
npm run start:live

# View performance dashboard
npm run dashboard

# Generate monthly report
npm run report:monthly

# Rebalance portfolio
npm run rebalance
```

---

## 📞 Support

For questions or issues, refer to CLAUDE_NOTES.md for detailed technical documentation.

---

**⚠️ Disclaimer:** This bot manages real money. Always start with paper trading, understand the strategy, and never invest more than you can afford to lose. Past performance does not guarantee future results.
