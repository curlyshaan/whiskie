# Whiskie Trading Bot - Complete Documentation

## Overview
AI-powered trading bot using Claude Opus for analysis, Tradier for execution, FMP/Yahoo Finance for data.

## Architecture

### 4-Phase Analysis System
1. **Phase 1: Pre-ranking** (1-2 min) - Screen 15-20 longs + 15-20 shorts from multiple sources
2. **Phase 2: Long Analysis** (3-5 min, 50k tokens) - Deep analysis of long candidates
3. **Phase 3: Short Analysis** (3-5 min, 50k tokens) - Deep analysis of short candidates  
4. **Phase 4: Portfolio Construction** (1-2 min, 20k tokens) - Build final portfolio with 0-3 stocks per sub-sector

### Stock Profile System
- **Biweekly deep research** (Saturday 10am, even weeks) - Build comprehensive profiles for watchlist stocks
- **Profiles include**: business_model, moats, competitive_advantages, fundamentals, risks, catalysts
- **Daily runs**: Fresh profiles (<14 days) = incremental updates, Stale profiles (>14 days) = deeper refresh
- **Manual trigger**: `POST /api/trigger-deep-research`

### Data Sources
- **FMP**: 3-key rotation (750 calls/day), 90-day cache, fundamentals/financials
- **Yahoo Finance**: Historical data, short interest
- **Tradier**: Real-time quotes, order execution
- **Tavily**: News search

## Key Features

### Trading
- Long/short equity portfolio ($100k paper trading)
- 0-3 stocks per sub-sector constraint
- Market regime detection (bull/bear/neutral)
- Trade approval queue with manual review
- OCO orders (stop-loss + take-profit)

### Risk Management
- Position sizing based on conviction + volatility
- Sector diversification limits
- VIX regime monitoring
- Correlation analysis
- Trailing stops

### Analysis
- Weekly portfolio review (Sunday 9pm)
- Earnings analysis
- Sector rotation tracking
- Trend learning from past decisions
- Performance analytics

## Cron Schedule (America/New_York)

| Time | Job |
|------|-----|
| 9:00 AM (Mon-Fri) | Pre-market gap scan |
| 10:00 AM (Mon-Fri) | Daily analysis |
| 2:00 PM (Mon-Fri) | Afternoon analysis |
| 4:30 PM (Mon-Fri) | End-of-day summary |
| 3:00 PM (Friday) | Earnings calendar refresh |
| 9:00 PM (Saturday) | Fundamental screening (first half) |
| 10:00 AM (Saturday, even weeks) | Biweekly deep stock research |
| 9:00 PM (Sunday) | Full weekly screening + review |
| Every 5 min (9am-4pm) | Process approved trades |
| Hourly | Expire old trade approvals |

## Database Schema

### Core Tables
- `trades` - Trade execution history
- `positions` - Current holdings (long/short)
- `portfolio_snapshots` - Daily portfolio state
- `analyses` - Opus analysis results
- `trade_approvals` - Pending trade approvals

### Watchlists
- `watchlist` - Main watchlist with entry/exit targets
- `value_watchlist` - Fundamental screening results
- `quality_watchlist` - Quality stocks for dip-buying
- `overvalued_watchlist` - Overextended stocks for shorting

### Learning
- `stock_analysis_history` - Past trade decisions
- `stock_profiles` - Comprehensive research dossiers
- `market_trend_patterns` - Pattern recognition
- `learning_insights` - Extracted insights

## API Endpoints

### Dashboard
- `GET /` - Main dashboard
- `GET /approvals` - Trade approval queue
- `POST /api/approvals/:id/approve` - Approve trade
- `POST /api/approvals/:id/reject` - Reject trade

### Manual Triggers
- `POST /api/trigger-deep-research` - Run biweekly deep research

## Environment Variables

