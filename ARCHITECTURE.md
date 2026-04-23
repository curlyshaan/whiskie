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
- `POST /adhoc-analyzer/analyze` auto-checks `stock_profiles` and ensures the profile is fresh before continuing:
  - missing profile → build first
  - stale profile → incremental refresh first
  - fresh profile → reuse current row
- if profile refresh/build fails, adhoc analysis can continue with reduced context and returns warnings to the UI instead of hard-failing
- BUY-style adhoc responses may also attach an options-alternative payload from `options-analyzer`

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
- stale profiles are incrementally refreshed before dependent workflows continue
- incremental refresh overwrites the current symbol row instead of appending another current row
- `profile_version` increments

This is the correct operational model for live reads. If history is needed, use a separate history table instead of multiple current rows in `stock_profiles`.

### Earnings-driven profile prep

There is now a dedicated scheduled prep path for earnings-driven profile freshness:

- **Sunday-Thursday 7:00 PM ET** — query `earnings_calendar` for symbols reporting on the next trading day and ensure each has a fresh profile before the later earnings prediction workflow runs

This uses `earnings_calendar` as the source of truth for next-day earnings preparation.

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

Approved trades can now be executed directly from the dashboard approval action. The approval endpoint marks the trade approved, submits it to Tradier through `trade-executor`, and then runs the portfolio metadata sync path. The scheduled/manual trade executor still exists as a retry/operations path for already-approved rows that remain unexecuted.

For long trades:

- fixed-target setups use broker protection orders when the management plan has both stop-loss and take-profit
- after-hours limit-entry setups use `OTOCO`
- market-hours fixed-protection setups wait for the entry fill, then place `OCO`
- `flexible_fundamental` setups intentionally persist thesis management metadata without forcing a broker take-profit bracket

Portfolio sync now has two layers:

- `syncPositionsFromBroker()` refreshes broker position quantities/prices into `positions`
- `syncPositionMetadataFromLots()` restores thesis/pathway/intent management fields from `position_lots`

The previous daily trade-count cap has been removed from the active execution path. Current hard gating here is primarily approval state, earnings blackouts, portfolio/risk validation, and the circuit breaker weekly loss guard.

### Short-risk and VIX regime model

- `src/risk-manager.js` is the source of truth for portfolio-level short sizing/exposure limits
- `src/short-manager.js` keeps symbol-level shortability checks such as ETB, IV, and squeeze-risk filters
- `src/vix-regime.js` now uses a 6-state model:
  - `CALM` `<15`
  - `NORMAL` `15-20`
  - `ELEVATED` `20-25` with hysteresis and conviction-only shorts
  - `CAUTION` `25-28` with tighter conviction rules and smaller short sizing
  - `FEAR` `28-35` with quality-long bias and no single-name shorts
  - `PANIC` `35+` with no new positions
- conviction short validation uses market cap, IV, documented deterioration thesis, technical confirmation, and earnings-distance checks
- approved/triggered conviction short entries are logged to `conviction_override_log` for later empirical review

### Shared reliability services

Whiskie now includes lightweight shared services for cross-feature reliability:

- `src/services/profile-build-service.js` coordinates stock profile refresh/build requests so features do not duplicate work
- `src/services/news-cache-service.js` caches structured Tavily lookups for 15 minutes
- `src/services/quote-service.js` caches quotes for 1 minute and supports batch reuse
- `src/services/opus-cache-service.js` caches reusable analysis payloads for 4 hours

These services are currently used by adhoc analysis, options analysis, and Portfolio Hub context/research flows to reduce duplicate provider calls and improve stability under API pressure.

### Exit workflow updates

- expired `trade_approvals` now record rejection metadata when auto-expired
- pathway exit monitor still evaluates positions automatically, but trim/exit actions now submit approvals instead of directly executing broker orders
- earnings trim lot updates now run transactionally so partial lot-state writes do not occur if the process fails mid-update
- circuit breaker protection now covers both weekly loss and daily drawdown checks
- approval UI now surfaces `source_phase`, which is especially important for pathway-exit-generated approvals

## Portfolio Hub

Portfolio Hub is a separate manual household-portfolio system and is explicitly not tied to Whiskie live trading positions, `positions`, `trade_approvals`, or Tradier sync.

Current model:

- `portfolio_hub_accounts` stores named accounts and baseline cash balances
- `portfolio_hub_transactions` stores the transaction ledger across accounts
- holdings are derived from transactions rather than stored as the source of truth
- combined holdings are intentionally consolidated across accounts by symbol
- Portfolio Hub no longer shows account-allocation analytics; the product model is combined household holdings first

Supported transaction types:

- `buy`
- `sell`
- `short`
- `cover`
- `deposit`
- `withdraw`

This allows partial sells, partial covers, adds, shorts, and manual cash movements without rewriting position rows.

Cash behavior:

