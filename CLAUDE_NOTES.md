# Whiskie - AI Trading Bot - Claude Notes

**Last Updated:** April 2, 2026  
**Project Status:** Initial Setup - Strategy Design Phase  
**Model Used:** Claude Opus 4-6 with Extended Thinking

---

## 🎯 Project Purpose

**Whiskie** is an autonomous AI-powered trading bot that manages a $100,000 stock portfolio using:
- **Tradier API** for trading execution and market data
- **Claude Opus** for investment analysis and decision-making
- **Tavily** for news/sentiment analysis
- **FRED API** for economic indicators
- **Multi-factor analysis** (fundamentals + technicals)

**Key Difference from Nora:**
- **Nora** = Educational AI investing assistant (learning tool, no real trades)
- **Whiskie** = Autonomous trading bot (real money, real trades)

---

## 👤 User Profile & Requirements

### Investment Parameters:
- **Capital:** $100,000 (starting in paper trading mode)
- **Risk Tolerance:** Moderate
- **Time Horizon:** Months to years (NOT day trading)
- **Experience:** User is novice, but AI acts as professional trader
- **Preferences:**
  - Regular stocks only (no crypto, no penny stocks)
  - 10-12 positions maximum
  - Max 15% per position
  - Open to both growth and value stocks
  - Skeptical of index funds (thinks they're "too slow")

### Trading Rules:
- **Stop-Loss:** AI decides, but email alert when stock down 20%+
- **Take-Profit:** AI decides with reasoning
- **Manual Override:** User can intervene on 20%+ drops
- **Email Alerts:** Before every trade execution
- **Paper Trading First:** Test strategy before going live

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│  Cron Job (Railway)                     │
│  Runs daily at 9:00 AM ET              │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Whiskie Bot (Node.js)                  │
│                                          │
│  Daily Analysis:                        │
│  1. Fetch portfolio (Tradier)           │
│  2. Get market data (Tradier)           │
│  3. Search news (Tavily)                │
│  4. Get economic data (FRED)            │
│  5. Analyze with Claude Sonnet (cheap)  │
│  6. If major decision needed:           │
│     → Call Claude Opus + thinking       │
│  7. Email trade recommendations         │
│  8. Wait for user approval              │
│  9. Execute approved trades (Tradier)   │
│  10. Log everything to PostgreSQL       │
└─────────────────────────────────────────┘
```

---

## 📊 Investment Strategy (Designed by Claude Opus)

### Core Philosophy: Core/Satellite Approach
- **60% Core Foundation:** Stability + steady compounding (Low-Moderate risk)
- **25% Growth Satellite:** Capital appreciation (Moderate-High risk)
- **15% Opportunistic:** Tactical plays (Higher risk)

### Sector Allocation:
| Sector | Target % | $ Amount |
|--------|---------|----------|
| Technology | 20-22% | $20-22K |
| Broad Index ETFs | 16-18% | $16-18K |
| Healthcare | 13-15% | $13-15K |
| Financials | 10-12% | $10-12K |
| Consumer Staples | 8-10% | $8-10K |
| Industrials | 8-10% | $8-10K |
| Energy | 6-8% | $6-8K |
| Cash Reserve | 5% | $5K |

### Position Sizing Tiers:
- **Index ETFs:** Max 15%
- **Mega-Cap Blue Chips:** Max 10-12%
- **Large-Cap Growth:** Max 8-10%
- **Mid-Cap:** Max 6-8%
- **Opportunistic:** Max 4-5%

### Stop-Loss Strategy:
- **Index ETFs:** -10 to -12%
- **Blue Chip:** -10 to -12%
- **Large-Cap Growth:** -13 to -15%
- **Mid-Cap:** -15 to -18%
- **Opportunistic:** -18 to -20%

### Take-Profit Strategy (Scaling Out):
- **+15-20% gain:** Sell 20-25% of position
- **+25-30% gain:** Sell another 20-25%
- **+40%+ gain:** Sell another 25%
- **Remainder:** Trail with 15-20% trailing stop

### Rebalancing:
- **Weekly:** Quick scan (5 min)
- **Monthly:** Position review (30 min)
- **Quarterly:** Full rebalance (1-2 hours) - PRIMARY
- **Event-Driven:** Immediate action on major news

### Technical vs Fundamental Weight:
- **70% Fundamental:** What to buy (revenue growth, P/E, cash flow, moat)
- **30% Technical:** When to buy (200-day MA, RSI, support/resistance, volume)

---

## 🔑 API Keys & Services

### Already Have:
1. **Tradier API:** `NzqeofwwmWK94Adi2E9rghG33mKZ`
   - 120k calls/month free
   - Real-time quotes, historical data, trading execution
   
2. **Quatarly (Claude API):** `qua-13iwudxg7brvd4quvuofuockowsmj4cl`
   - Base URL: `https://api.quatarly.cloud/`
   - Models available:
     - `claude-opus-4-6-thinking` (expensive, deep analysis)
     - `claude-sonnet-4-6-thinking` (cheaper, daily use)
     - `claude-haiku-4-5-20251001` (cheapest, quick checks)

3. **Tavily API:** (from Nora project)
   - 1000 searches/month free
   - Web search for news

### Need to Add:
4. **FRED API** (Federal Reserve Economic Data)
   - FREE - no key needed for basic use
   - Economic indicators (interest rates, inflation, GDP)

5. **Alpha Vantage** (optional)
   - FREE tier: 500 calls/day
   - Company fundamentals

---

## 💰 Budget & Token Usage

### Claude API Budget: $35/month

**Token Allocation:**
- Daily Sonnet analysis: ~$0.50/day = $15/month
- Weekly Opus deep thinking: ~$4/analysis × 4 = $16/month
- **Total: ~$31/month** ✅

**Models to Use:**
- **Daily routine:** Sonnet (cheap, fast)
- **Major decisions:** Opus + extended thinking (expensive, thorough)
- **Quick checks:** Haiku (very cheap)

---

## 📁 Project Structure

```
Whiskie/
├── CLAUDE_NOTES.md           # This file - comprehensive notes
├── README.md                 # User-facing documentation
├── INVESTMENT_STRATEGY.md    # Full strategy from Opus
├── package.json              # Dependencies
├── .env                      # API keys (DO NOT COMMIT)
├── .gitignore               # Exclude .env, node_modules
│
├── src/
│   ├── index.js             # Main bot entry point
│   ├── tradier.js           # Tradier API wrapper
│   ├── claude.js            # Claude API calls (Opus/Sonnet)
│   ├── analysis.js          # Market analysis logic
│   ├── risk-manager.js      # Safety checks & position sizing
│   ├── email-alerts.js      # Notification system
│   ├── db.js                # PostgreSQL for trade logging
│   └── utils.js             # Helper functions
│
├── config/
│   ├── strategy.json        # Investment strategy parameters
│   └── risk-limits.json     # Hard-coded safety limits
│
└── logs/
    ├── trades.log           # All executed trades
    ├── decisions.log        # AI reasoning for each decision
    └── performance.log      # Daily portfolio performance
```

---

## 🚀 Development Phases

### Phase 1: Strategy Design ✅ (CURRENT)
- [x] Define investment philosophy
- [x] Get Opus to design comprehensive strategy
- [x] Document all parameters

### Phase 2: Infrastructure Setup (NEXT)
- [ ] Initialize Node.js project
- [ ] Set up Tradier API integration
- [ ] Set up Claude API integration
- [ ] Create database schema
- [ ] Build email alert system

### Phase 3: Core Logic
- [ ] Portfolio analysis engine
- [ ] Multi-factor analysis (fundamentals + technicals)
- [ ] Risk management system
- [ ] Position sizing calculator
- [ ] Stop-loss/take-profit automation

### Phase 4: Paper Trading
- [ ] Connect to Tradier sandbox
- [ ] Run bot for 1-3 months
- [ ] Track performance vs S&P 500
- [ ] Refine strategy based on results

### Phase 5: Live Trading
- [ ] Switch to live Tradier account
- [ ] Start with smaller capital ($10k?)
- [ ] Scale up if performance is good

---

## ⚠️ Safety Mechanisms

### Hard-Coded Limits (Cannot be overridden by AI):
1. **Max trade size:** 15% of portfolio
2. **Max daily trades:** 3
3. **Max portfolio drawdown:** 20% (triggers defensive mode)
4. **Min cash reserve:** 3%
5. **Max single sector:** 25%
6. **Require email approval:** For all trades initially

### AI Decision Guardrails:
- Stop-loss triggers are suggestions, not automatic
- Take-profit levels reviewed before execution
- Major position changes (>$10k) require Opus analysis
- All reasoning logged for audit trail

---

## 📈 Performance Tracking

### Metrics to Track:
- Daily portfolio value
- Total return vs S&P 500
- Sharpe ratio (risk-adjusted return)
- Max drawdown
- Win rate (% of profitable trades)
- Average gain per winning trade
- Average loss per losing trade
- Sector performance breakdown

### Reporting:
- **Daily:** Email summary (portfolio value, day's change)
- **Weekly:** Performance report vs benchmark
- **Monthly:** Full analysis with AI insights
- **Quarterly:** Strategy review and adjustments

---

## 🔧 Technical Stack

- **Language:** Node.js (JavaScript)
- **Database:** PostgreSQL (for trade history)
- **Hosting:** Railway (same as Nora)
- **Scheduling:** Cron jobs (daily at 9 AM ET)
- **Email:** Nodemailer (same as Nora)
- **APIs:**
  - Tradier (trading + market data)
  - Quatarly/Claude (AI analysis)
  - Tavily (news search)
  - FRED (economic data)

---

## 🎓 Key Learnings from Strategy Design

1. **Index funds aren't slow** - They beat 85-90% of professionals over 15 years
2. **Position sizing matters more than stock picking** - Proper sizing prevents catastrophic losses
3. **Scaling out > all-or-nothing** - Take profits in tiers, let winners run
4. **70/30 fundamental/technical** - Fundamentals for what to buy, technicals for when
5. **Rebalance quarterly** - Not too frequent (taxes/fees), not too rare (drift)
6. **Cash is a position** - 5% cash reserve for opportunities
7. **Stop-losses are mental, not automatic** - Avoid flash crash triggers
8. **Trailing stops after 20% gain** - Create "free trades" where you can't lose

---

## 📝 Next Steps (When Session Resumes)

1. Wait for full INVESTMENT_STRATEGY.md to be generated
2. Initialize Node.js project with package.json
3. Create .env file with API keys
4. Build Tradier API wrapper
5. Build Claude API wrapper
6. Create database schema
7. Implement email alerts
8. Build core analysis engine

---

## 🔗 Related Projects

- **Nora:** `/Users/sshanoor/ClaudeProjects/Nora` - AI investing learning assistant (educational, no real trades)
- **Whiskie:** `/Users/sshanoor/ClaudeProjects/Whiskie` - AI trading bot (real money, autonomous)

---

## 📞 User Preferences

- Wants AI to make professional decisions (user is novice)
- Prefers email alerts for 20%+ drops with AI reasoning
- Manual approval for trades initially
- Emphasis on months-to-years horizon (not day trading)
- Moderate risk tolerance
- No crypto, no penny stocks
- Open to learning but trusts AI expertise

---

**Remember:** This is REAL MONEY. Every decision must be logged, every trade must have clear reasoning, and user safety is paramount. Start with paper trading, prove the strategy works, then go live.
