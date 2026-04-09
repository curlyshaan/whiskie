# Whiskie Trading Bot - Complete Feature List

**Autonomous AI-powered trading bot managing a $100,000 portfolio with Claude Opus 4.6**

---

## Core Trading Features

### 1. Automated Trading Execution
- **2x daily analysis**: 10:00 AM, 2:00 PM ET (full trading analysis)
- **Pre-market scan**: 9:00 AM ET (gap scanner for overnight movers)
- **End-of-day summary**: 4:30 PM ET (daily performance report)
- **Paper trading mode**: Tradier sandbox with $100k virtual funds
- **Live trading capability**: Production Tradier API integration
- **Order types supported**:
  - Market orders (emergency exits only)
  - Limit orders (default for entries)
  - Stop-loss orders (automatic risk management)
  - Stop-limit orders (controlled exit prices)
  - OCO (One-Cancels-Other) bracket orders
  - OTOCO (One-Triggers-OCO) entry with protective bracket
  - Trailing stops (lock in profits on winners)
- **Extended hours trading**: Pre-market and after-hours capability
- **Position validation**: Prevents accidental shorts, verifies order correctness
- **Trade safeguard**: Database-backed validation of all orders before execution

### 2. Long/Short Portfolio Management
- **Long positions**: 70-80% target allocation
- **Short positions**: 0-30% opportunistic shorts
- **Cash reserve**: 10-20% dry powder for opportunities
- **ETB verification**: Easy-to-Borrow status checked via Tradier API before shorting
- **Inverse stop-loss logic**: Shorts trigger on price RISE, not fall
- **Required stops for shorts**: All short positions must have stop-loss protection

### 3. AI-Powered Analysis
- **Claude Opus 4.6 with extended thinking**: 50k token budget for deep analysis
- **Multi-factor decision making**:
  - Fundamental analysis (earnings, revenue, margins, guidance)
  - Technical analysis (price action, support/resistance, momentum)
  - Sentiment analysis (news, social media, analyst ratings)
  - Market timing (intraday momentum, block trades, options flow)
- **Deep analysis triggers**:
  - Portfolio has <10 positions OR cash >25%
  - Major market events or volatility spikes
  - Earnings announcements for held positions
  - Weekly performance review (Sundays)

---

## Risk Management Features

### 4. VIX Regime-Based Position Sizing
- **Dynamic position sizing** based on market volatility:
  - **CALM** (VIX <15): 1.10x multiplier, 82% max long, 20% max short
  - **NORMAL** (VIX 15-20): 1.00x multiplier, 78% max long, 20% max short
  - **ELEVATED** (VIX 20-28): 0.75x multiplier, 65% max long, 15% max short, no new shorts
  - **FEAR** (VIX 28-35): 0.50x multiplier, 55% max long, 10% max short, no new shorts
  - **PANIC** (VIX >35): 0.25x multiplier, 45% max long, 0% short, defensive mode
- **Automatic adjustment**: All trade sizes adjusted BEFORE sector validation
- **Dynamic cash reserves**: Higher VIX = higher required cash buffer

### 5. Smart Cash Management (Feature 0)
- **Cash as context, not constraint**: Informs Claude's judgment without blocking trades
- **Four cash states**:
  - **FLUSH** (>12%): Full flexibility, deploy normally
  - **NORMAL** (5-12%): Standard operations, 10% target
  - **DEPLOYED** (0-5%): Evaluate rotation candidates before new buys
  - **ZERO** (0%): Rotate out of weaker positions to fund new opportunities
- **Rotation candidate identification**: Surfaces underperforming positions when cash is low
- **High-conviction override**: Can deploy to 0% for exceptional setups

### 6. Sector Allocation Management
- **30% max per sector** in normal conditions
- **25% max per sector** in elevated volatility (VIX >20)
- **VIX adjustment applied FIRST**: Prevents false rejections from oversized trades
- **Sector diversification**: Tracks allocation across all 11 GICS sectors
- **Automatic trade filtering**: Skips trades that would exceed sector limits

### 7. Hard-Coded Safety Limits
- **Max 3 trades per day** (configurable via MAX_DAILY_TRADES)
- **Max 12% per position** (down from 15%, configurable)
- **Max 10% per short position** (tighter due to unlimited loss risk)
- **Max 30% total short exposure** (20% initially, scales up after 60 days)
- **Max 20% portfolio drawdown** triggers defensive mode
- **Stop-loss required for all shorts**: Cannot open short without protective stop

### 8. Dynamic Stop-Loss Management
- **Automatic stop-loss calculation** based on stock type:
  - Index ETFs: -12%
  - Blue-chip: -12%
  - Large-cap: -15%
  - Mid-cap: -18%
  - Opportunistic: -20%
- **Custom lot-level stops**: Per-lot stop-loss levels stored in database
- **Trailing stops**: Automatically adjust as position appreciates
- **Short stop-loss**: Inverted logic (triggers on price RISE)
  - Index ETFs: +8%
  - Mega-cap: +10%
  - Large-cap: +12%
  - Mid-cap: +15%

