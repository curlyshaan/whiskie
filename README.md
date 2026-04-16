# Whiskie

AI portfolio manager for long/short US equities.

## Canonical documentation

Use these files as the source of truth for the current system:

- `README.md` — operator guide, commands, and workflow overview
- `ARCHITECTURE.md` — technical architecture, schedules, pipelines, and system behavior
- `FUNDAMENTAL_SCREENER_METRICS.md` — current screener thresholds, pathways, and watchlist flow
- `CLAUDE.md` — project-specific guidance for future coding sessions

Historical planning and review notes are still in the repo, but they should not be treated as the current implementation spec.

## What the system does today

Whiskie manages a long/short equity workflow built around:

- a curated `stock_universe`
- weekly fundamental screening into `saturday_watchlist`
- a daily 4-phase analysis pipeline
- stock profiles for reusable research context
- a human approval queue before execution
- automated trade execution and exit monitoring during market hours

## Current workflow

### Weekly workflow

- **Friday 3:00 PM ET** — refresh earnings calendar
- **Saturday 10:00 AM ET** — rebuild `stock_universe` with `scripts/populate-universe-v2.js`
- **Saturday 3:00 PM ET** — run `fundamentalScreener.runWeeklyScreen('full')`, writing candidates to `saturday_watchlist` with `status='pending'`
- **Sunday 1:00 PM ET** — weekly portfolio review
- **Sunday 3:00 PM ET** — build or refresh stock profiles for `saturday_watchlist`
- **Sunday 9:00 PM ET** — weekly Opus review analyzes pending watchlist names, then activates the top **7 per pathway**

### Weekday workflow

- **7:00 AM ET** — corporate actions check
- **8:00 AM ET** — macro regime detection
- **9:00 AM ET** — pre-market scan
- **10:00 AM ET** — daily 4-phase analysis
- **2:00 PM ET** — daily 4-phase analysis
- **Every 30 minutes, 9:00 AM-4:00 PM ET** — process approved trades and run pathway exit monitoring
- **4:30 PM ET** — structured exit review
- **Hourly, 9:00 AM-4:00 PM ET** — order reconciliation
- **6:00 PM ET** — daily summary
- **Hourly** — expire stale trade approvals

## Core pipeline

### 1. Universe construction

`scripts/populate-universe-v2.js` builds the live universe from FMP using:

- a **core universe**: top 7 stocks per industry with market cap `>= $7B`
- a **growth expansion universe**: selected `$1B-$10B` names in growth-heavy sectors

The result is written to `stock_universe` and tagged with `universe_bucket` values such as `core` and `growth_expansion`.

### 2. Weekly fundamental screening

`src/fundamental-screener.js` screens `stock_universe` and writes results to `saturday_watchlist`.

Current long pathways:

- `deepValue`
- `highGrowth`
- `inflection`
- `cashMachine`
- `qarp`
- `qualityCompounder`
- `turnaround`

Current short pathway labels:

- `overvalued`
- `deteriorating`
- `overextended`

Current thresholds in code:

- `LONG_THRESHOLD = 48`
- `SHORT_THRESHOLD = 65`

### 3. Daily 4-phase analysis

The weekday trading flow is driven from `src/index.js`:

1. **Pre-ranking** (`src/pre-ranking.js`)
2. **Long analysis** with Opus (`35k` thinking budget)
3. **Short analysis** with Opus (`35k` thinking budget)
4. **Portfolio construction** with Opus (`45k` thinking budget)

Trade recommendations are emitted in a strict parser format and then submitted to the approval queue.

### 4. Trade approval and execution

The active approval flow uses `trade_approvals`.

Lifecycle states in current code:

- `pending`
- `approved`
- `rejected`
- `executed`
- `expired`

Approved trades are processed by the trade executor during the market-hours monitoring cycle.

## Data sources

### FMP

Primary fundamentals/data provider.

Current implementation details:

- uses `/stable` endpoints
- `src/fmp.js` enforces a `400ms` minimum call interval
- `src/fmp.js` keeps a **30-minute in-memory cache** for repeated requests

### Tradier

Used for live quotes, ETB checks, order placement, and reconciliation.

### Tavily

Used for market and company news context.

### Yahoo Finance

Used selectively for missing data such as short-interest-related context.

## Commands

### Start

```bash
npm start
npm run dev
npm run start:paper
npm run start:live
```

### Database and maintenance

```bash
npm run db:init
npm run db:reset
node scripts/populate-universe-v2.js
npm run update-etb
```

### Important note

```bash
npm run populate-stocks
```

exists in `package.json`, but it points to the deprecated hardcoded universe script and should not be used for the current workflow.

## Validation commands currently available

`npm test` is not configured for this repo.
Use the node-based checks in `test/` instead:

```bash
node test/test-4phase.js
node test/test-analysis.js
node test/test-fmp.js
node test/test-full-analysis.js
node test/test-yahoo-finance.js
```

## Manual API triggers

Current routes in `src/index.js` include:

- `GET /health`
- `GET /status`
- `POST /analyze`
- `POST /weekly-review`
- `POST /api/trigger-saturday-screening`
- `POST /api/trigger-daily-analysis`
- `POST /api/trigger-profile-build-watchlist`
- `POST /api/trigger-weekly-portfolio-review`
- `POST /api/trigger-weekly-opus-review`
- `POST /api/trigger-premarket-scan`
- `POST /api/update-etb-status`
- `POST /api/trigger-eod-summary`
- `POST /api/trigger-trade-executor`
- `POST /chat`

## Historical docs

These files are retained for context but are not canonical:

- `IMPLEMENTATION_PLAN.md`
- `FINAL_IMPLEMENTATION_PLAN.md`
- `PATHWAY_ANALYSIS.md`
- `PATHWAY_REVIEW_RESPONSE.md`
- `docs/WHISKIE_INVESTMENT_STRATEGY.md`
- `docs/BETA_PLAY_STRATEGY.md`
- `docs/fundamental_screener_criteria.md`
