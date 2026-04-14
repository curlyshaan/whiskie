# Whiskie Architecture Documentation

Comprehensive technical documentation for the Whiskie AI Portfolio Manager system.

## Table of Contents

1. [System Overview](#system-overview)
2. [Saturday Watchlist System](#saturday-watchlist-system)
3. [4-Phase Analysis System](#4-phase-analysis-system)
4. [Stock Profile System](#stock-profile-system)
5. [Trade Approval Queue](#trade-approval-queue)
6. [Cron Schedule](#cron-schedule)
7. [Data Sources](#data-sources)
8. [Database Schema](#database-schema)
9. [Risk Management](#risk-management)
10. [Deployment](#deployment)

---

## System Overview

Whiskie is an autonomous trading bot that manages a long/short equity portfolio using Claude Opus with extended thinking. The system operates on a weekly cycle (Saturday screening) and daily cycle (Mon-Fri analysis).

**Core Philosophy:**
- Separate screening from deep analysis (4-phase approach)
- Maintain comprehensive stock profiles to avoid redundant research
- Human-in-the-loop for trade execution (approval queue)
- Sector diversification constraints (0-3 per sub-sector)
- Market regime adaptation (VIX-based)

**Tech Stack:**
- **AI**: Claude Opus 4.6 via Quatarly API (extended thinking enabled)
- **Backend**: Node.js + Express
- **Database**: PostgreSQL on Railway
- **Data**: FMP (primary), Tradier (quotes/execution), Yahoo Finance (short interest), Tavily (news)
- **Deployment**: Railway with auto-deploy from main branch

---

## Saturday Watchlist System

The Saturday watchlist is the **single source of truth** for weekly stock candidates. It replaces the deprecated separate watchlists (value_watchlist, quality_watchlist, overvalued_watchlist).

### Saturday 10:00 AM ET - Stock Universe Refresh

**Purpose**: Repopulate the stock universe with fresh data from FMP

**Process:**
1. Cron job triggers `populate-universe-v2.js`
2. Fetches stocks from FMP company-screener API
3. Filters: $7B+ market cap, actively trading, no ETFs
4. Groups by industry, takes top 7 per industry by market cap
5. Populates `stock_universe` table (~377 stocks)

**Key Configuration:**
```javascript
MIN_MARKET_CAP = 7_000_000_000  // $7B
STOCKS_PER_INDUSTRY = 7
RATE_LIMIT_DELAY = 400ms  // 150 calls/min
```

**Why top 7 per industry?**
- Ensures sector diversification
- Captures industry leaders + challengers
- Avoids over-concentration in mega-cap tech
- ~377 stocks is manageable for weekly screening

### Saturday 3:00 PM ET - Fundamental Screening

**Purpose**: Screen all 377 stocks and populate saturday_watchlist with intent/pathway tags

**Process:**
1. Runs `fundamentalScreener.runWeeklyScreen('full')`
2. Single pass over all stocks (parallel processing, batch size 5)
3. Evaluates 6 long pathways + 3 short pathways
4. Scores each stock (0-100 scale)
5. Inserts passing stocks into `saturday_watchlist` with:
   - `intent`: 'long' or 'short'
   - `pathway`: specific strategy (e.g., 'deepValue', 'overvalued')
   - `status`: 'active' (used for daily filtering)
   - `score`: pathway score
   - `reasoning`: why it passed

**Long Pathways** (pass if ANY pathway ≥38):
1. **deepValue**: Low P/E, low PEG, high FCF yield
2. **highGrowth**: >30% revenue growth (ignore valuation)
3. **inflection**: Q-over-Q acceleration, margin expansion
4. **cashMachine**: FCF yield >8%, growing FCF
5. **qarp**: Quality at reasonable price (ROE + growth + valuation)
6. **turnaround**: Margin recovery, revenue stabilization

**Short Pathways** (must hit ALL three criteria ≥50):
1. **overvalued**: Extreme valuation (PEG >3 AND P/E >50, sector-adjusted)
2. **deteriorating**: Decelerating growth OR margin compression
3. **overextended**: Technical weakness + negative momentum

**Sector-Adjusted Scoring:**
- Each sector has different ideal/high thresholds (see `sector-config.js`)
- Example: P/E of 20 is good for Tech, acceptable for Utilities, poor for Financials
- Prevents false positives from applying uniform thresholds across sectors

**Output:**
- `saturday_watchlist` table populated with 30-60 stocks
- Each stock tagged with intent, pathway, score, reasoning
- Used as primary input for daily analysis

---

## 4-Phase Analysis System

The 4-phase system separates fast screening (Phase 1) from deep analysis (Phases 2-3) and portfolio construction (Phase 4).

### Phase 1: Pre-Ranking

**Purpose**: Filter saturday_watchlist down to top candidates for Opus analysis

**Process** (`pre-ranking.js`):
1. Gets stocks from `saturday_watchlist` WHERE status = 'active'
2. Merges with full universe (watchlist stocks get priority)
3. Batch fetches live quotes from Tradier
4. Filters by:
   - Min $50M daily dollar volume
   - Max 0.5% bid-ask spread
   - Min $5 price
5. Scores by:
   - Volume surge (2x+ average)
   - Price momentum (intraday change)
   - Sector strength (relative to SPY)
   - Technical signals (breakouts, breakdowns)
6. Returns top 15-20 longs + 15-20 shorts

**Why pre-ranking?**
- Opus analysis is expensive (50k token thinking budget)
- Pre-ranking ensures Opus focuses on highest-probability candidates
- Live filters catch illiquid/wide-spread stocks that passed Saturday screening

### Phase 2: Long Analysis

**Purpose**: Deep Opus analysis of long candidates

**Process** (`opus-screener.js`):
1. For each long candidate:
   - Fetches/updates stock profile (if >12 days old)
   - Gets latest fundamentals from FMP
   - Searches recent news via Tavily
   - Builds comprehensive prompt with profile + fundamentals + news
2. Calls Claude Opus with:
   - Model: `claude-opus-4-6-thinking`
   - Extended thinking: enabled
   - Thinking budget: 50,000 tokens
   - Temperature: 1.0 (for thinking), 0.1 (for output)
3. Opus evaluates:
   - Business quality and moats
   - Valuation (absolute + relative to sector)
   - Growth trajectory and catalysts
   - Risk factors and thesis validity
   - Entry/exit prices, position sizing
4. Outputs structured recommendation with conviction score

**Why extended thinking?**
- 50k token budget allows thorough reasoning
- Opus can explore multiple angles, weigh trade-offs
- Takes 3-7 minutes per stock but produces higher-quality analysis
- Critical for avoiding value traps and identifying hidden risks

### Phase 3: Short Analysis

**Purpose**: Deep Opus analysis of short candidates

**Process**: Same as Phase 2 but evaluates:
- Overvaluation severity (P/E, PEG, EV/Sales relative to sector)
- Deteriorating fundamentals (revenue deceleration, margin compression)
- Technical weakness (below 200 EMA, negative momentum)
- Short safety (float, borrow availability, meme stock risk)
- Catalyst timing (earnings, lockup expiration, regulatory events)

**Short-Specific Considerations:**
- Negative PEG is a **valuation signal** (not filtered out)
- Higher volume requirements (500k shares/day vs 250k for longs)
- Meme stock filter (max 15% short float)
- Borrow cost and availability checks

### Phase 4: Portfolio Construction

**Purpose**: Build final portfolio with sector constraints and risk management

**Process**:
1. Receives ranked candidates from Phases 2-3
2. Calls Claude Opus with:
   - Thinking budget: 20,000 tokens (less than Phases 2-3)
   - Current portfolio state
   - Sector exposure limits
   - VIX regime (affects position sizing)
3. Opus constructs portfolio considering:
   - **0-3 stocks per sub-sector** (combined longs + shorts)
   - Conviction vs diversification balance
   - Correlation with existing positions
   - Sector rotation signals
   - Risk-adjusted position sizing
4. Outputs trade recommendations in parseable format:
   ```
   EXECUTE_BUY: SYMBOL | QTY | ENTRY | STOP | TARGET
   EXECUTE_SHORT: SYMBOL | QTY | ENTRY | STOP | TARGET
   ```

**Why 0-3 per sub-sector?**
- 0 = skip weak sectors entirely
- 1-2 = moderate conviction
- 3 = maximum conviction (but still diversified)
- Applies to longs AND shorts combined (prevents over-concentration)

---

## Stock Profile System

Stock profiles are comprehensive research dossiers that avoid redundant analysis.

### Profile Structure

Stored in `stock_profiles` table:
- `symbol`: Stock ticker
- `business_model`: What the company does, revenue model
- `moats`: Competitive advantages and barriers to entry
- `competitive_advantages`: Specific strengths vs competitors
- `competitive_landscape`: Industry dynamics, key competitors
- `management_quality`: Leadership assessment
- `valuation_framework`: How to value this specific business
- `fundamentals`: Financial metrics (JSON)
- `risks`: Key risks and concerns
- `catalysts`: Upcoming events or trends
- `key_metrics_to_watch`: 3-5 metrics specific to this stock (JSON)
- `last_updated`: Timestamp for staleness check
- `profile_version`: Increments on each update

### Profile Lifecycle

**Initial Build** (first time analyzing a stock):
- Deep research with 20k token thinking budget
- Comprehensive profile covering all fields
- Takes 3-5 minutes

**Incremental Update** (profile <12 days old):
- Quick refresh with latest fundamentals
- Updates only changed fields
- Takes 30-60 seconds

**Stale Refresh** (profile >12 days old):
- Deeper refresh, re-evaluates thesis
- Updates all fields with fresh data
- Takes 2-3 minutes

**Why 12-day threshold?**
- Balances freshness with efficiency
- Most stocks don't change materially in 12 days
- Earnings typically quarterly (90 days)
- 12 days = ~2 weeks, catches post-earnings updates

### Key Metrics System

Each profile includes `key_metrics_to_watch` - 3-5 metrics specific to that stock:

**Example (AAPL):**
```json
{
  "Operating Margin Trend": "32.4% current vs 31.6% prior quarter - expansion despite 40% revenue growth suggests pricing power intact",
  "Greater China Revenue Growth": "20% of revenue ($80B+) faces existential risk from Huawei resurgence",
  "Free Cash Flow Conversion Rate": "Currently 95% FCF/Operating Cash Flow with $124B annual FCF supports $15B dividend",
  "Revenue Growth Rate (quarterly YoY)": "40% acceleration in Q1 FY2026 is exceptional and unsustainable",
  "Services Revenue as % of Total Revenue": "Currently 22% with 90%+ gross margins - path to 30% mix justifies multiple expansion"
}
```

**Why key metrics?**
- Focuses Opus analysis on what matters most for each stock
- Avoids generic analysis (e.g., "monitor revenue growth")
- Tailored to business model (SaaS vs hardware vs commodity)
- Updated during profile refreshes

---

## Trade Approval Queue

Human-in-the-loop system for trade execution.

### Workflow

1. **Generation**: Phase 4 outputs trade recommendations
2. **Parsing**: `trade-approval.js` extracts trades from Opus output
3. **Queueing**: Trades inserted into `trade_approvals` table with status 'pending_approval'
4. **Notification**: Email sent to user with trade details
5. **Review**: User reviews via web UI at `/approvals`
6. **Decision**: User approves or rejects with optional feedback
7. **Execution**: Approved trades executed by `trade-executor.js` (runs every 45 min during market hours)
8. **Learning**: Rejected trades logged for future learning

### Trade Format

Must match this exact format for parsing:
```
EXECUTE_BUY: AAPL | 50 | 175.00 | 165.00 | 195.00
EXECUTE_SHORT: TSLA | 30 | 250.00 | 275.00 | 200.00
```

Fields: `ACTION | SYMBOL | QTY | ENTRY | STOP | TARGET`

### Approval Expiration

- Pending approvals auto-expire after 24 hours
- Prevents stale trades from executing
- Hourly cron job checks for expired approvals

### Why approval queue?

- **Safety**: Prevents runaway trading
- **Learning**: Rejection feedback improves future recommendations
- **Oversight**: Human judgment on market conditions, news, timing
- **Compliance**: Audit trail for all trades

---

## Cron Schedule

All times in America/New_York timezone.

### Daily (Mon-Fri)

| Time | Job | Description |
|------|-----|-------------|
| 7:00 AM | Corporate Actions | Check for splits, dividends, mergers |
| 8:00 AM | Macro Regime | Detect VIX regime (low/medium/high/crisis) |
| 9:00 AM | Pre-Market Scan | Gap analysis, overnight news |
| 10:00 AM | Morning Analysis | 4-phase analysis + trim/tax/trailing checks |
| 2:00 PM | Afternoon Analysis | 4-phase analysis + trim/tax/trailing checks |
| 6:00 PM | Daily Summary | Portfolio metrics, P&L, risk report |
| Every 45 min (9am-4pm) | Trade Execution | Process approved trades + pathway exit monitoring |
| Hourly | Approval Expiration | Expire pending approvals >24h old |

### Weekly

| Day | Time | Job | Description |
|-----|------|-----|-------------|
| Friday | 3:00 PM | Earnings Refresh | Update earnings calendar (Python script) |
| Saturday | 10:00 AM | Universe Refresh | Repopulate stock_universe from FMP |
| Saturday | 3:00 PM | Fundamental Screening | Populate saturday_watchlist (6 long + 3 short pathways) |

### Removed Jobs

- **Biweekly Deep Research** (Sunday 10am): Removed - redundant with 12-day profile staleness check
- **Batch Profile Builds**: Never implemented, removed from dashboard

---

## Data Sources

### FMP (Financial Modeling Prep)

**Primary data source** - comprehensive fundamentals with high rate limits

**Configuration:**
- 3 API keys with rotation (`FMP_API_KEY_1`, `FMP_API_KEY_2`, `FMP_API_KEY_3`)
- 300 calls/minute per key = 900 calls/minute total
- Unlimited daily calls
- **CRITICAL**: Always use `/stable` endpoint (not `/api/v3`)

**Key Endpoints:**
- `/stable/ratios-ttm` - Current P/E, PEG, margins, ROE (TTM)
- `/stable/key-metrics-ttm` - ROIC, Graham number, EV ratios (TTM)
- `/stable/financial-growth?period=quarter` - True YoY growth rates
- `/stable/income-statement?period=quarter` - Quarterly financials
- `/stable/balance-sheet-statement?period=quarter` - Balance sheet
- `/stable/cash-flow-statement?period=quarter` - Cash flow
- `/stable/technical-indicators/ema` - 50/200 EMA
- `/stable/technical-indicators/rsi` - RSI(14)
- `/stable/earning-calendar` - Upcoming earnings dates
- `/stable/company-screener` - Pre-filtered stock universe

**Rate Limiting:**
- 500ms delay between calls in batch operations
- Automatic key rotation on rate limit errors
- No caching (FMP is fast enough without it)

**Why no caching?**
- FMP rate limits are generous (900 calls/min)
- Real-time data is critical for trading decisions
- Cache invalidation complexity not worth it
- Simpler architecture without cache layer

### Tradier

**Real-time quotes and order execution**

**Configuration:**
- Paper trading sandbox vs production (controlled by `NODE_ENV`)
- `TRADIER_API_KEY` and `TRADIER_ACCOUNT_ID` in `.env`

**Key Operations:**
- `getQuote(symbol)` - Real-time quote
- `getQuotes(symbols)` - Batch quotes (faster)
- `placeOrder()` - Market/limit orders
- `placeOCOOrder()` - One-cancels-other (stop-loss + take-profit)
- `cancelOrder()` - Cancel pending order
- `getPositions()` - Current positions
- `getOrders()` - Order history

**OCO Orders:**
- Automatically placed after trade execution
- Stop-loss protects downside
- Take-profit locks in gains
- One triggers, other cancels

### Tavily

**News search for fundamental analysis**

**Configuration:**
- `TAVILY_API_KEY` in `.env`
- Used during stock profile generation
- Searches recent news (last 7 days)

**Usage:**
```javascript
const news = await tavily.search(`${symbol} stock news earnings`, {
  days: 7,
  max_results: 5
});
```

### Yahoo Finance

**Short interest data** (FMP doesn't provide this)

**Usage:**
- Fallback for historical data
- Rate-limited, use sparingly
- Short float percentage
- Days to cover

---

## Database Schema

### Core Tables

**stock_universe**
- Curated universe of ~377 stocks
- Populated weekly (Saturday 10am)
- Fields: symbol, company_name, sector, industry, market_cap, market_cap_tier, price, avg_daily_volume, exchange

**saturday_watchlist**
- Weekly screening results
- Populated Saturday 3pm
- Fields: symbol, intent ('long'/'short'), pathway (e.g., 'deepValue'), score, reasoning, status ('active'/'archived'), industry

**stock_profiles**
- Comprehensive research dossiers
- Updated on-demand (12-day staleness check)
- Fields: symbol, business_model, moats, competitive_advantages, fundamentals (JSON), risks, catalysts, key_metrics_to_watch (JSON), last_updated, profile_version

**positions**
- Current portfolio holdings
- Fields: symbol, quantity, avg_cost_basis, current_value, unrealized_pnl, position_type ('long'/'short')

**position_lots**
- Tax lot tracking for positions
- Fields: symbol, quantity, cost_basis, entry_date, stop_loss, take_profit, oco_order_id, thesis, original_intent, current_intent

**trades**
- Historical trade log
- Fields: symbol, action ('buy'/'sell'/'short'/'cover'), quantity, price, total_value, commission, intent, pathway, thesis

**trade_approvals**
- Pending trade approval queue
- Fields: symbol, action, quantity, entry_price, stop_loss, take_profit, status ('pending_approval'/'approved'/'rejected'), reasoning, created_at, expires_at

**analyses**
- Historical analysis results
- Fields: analysis_type ('4phase'/'weekly'), candidates_analyzed, trades_generated, thinking_tokens_used, created_at

### Indexes

- `idx_saturday_watchlist_symbol` on saturday_watchlist(symbol)
- `idx_saturday_watchlist_intent` on saturday_watchlist(intent)
- `idx_saturday_watchlist_pathway` on saturday_watchlist(pathway)
- `idx_saturday_watchlist_status` on saturday_watchlist(status)
- `idx_stock_profiles_symbol` on stock_profiles(symbol)
- `idx_position_lots_symbol` on position_lots(symbol)

---

## Risk Management

### Position Sizing

**Max Position Size**: 15% of portfolio
- Prevents over-concentration in single stock
- Enforced in Phase 4 portfolio construction

**Max Sector Allocation**: 25% of portfolio
- Prevents sector concentration risk
- Calculated across all positions in sector

**Min Cash Reserve**: 3% of portfolio
- Ensures liquidity for opportunities
- Buffer for margin calls on shorts

### Sector Constraints

**0-3 stocks per sub-sector** (combined longs + shorts)
- 0 = skip weak sectors entirely
- 1-2 = moderate conviction
- 3 = maximum conviction
- Enforced in Phase 4 portfolio construction

**Why sub-sector (not sector)?**
- Sector too broad (e.g., "Technology" includes software, hardware, semiconductors)
- Sub-sector captures true correlation (e.g., "Cloud Software" vs "Semiconductors")
- Prevents false diversification

### VIX Regime Detection

**Regimes** (detected daily at 8am):
- **Low** (VIX <15): Normal risk-taking, full position sizes
- **Medium** (VIX 15-25): Moderate caution, 75% position sizes
- **High** (VIX 25-35): Defensive, 50% position sizes, favor quality
- **Crisis** (VIX >35): Maximum defense, 25% position sizes, cash heavy

**Impact on Portfolio:**
- Position sizing adjusted by regime multiplier
- Stop-losses tightened in high VIX
- Sector limits more conservative in crisis
- Short exposure increased in high VIX (hedging)

### Trading Limits

**Max Trades Per Day**: 3
- Prevents overtrading
- Enforces discipline

**Max Portfolio Drawdown**: 20%
- Circuit breaker for risk management
- Halts new trades if exceeded
- Triggers portfolio review

### Correlation Analysis

- Monitors correlation between positions
- Warns if portfolio correlation >0.7
- Suggests diversification opportunities
- Runs during daily summary (6pm)

---

## Deployment

### Railway Configuration

**Environment:**
- Node.js runtime
- PostgreSQL addon (database)
- Auto-deploy from `main` branch

**Build:**
- Build command: (none, uses package.json)
- Start command: `npm start`
- Port: 8080

**Environment Variables:**
- All variables from `.env.example`
- Set in Railway dashboard
- Secrets encrypted at rest

**Logs:**
- View via Railway dashboard
- Or: `railway logs` (CLI)

**Database:**
- PostgreSQL 14+
- Managed by Railway
- Automatic backups
- Connection pooling (max 20 connections)

### Manual Deploy

```bash
git push origin main  # Triggers Railway deploy
```

**Deploy Process:**
1. Railway detects push to main
2. Pulls latest code
3. Installs dependencies (`npm install`)
4. Restarts service
5. Health check on `/health` endpoint
6. Old instance terminated after new instance healthy

**Rollback:**
```bash
git revert <commit-hash>
git push origin main
```

### Monitoring

**Health Check:**
- Endpoint: `GET /health`
- Returns: `{ status: 'ok', uptime: <seconds> }`

**Cron Status:**
- Dashboard: `https://whiskie-production.up.railway.app/cron-status`
- Shows last 7 days of cron executions
- Success/failure rates per job

**Email Alerts:**
- Sent via Resend API
- Triggers: cron failures, analysis errors, trade execution errors
- Recipient: `ALERT_EMAIL` from `.env`

---

## API Endpoints

### Dashboard

- `GET /` - Main dashboard (portfolio, positions, recent trades)
- `GET /approvals` - Trade approval queue UI
- `GET /cron-status` - Cron job execution history

### Trade Approvals

- `POST /api/approvals/:id/approve` - Approve pending trade
- `POST /api/approvals/:id/reject` - Reject pending trade (with feedback)

### Manual Triggers

- `POST /analyze` - Trigger 4-phase analysis manually
- `POST /api/trigger-premarket-scan` - Trigger pre-market scan
- `POST /api/trigger-daily-analysis` - Trigger daily analysis
- `POST /api/trigger-eod-summary` - Trigger end-of-day summary
- `POST /api/trigger-saturday-screening` - Trigger Saturday screening
- `POST /weekly-review` - Trigger weekly portfolio review

### Health

- `GET /health` - Health check endpoint

---

## Key Design Decisions

### Why 4-phase analysis?

Separates fast screening (Phase 1) from deep analysis (Phases 2-3), allowing different thinking budgets per phase. Phase 4 synthesizes into final portfolio with sector constraints.

### Why stock profiles?

First analysis of a stock is deep (20k tokens), subsequent analyses reference the profile for fast incremental updates. Avoids redundant research. 12-day staleness check keeps profiles current.

### Why 0-3 per sub-sector?

Prevents over-concentration in single industries while allowing flexibility. 0 = skip weak sectors, 3 = max conviction. Applies across both longs AND shorts combined.

### Why FMP + Yahoo Finance?

FMP provides comprehensive fundamentals with generous rate limits (900 calls/min). Yahoo provides free short interest data. Complementary strengths, cost-effective.

### Why trade approval queue?

Human oversight before execution prevents runaway trading. Allows rejection with feedback for learning. Critical safety mechanism.

### Why extended thinking?

Opus with extended thinking (50k token budget) produces more thorough analysis than standard calls. Used in Phases 2, 3, 4 where deep reasoning is critical. Takes 3-7 minutes but worth it.

### Why Saturday 10am universe refresh?

Ensures stock universe stays current with market cap changes, delistings, new IPOs. Weekly cadence balances freshness with API cost. Top 7 per industry maintains sector balance.

### Why single saturday_watchlist?

Simpler than managing 3 separate watchlists (value, quality, overvalued). Intent/pathway tags provide same information. Easier to query and maintain.

---

## Troubleshooting

### Trades not appearing in approval queue

- Check Phase 4 output format matches: `EXECUTE_BUY: SYMBOL | QTY | ENTRY | STOP | TARGET`
- Verify parser in `trade-approval.js` function `extractTradeRecommendations()`
- Check logs for parsing errors

### FMP rate limits hit

- System auto-rotates between 3 keys (300 calls each = 900/min)
- Check usage: `fmp.getUsageStats()`
- If still hitting limits, add more keys or reduce analysis frequency

### Database connection issues

- Verify `DATABASE_URL` in `.env`
- Check Railway database is running
- Connection pool settings in `db.js` (max: 20, timeout: 2s)

### Analysis too fast (not using full thinking budget)

- Stock profiles reduce redundant research (by design)
- First-time stocks get full deep dive
- Check `enableThinking` and `thinkingBudget` parameters in claude.js calls

### Port 8080 already in use

```bash
lsof -ti:8080 | xargs kill
```

### Cron jobs not running

- Check Railway logs for errors
- Verify timezone is 'America/New_York'
- Check cron expressions in `src/index.js`

---

## Future Enhancements

**Potential Improvements:**
- Options strategies (covered calls, protective puts)
- Earnings play automation (pre/post earnings analysis)
- Sector rotation signals (momentum-based rebalancing)
- Machine learning for entry/exit timing
- Backtesting framework for strategy validation
- Multi-timeframe analysis (daily + weekly + monthly)
- Social sentiment integration (Twitter, Reddit, StockTwits)
- Insider trading tracking (Form 4 filings)
- Short squeeze detection (high short interest + positive catalysts)

**Not Planned:**
- Intraday trading (system designed for swing/position trading)
- Crypto/forex (equity-focused)
- Penny stocks (min $5 price, $500M market cap)
- Leveraged ETFs (too volatile for risk management)