### 9. Correlation Analysis
- **Prevents over-concentration**: Checks correlation with existing positions
- **Warns on high correlation**: Flags trades that increase portfolio correlation risk
- **Sector-aware**: Considers both direct correlation and sector overlap

---

## Market Data & Analysis Features

### 10. Real-Time Market Data
- **Live quotes**: Current prices for all positions and watchlist stocks
- **Intraday momentum**: 2-hour price change analysis
- **Block trade detection**: Identifies large institutional orders
- **Options sentiment**: Put/call ratio and unusual options activity
- **Volume analysis**: Confirms price movements with volume

### 11. News & Sentiment Analysis
- **Tavily API integration**: Advanced news search with depth control
- **Stock-specific news**: Company announcements, earnings, product launches
- **Sector news**: Industry trends, regulatory changes, competitive dynamics
- **Macro news**: Fed policy, economic data, geopolitical events
- **Sentiment scoring**: Positive/negative/neutral classification

### 12. Pre-Market Scanner
- **Earnings announcements**: Tracks companies reporting before market open
- **Pre-market movers**: Identifies stocks with significant pre-market movement
- **Gap analysis**: Detects gap-up/gap-down setups
- **Catalyst identification**: Links price moves to news catalysts

### 13. Technical Indicators
- **Moving averages**: 20-day, 50-day, 200-day SMA
- **RSI (Relative Strength Index)**: Overbought/oversold detection
- **Support/resistance levels**: Key price levels from historical data
- **Trend analysis**: Identifies uptrends, downtrends, consolidation
- **Volume confirmation**: Validates price moves with volume

---

## Order Management Features

### 14. Dynamic Order Modification
- **AI-driven adjustments**: Claude analyzes news and modifies stops/targets
- **Tighten stops before earnings**: Reduces risk if position is profitable
- **Widen stops on thesis strengthening**: Gives winners room to run
- **Emergency exits**: Market sell if thesis breaks completely
- **Order modification history**: Tracks all changes with reasoning

### 15. Order Status Tracking
- **Real-time order monitoring**: Tracks open, filled, cancelled, rejected orders
- **Fill price tracking**: Records actual execution prices
- **Partial fill handling**: Manages partially filled orders
- **Order expiration**: Handles day orders, GTC orders, extended hours

### 16. Position Lot Tracking
- **FIFO lot accounting**: First-in, first-out for tax optimization
- **Per-lot cost basis**: Tracks entry price for each lot
- **Per-lot stop-loss**: Individual stop levels for each lot
- **Lot-level P&L**: Calculates gain/loss per lot
- **Tax-loss harvesting ready**: Identifies lots for strategic selling

---

## Performance & Learning Features

### 17. Performance Tracking
- **Total return**: Portfolio value change over time
- **Benchmark comparison**: Performance vs S&P 500
- **Win rate**: Percentage of profitable trades
- **Profit factor**: Winners vs losers ratio
- **Max drawdown**: Largest peak-to-trough decline
- **Sharpe ratio**: Risk-adjusted returns
- **Long/short exposure**: Current positioning breakdown

### 18. Performance Feedback Loop
- **Analyzes closed trades**: Reviews gain/loss reports from Tradier
- **Pattern identification**: Detects winning vs losing patterns
- **Hold duration optimization**: Learns optimal holding periods
- **Mistake detection**: Identifies repeated errors
- **Historical comparison**: Compares current positions to past performance

### 19. Weekly Performance Review
- **Sunday analysis**: Deep review of week's performance
- **Position-by-position review**: Evaluates each holding's thesis
- **Sector performance**: Analyzes sector winners and losers
- **Strategy adjustments**: Recommends tactical changes based on results

---

## Database & Persistence Features

### 20. PostgreSQL Database
- **Position tracking**: All positions stored with full history
- **Order history**: Complete record of all orders
- **Trade history**: Closed trades with P&L
- **Position lots**: FIFO lot tracking for tax optimization
- **Performance metrics**: Historical portfolio values and returns
- **Trade safeguard**: Prevents duplicate orders, tracks daily trade count

### 21. Error Recovery & Resilience
- **Automatic retry logic**: Retries failed API calls with exponential backoff
- **Graceful degradation**: Continues operating if non-critical services fail
- **Error logging**: Comprehensive error tracking and debugging
- **State recovery**: Resumes from last known good state after crashes
- **API rate limit handling**: Respects Tradier and Tavily rate limits

---

## Monitoring & Alerts Features

### 22. Email Alerts
- **Trade execution alerts**: Notification for every trade with full reasoning
- **Stop-loss triggers**: Alert when stop-loss is hit
- **Large drawdown alerts**: Email when portfolio drops 20%+
- **Error alerts**: Notification of critical errors or failures
- **Weekly summary**: Sunday email with week's performance

