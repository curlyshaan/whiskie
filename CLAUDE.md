# CLAUDE.md

Project guidance for future coding sessions in `Whiskie`.

## Canonical docs

When describing or modifying the current system, use these files first:

- `README.md`
- `ARCHITECTURE.md`
- `FUNDAMENTAL_SCREENER_METRICS.md`

Historical planning and review docs remain in the repo, but they are not the current source of truth.

## Quick start

```bash
npm install
cp .env.example .env
npm start
```

## Current commands

### Runtime

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

still exists in `package.json`, but it points to the deprecated hardcoded universe script and should not be used for the live workflow.

## Current validation commands

`npm test` is not configured.
Use the node-based checks in `test/`:

```bash
node test/test-4phase.js
node test/test-analysis.js
node test/test-fmp.js
node test/test-full-analysis.js
node test/test-yahoo-finance.js
```

## Current architecture snapshot

### Weekly flow

- Friday 3:00 PM ET — earnings refresh
- Saturday 10:00 AM ET — `scripts/populate-universe-v2.js`
- Saturday 3:00 PM ET — `fundamentalScreener.runWeeklyScreen('full')`
- Sunday 1:00 PM ET — weekly portfolio review
- Sunday 3:00 PM ET — profile build/update for watchlist stocks
- Sunday 9:00 PM ET — weekly Opus review, top `7` per pathway activated

### Weekday flow

- 7:00 AM ET — corporate actions
- 8:00 AM ET — macro regime detection
- 9:00 AM ET — pre-market scan
- 10:00 AM ET — daily analysis
- 2:00 PM ET — daily analysis
- every 30 minutes during market hours — approved trade processing + pathway exit monitoring
- 4:30 PM ET — structured exit review
- hourly during market hours — order reconciliation
- 6:00 PM ET — daily summary
- hourly — expire stale approvals

## Current trading pipeline

1. Universe refresh builds `stock_universe`
2. Weekly screener writes `pending` rows to `saturday_watchlist`
3. Weekly Opus review activates top `7` per pathway
4. Pre-ranking merges active watchlist names with the broader universe
5. Daily analysis runs:
   - Phase 1 pre-ranking
   - Phase 2 long analysis (`35k` thinking budget)
   - Phase 3 short analysis (`35k` thinking budget)
   - Phase 4 portfolio construction (`45k` thinking budget)
6. Trades enter `trade_approvals`
7. Approved trades execute during the market-hours monitoring loop

## Current screener facts

### Thresholds

- `LONG_THRESHOLD = 48`
- `SHORT_THRESHOLD = 65`

### Long pathways

- `deepValue`
- `highGrowth`
- `inflection`
- `cashMachine`
- `qarp`
- `qualityCompounder`
- `turnaround`

### Short labels

- `overvalued`
- `deteriorating`
- `overextended`

## Strategy-aware management facts to preserve

When changing trade-management logic, keep these invariants aligned across prompts, DB, and UI:

- `thesis_state` and `holding_posture` are first-class persisted fields
- `flexible_fundamental` means the position should not rely on a rigid take-profit ceiling
- weekly review, earnings review, and pathway exit monitoring must consume the latest persisted management state, not only entry metadata
- structured Tavily searches are preferred over vague ticker-news prompts when feeding Opus review flows

## Data-source facts to preserve

### FMP

- use `/stable` endpoints
- current client uses controlled parallel quote fan-out instead of a fixed per-request sleep
- current client keeps a `30-minute` in-memory cache

### Trade approval

Current active approval statuses are:

- `pending`
- `approved`
- `rejected`
- `executed`
- `expired`

Use `trade_approvals` as the live approval flow. Do not treat legacy `pending_approvals` helpers as the primary path.

## Current risk-manager defaults

Environment variables can override them, but current code defaults are:

- max position size: `12%`
- max short position size: `10%`
- max total short exposure: `20%`
- min cash reserve: `10%`
- max sector allocation: `30%`
- max drawdown: `20%`
- max daily trades: `7`

## Current manual API routes

`src/index.js` currently exposes:

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