- `buy` / `cover` / `withdraw` reduce account cash
- `sell` / `short` / `deposit` increase account cash
- the account cash override is an explicit admin-style correction path and should not be the normal workflow
- blank cash overrides are rejected so accounts cannot be accidentally zeroed

UI behavior:

- Portfolio Hub has its own `/portfolio-hub` page
- Combined Holdings supports header-click sorting
- secondary sections like Position Mix, Recent Transactions, Sector Allocation, Short Exposure by Sector, Sector Reduction Plan, and Portfolio Insights are collapsible
- the button labeled `Recalculate Portfolio Hub` rebuilds holdings and advisory analytics from stored Portfolio Hub data; it does not yet run a dedicated Portfolio-Hub-specific Opus review

Portfolio Hub uses Whiskie context for advisory analysis only:

- `stock_universe` first for sector/industry
- FMP fallback for symbols missing from `stock_universe`
- earnings calendar
- `daily_symbol_state`
- `saturday_watchlist`
- stock profile / research context as supporting thesis material

Portfolio Hub should not use live trading tables as its primary recommendation source. In particular:

- do not source Portfolio Hub advisory behavior primarily from `positions`
- do not treat `trade_approvals` as a Portfolio Hub state table

Current advisory output:

- `Whiskie View` can be overridden by a dedicated Portfolio Hub Opus review pass persisted in `portfolio_hub_advice_history`
- `Whiskie Pathway`, thesis summary, catalyst summary, and source reasons are sourced from shared Whiskie context tables
- stop-loss and take-profit columns are reserved for Portfolio-Hub-specific recommendations and may remain blank until explicitly generated for Portfolio Hub
- share guidance in Portfolio Hub is whole-number based

Current Portfolio Hub Opus review behavior:

- Portfolio Hub holdings are grouped by `symbol + position_type` so long and short rows never merge into one P/L line
- before Portfolio Hub Opus review runs, holdings missing a Whiskie `stock_profiles` row are auto-built through the existing profile builder
- Portfolio Hub Opus review is now incremental and only refreshes holdings that are stale, materially changed, or near earnings
- the Opus review prompt uses:
  - VIX regime context
  - SPY trend regime / allocation guidance
  - structured Tavily macro context
  - structured Tavily stock context for up to 6 highest-priority holdings
- the intended framing is:
  - `core long-term` holdings change slowly
  - `tactical / swing / short` holdings flex more with market conditions
- Sector Reduction Plan can remain rule-based for threshold detection, but Opus context is now rich enough to rank trim priority more intelligently in future refinements

It may surface recommendations like hold, trim, add selectively, event risk elevated, hold short thesis, or wait to cover, but it does not place trades or modify Whiskie live positions.

Portfolio Hub UI also now exposes direct navigation links from each holding row into:

- `Adhoc Analyzer`
- `Options Analyzer`

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
- `POST /api/trigger-portfolio-sync`

## Earnings predictor lifecycle

`earnings_reminders` is now a persisted prediction/grade table rather than an email-delivery queue.

### Current states

- `active` — reminder exists and is waiting for official prediction
- `predicted` — official earnings prediction has been generated and stored
- `graded` — prediction has been compared against post-earnings price action
- `expired` — stale/invalid reminder

### Scheduled behavior

- **Sunday-Thursday 3:00 PM ET** — sync upcoming reminders and save official predictions for due rows
- **Weekdays 11:00 AM ET** — grade only rows eligible based on earnings session timing

### Grading rules

- `pre_market` earnings on date `D` become grade-eligible at **11:00 AM ET on `D`**
- `post_market` or `unknown` earnings on date `D` become grade-eligible at **11:00 AM ET on the next trading day**

### UI behavior

`/earnings-reminders` is now a dashboard-style operating page with:

- persisted saved predictions
- sortable/filterable results table
- prediction direction/confidence/snapshot/grade columns
- dark glassmorphism styling

### Live portfolio display

The main dashboard now prefers live portfolio totals from `analysisEngine.getPortfolioState()` when available, so displayed cash/invested values stay aligned with actual Tradier state instead of relying only on the last saved snapshot row.

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
- brokerage: `TRADING_MODE`, `TRADIER_API_KEY`, `TRADIER_BASE_URL`, `TRADIER_SANDBOX_API_KEY`, `TRADIER_SANDBOX_URL`, `TRADIER_ACCOUNT_ID`, `TRADIER_SANDBOX_ACCOUNT_ID`
- database: `DATABASE_URL`
- email: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ALERT_EMAIL`
- runtime/risk: `NODE_ENV`, `INITIAL_CAPITAL`, `MAX_POSITION_SIZE`, `MAX_PORTFOLIO_DRAWDOWN`, `MIN_CASH_RESERVE`, `CASH_WARNING_THRESHOLD`, `MAX_SECTOR_ALLOCATION`, `MAX_TOTAL_SHORT_EXPOSURE`

For Railway paper deployments, `TRADING_MODE=paper` should be used even when `NODE_ENV=production`.

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