### 23. Logging & Audit Trail
- **Comprehensive logging**: All decisions, trades, and errors logged
- **AI reasoning capture**: Full Claude analysis saved for each decision
- **Order audit trail**: Complete history of order modifications
- **Performance logs**: Daily portfolio snapshots
- **Error logs**: Detailed error messages with stack traces

---

## Stock Universe & Screening Features

### 24. Curated Stock Universe
- **~365 stocks** across 41 sub-industries
- **Large-cap focus**: $10B+ market cap
- **Mid-cap inclusion**: $2B-10B market cap for opportunistic plays
- **US-listed only**: NYSE/NASDAQ stocks
- **All 11 GICS sectors**: Diversified sector coverage
- **ETB status tracking**: Easy-to-Borrow verification for shorting

### 25. Watchlist Management
- **Active watchlist**: Stocks under consideration for entry
- **Watchlist archiving**: Moves stale watchlist items to archive after 30 days
- **Watchlist reasoning**: Tracks why each stock is on watchlist
- **Watchlist prioritization**: Ranks watchlist by conviction and setup quality

---

## Advanced Features

### 26. Short Squeeze Detection
- **High short interest monitoring**: Tracks stocks with >20% short interest
- **Borrow rate tracking**: Monitors cost to borrow for shorts
- **Squeeze risk assessment**: Warns before shorting squeeze-prone stocks
- **Covering recommendations**: Suggests covering shorts at risk of squeeze

### 27. Earnings Analysis
- **Earnings calendar tracking**: Knows when positions report earnings
- **Pre-earnings positioning**: Adjusts stops before earnings if profitable
- **Post-earnings analysis**: Evaluates earnings results and guidance
- **Earnings surprise detection**: Identifies beats/misses vs expectations

### 28. Sector Rotation Strategy
- **Sector momentum tracking**: Identifies leading and lagging sectors
- **Rotation recommendations**: Suggests moving capital to stronger sectors
- **Sector correlation**: Avoids over-concentration in correlated sectors
- **Defensive sector shifts**: Moves to defensive sectors in downturns

### 29. Options Flow Analysis
- **Unusual options activity**: Detects large options trades
- **Put/call ratio**: Measures bullish vs bearish sentiment
- **Implied volatility**: Tracks IV for earnings and events
- **Options positioning**: Informs directional bias from options market

### 30. Market Timing Optimization
- **Avoids first 15 minutes**: Skips high-volatility market open
- **Avoids last 15 minutes**: Skips closing auction volatility
- **Avoids lunch hour**: Skips low-liquidity midday period
- **Optimal execution windows**: Trades during peak liquidity periods

---

## Configuration & Deployment Features

### 31. Environment Configuration
- **Paper/production modes**: Toggle between sandbox and live trading
- **Configurable risk limits**: Adjust position sizes, trade limits via .env
- **API key management**: Secure credential storage
- **Database configuration**: Flexible PostgreSQL connection settings

### 32. Railway Deployment
- **Auto-deploy from GitHub**: Push to deploy
- **Environment variable management**: Secure secrets in Railway
- **Automatic restarts**: Recovers from crashes
- **Log aggregation**: Centralized logging in Railway dashboard

### 33. Cron Scheduling
- **Node-cron integration**: Reliable scheduling for 3x daily runs
- **Market hours awareness**: Only runs during trading hours
- **Holiday detection**: Skips market holidays
- **Manual trigger capability**: Can run analysis on-demand

---

## Documentation & Developer Features

### 34. Comprehensive Documentation
- **README.md**: Project overview and setup
- **BETA_PLAY_STRATEGY.md**: Complete investment strategy
- **CLAUDE_NOTES.md**: Developer notes for future sessions
- **full_features.md**: This document - complete feature list
- **current_strategy.md**: In-depth strategy for various scenarios

### 35. Testing & Validation
- **Test scenarios**: Sample portfolios for testing sector allocation
- **Validation scripts**: Verify risk limits and safety checks
- **Paper trading validation**: Test strategies before live deployment

---

## Summary Statistics

- **Total Features**: 35 major feature categories
- **API Integrations**: 4 (Tradier, Claude/Quatarly, Tavily, PostgreSQL)
- **Order Types**: 7 (market, limit, stop, stop-limit, OCO, OTOCO, trailing)
- **VIX Regimes**: 5 (CALM, NORMAL, ELEVATED, FEAR, PANIC)
- **Cash States**: 4 (FLUSH, NORMAL, DEPLOYED, ZERO)
- **Safety Limits**: 7 hard-coded limits
- **Stock Universe**: ~365 stocks across 41 sub-industries
- **Analysis Schedule**: 2x daily during market hours (10 AM, 2 PM ET)
- **AI Model**: Claude Opus 4.6 with 50k token extended thinking

---

**Last Updated**: April 8, 2026  
**Version**: 2.0 (includes Feature 0 - Smart Cash Management and sector allocation fix)
