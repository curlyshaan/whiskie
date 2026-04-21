# Whiskie Architecture

Technical reference for the current implementation.

## Documentation map

Use these files in this order:

1. `README.md`
2. `ARCHITECTURE.md`
3. `FUNDAMENTAL_SCREENER_METRICS.md`
4. `INIT.md`

## High-level system

Whiskie is a Node.js system composed of:

1. **Universe + screening** — build `stock_universe`, screen into `saturday_watchlist`
2. **Research context** — maintain reusable `stock_profiles`
3. **Daily decisioning** — run the 4-phase analysis pipeline
4. **Execution controls** — approval queue, execution, reconciliation, and exits

Main modules:

- `src/index.js` — orchestration, schedules, API server, manual triggers
- `src/fundamental-screener.js` — weekly screening
- `src/pre-ranking.js` — live candidate filtering and scoring
- `src/stock-profiles.js` — stock research profiles
- `src/weekly-opus-review.js` — pathway review and activation
- `src/weekly-portfolio-review.js` — Sunday portfolio review
- `src/trade-approval.js` and `src/trade-executor.js` — approvals and execution
- `src/dashboard.js` — operator UI

## Universe and watchlist lifecycle

### Universe

`scripts/populate-universe-v2.js` builds `stock_universe` from FMP.

Current model:

- core universe: top 7 per industry, market cap `>= $7B`
- growth expansion bucket: selected `$1B-$10B` names in growth-heavy sectors
- `EXCLUDE_GROWTH_UNIVERSE = true` still limits live use of that growth bucket

### Weekly watchlist lifecycle

- Saturday screener expires old `active`/`pending` rows
- new screened names are written as `pending`
- Sunday Opus review analyzes pending names and promotes top `7` per pathway to `active`

Watchlist states in use:

- `pending`
- `active`
- `expired`

## Daily analysis universe

`src/pre-ranking.js` drives the live candidate set.

### Closed market

- analysis is limited to active watchlist names

### Open market

- active watchlist names stay primary
- broader universe names can be merged in for discovery/momentum

Returned buckets:

- `analysis` = active watchlist names
- `discovery` = broader momentum/universe additions

The downstream daily pipeline treats deterministic Phase 1 ranking/order as a hard prior. Later phases may override a higher-ranked symbol only when there is a material reason, and Phase 4 now persists explicit override metadata plus 1:1 execution lines for the final portfolio.

## Stock profile architecture

Profiles live in `stock_profiles` and are treated as a canonical current snapshot per symbol.

### Build inputs

### Adhoc Analyzer profile behavior

`src/adhoc-analyzer.js` now has two supported paths:

- manual `POST /adhoc-analyzer/build-profile` for explicit one-off profile builds
- `POST /adhoc-analyzer/analyze` auto-checks `stock_profiles` and builds the profile first when it is missing, then continues into the full adhoc analysis

The UI surfaces this as a loading-state message so the operator can see when profile construction is happening before analysis.

Current full-build inputs are:

- FMP fundamentals
- FMP 1-year historical prices
- Tavily structured stock context
- Gemini generation via Quatarly

### Yahoo policy

Yahoo should not participate in stock profile building.

### Full profile generation

`src/stock-profiles.js` currently splits generation into 3 steps:

1. `core-business`
2. `competition-management`
3. `risks-catalysts-metadata`

Each symbol also logs step-level timing:

- `load-existing-profile`
- `fetch-fundamentals`
- `fetch-historical-data`
- `fetch-news`
- each LLM section call
- `parse-profile`
- `save-profile`

### Refresh model

- fresh profiles are not rebuilt immediately
- stale profiles are refreshed
- incremental refresh overwrites the current symbol row instead of appending another current row
- `profile_version` increments

This is the correct operational model for live reads. If history is needed, use a separate history table instead of multiple current rows in `stock_profiles`.

## Weekly profile build behavior

There are two relevant flows:

- scheduled Sunday profile build in `src/index.js` includes `pending` and `active` saturday watchlist names
- manual `/api/trigger-profile-build-watchlist` currently processes `pending` names only

## Weekly Opus review behavior

`src/weekly-opus-review.js` reads pending watchlist rows grouped by pathway and analyzes the top `20` names per pathway.

If a stock profile exists, it is included in prompt context. If not, the analysis still proceeds using FMP/news data. Missing profile does not hard-block review.

## Trade approval and execution

`trade_approvals` is the live approval table. Current statuses:

- `pending`
- `approved`
- `rejected`
- `executed`
- `expired`

Approved trades are executed during market-hours monitoring.

The previous daily trade-count cap has been removed from the active execution path. Current hard gating here is primarily approval state, earnings blackouts, portfolio/risk validation, and the circuit breaker weekly loss guard.

## Strategy-aware persisted management

The system persists management-state fields and expects consistency across prompts, UI, DB, and exit logic:

- `thesis_state`
- `holding_posture`
- `target_type`
- `has_fixed_target`
- `trailing_stop_pct`
- `rebalance_threshold_pct`

## Data providers

### FMP

- docs: `https://site.financialmodelingprep.com/developer/docs/stable`
- current implementation uses `/stable` endpoints
- current setup assumes a paid single-key configuration
- client includes cache + throttling + retry/backoff

### Tavily

- docs: `https://docs.tavily.com/welcome`
- API ref: `https://docs.tavily.com/documentation/api-reference/introduction`
- use structured helper functions in `src/tavily.js`

### Quatarly

- docs: `https://www.quatarly.cloud/docs`
- current base URL: `https://api.quatarly.cloud/`

### Tradier

- docs: `https://documentation.tradier.com/brokerage-api`

## Key API routes

Operational routes in `src/index.js`:

- `POST /api/trigger-saturday-screening`
- `POST /api/trigger-daily-analysis`
- `POST /api/trigger-profile-build-watchlist`
- `POST /api/trigger-weekly-portfolio-review`
- `POST /api/trigger-weekly-opus-review`
- `POST /api/trigger-premarket-scan`
- `POST /api/trigger-eod-summary`
- `POST /api/trigger-earnings-reminders`
- `POST /api/trigger-trade-executor`

## Validation reality

There is no meaningful `npm test` script today. Use direct node-based checks from `test/` and targeted `node --check` syntax validation when iterating.

## Provider, app, and environment reference

### Provider documentation

- Quatarly: `https://www.quatarly.cloud/docs`
- FMP Stable API: `https://site.financialmodelingprep.com/developer/docs/stable`
- Tavily: `https://docs.tavily.com/welcome`
- Tavily API reference: `https://docs.tavily.com/documentation/api-reference/introduction`
- Tradier Brokerage API: `https://documentation.tradier.com/brokerage-api`
- Resend: `https://resend.com/docs`
- FRED API: `https://fred.stlouisfed.org/docs/api/fred/`

### Environment variable map

Expected env names currently include:

- AI: `QUATARLY_API_KEY`, `QUATARLY_BASE_URL`, `TAVILY_API_KEY`
- market data: `FMP_API_KEY_1`, `FRED_API_KEY`
- brokerage: `TRADIER_API_KEY`, `TRADIER_BASE_URL`, `TRADIER_SANDBOX_API_KEY`, `TRADIER_SANDBOX_URL`, `TRADIER_ACCOUNT_ID`, `TRADIER_SANDBOX_ACCOUNT_ID`
- database: `DATABASE_URL`
- email: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ALERT_EMAIL`
- runtime/risk: `NODE_ENV`, `INITIAL_CAPITAL`, `MAX_POSITION_SIZE`, `MAX_PORTFOLIO_DRAWDOWN`, `MIN_CASH_RESERVE`, `CASH_WARNING_THRESHOLD`, `MAX_SECTOR_ALLOCATION`, `MAX_TOTAL_SHORT_EXPOSURE`

### Known operational references

- production app URL: `https://whiskie-production.up.railway.app`
- production database is reached through `DATABASE_URL`
- `.env.example` should be the public structure reference
- `.env` is the real local operational file


## Script and test cleanup baseline

The repository has been trimmed to favor the currently supported operational path.

### Canonical scripts

- `scripts/populate-universe-v2.js`
- `scripts/refresh-earnings-fmp.js`
- `scripts/update-etb-status.js`
- `scripts/build-missing-profiles.js`
- `scripts/build-specific-profiles.js`
- `scripts/retry-failed-profiles.js`
- `scripts/rebuild-fresh-start.js`
- `scripts/reset-database.js`
- `scripts/reset-database-clean.js`

### Canonical validation scripts

- `test/test-4phase.js`
- `test/test-analysis.js`
- `test/test-fmp.js`
- `test/test-full-analysis.js`

Obsolete benchmark/Yahoo-specific/one-off test helpers should not be treated as part of the current supported workflow.