```bash
# Trading
TRADIER_API_KEY=xxx
TRADIER_ACCOUNT_ID=xxx
NODE_ENV=paper  # or production

# Data
FMP_API_KEY_1=xxx
FMP_API_KEY_2=xxx
FMP_API_KEY_3=xxx
TAVILY_API_KEY=xxx

# AI
ANTHROPIC_API_KEY=xxx

# Database
DATABASE_URL=postgresql://...

# Email
SENDGRID_API_KEY=xxx
ALERT_EMAIL=xxx
```

## File Structure

```
src/
├── index.js              # Main orchestration
├── claude.js             # Claude API integration
├── tradier.js            # Tradier API
├── fmp.js                # FMP API with 3-key rotation
├── fmp-cache.js          # FMP caching layer
├── yahoo-finance.js      # Yahoo Finance API
├── tavily.js             # Tavily news search
├── stock-profiles.js     # Stock profile system
├── pre-ranking.js        # Phase 1 screening
├── fundamental-screener.js
├── quality-screener.js
├── overvalued-screener.js
├── opus-screener.js
├── risk-manager.js
├── trade-approval.js
├── trade-executor.js
├── order-manager.js
├── short-manager.js
├── trend-learning.js
├── weekly-review.js
├── performance-analyzer.js
├── sector-rotation.js
├── vix-regime.js
├── macro-calendar.js
├── allocation-manager.js
├── db.js                 # Database layer
└── dashboard.js          # Web UI

test/
├── test-4phase.js
├── test-fmp.js
├── test-yahoo-finance.js
└── ...

scripts/
├── reset-database.js
├── sync-positions.js
└── ...
```

## Development

### Setup
```bash
npm install
cp .env.example .env  # Configure environment
node src/index.js     # Start bot
```

### Testing
```bash
node test-4phase.js           # Test 4-phase system
node test-fmp.js              # Test FMP integration
node test-yahoo-finance.js    # Test Yahoo Finance
```

### Database Reset
```bash
node reset-database.js  # Reset all tables
```

## Deployment

Deployed on Railway with automatic deploys from `main` branch.

### Manual Deploy
```bash
git push origin main  # Triggers Railway deploy
```

### Logs
```bash
railway logs  # View production logs
```

## Key Design Decisions

### Why 4-phase analysis?
- Separates screening from deep analysis
- Allows different thinking budgets per phase
- Enables incremental improvements

### Why stock profiles?
- Avoids redundant research on repeat stocks
- First analysis is deep (20k tokens), subsequent are fast updates
- Biweekly refresh keeps profiles current

### Why 0-3 per sub-sector?
- Prevents over-concentration in single industries
- Allows flexibility (0 = skip weak sectors, 3 = max conviction)
- Applies across both longs AND shorts combined

### Why FMP + Yahoo Finance?
- FMP: Comprehensive fundamentals, 3-key rotation for 750 calls/day
- Yahoo: Free historical data and short interest
- Complementary strengths, cost-effective

### Why trade approval queue?
- Human oversight before execution
- Prevents runaway trading
- Allows rejection with feedback for learning

## Troubleshooting

### Trades not appearing in approval queue
- Check Phase 4 output format (must be `EXECUTE_BUY: SYMBOL | QTY | ENTRY | STOP | TARGET`)
- Verify parser in `extractTradeRecommendations()`
- Check logs for parsing errors

### Analysis too fast (not using full thinking budget)
- Prompts now use natural language ("take your time, don't rush")
- Stock profiles reduce redundant research
- First-time stocks get full deep dive

### FMP rate limits
- System auto-rotates between 3 keys
- Check `fmp.getUsageStats()` for current usage
- Cache is 90 days, should minimize calls

### Database connection issues
- Check `DATABASE_URL` in environment
- Verify Railway database is running
- Check connection pool settings in `db.js`

## Future Enhancements

- [ ] Options trading integration
- [ ] Multi-timeframe analysis
- [ ] Sentiment analysis from social media
- [ ] Backtesting framework
- [ ] Real-time position monitoring
- [ ] Mobile app for approvals
