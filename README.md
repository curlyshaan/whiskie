# Whiskie

Whiskie is an AI-assisted long/short US equities portfolio manager built around weekly screening, reusable stock research profiles, a daily 4-phase decision pipeline, an autonomous trade-intent execution queue, and a separate Portfolio Hub advisory surface for household portfolio management.

## Canonical docs

Start every new session with these files:

- `README.md` — operator guide, current workflow, environment setup, and source-of-truth notes
- `ARCHITECTURE.md` — technical implementation, pipelines, data flow, API routes, and persistence model
- `FUNDAMENTAL_SCREENER_METRICS.md` — screening thresholds, pathways, and watchlist rules
- `INIT.md` — concise onboarding notes for future coding sessions
- `docs/PORTFOLIO_HUB_RECOMMENDATION_SYSTEM_REVIEW.md` — detailed Portfolio Hub recommendation business logic
- `docs/DAILY_ANALYSIS_RULES_REVIEW.md` — detailed daily analysis business logic and rule review

Everything else should be treated as supporting or archival context unless these files explicitly point to it.

## Product architecture in one view

Whiskie now has two intentionally separate operating modes:

1. **Live bot**
   - researches, ranks, and proposes trades
   - routes those trades into an autonomous trade-intent queue
   - executes approved intents against Tradier
   - manages exits, reconciliation, and risk controls

2. **Portfolio Hub (PHUB)**
   - manual multi-account household portfolio dashboard
   - advisory only
   - does not place broker trades
   - consumes shared Whiskie intelligence such as news, pathway context, post-earnings signals, technicals, and risk context

This separation is intentional:

- Whiskie live bot can trade
- PHUB can advise
- both share the same research/intelligence spine

## Current system summary

Whiskie currently does the following:

- builds and maintains a curated `stock_universe` from FMP
- runs weekly screening into `saturday_watchlist`
- builds stock profiles for watchlist names using FMP + Tavily + Gemini
- runs weekday daily analysis using a 4-phase pipeline
- queues trades into `trade_approvals` as autonomous trade intents
- auto-approves normal system-generated intents for execution while retaining operator override paths
- executes approved trades and monitors exits during market hours
- auto-builds missing stock profiles inside the Adhoc Analyzer before running analysis
- refreshes stale adhoc profiles before analysis
- runs a persisted earnings prediction and grading workflow backed by `earnings_calendar` + `earnings_reminders`
- uses DoltHub as the session-timing source for earnings (`pre_market` / `post_market`)
- runs a unified Portfolio Hub cycle that recomputes PHUB state, holdings review, and recommended new positions
- logs deterministic post-earnings signals that PHUB can use for add/pass decisions

## Current operating workflow

### Weekly flow

- **Friday 8:00 PM ET** — refresh earnings data
- **Saturday 10:00 AM ET** — rebuild `stock_universe` with `scripts/populate-universe-v2.js`
- **Saturday 3:00 PM ET** — run full weekly screener, writing `pending` candidates to `saturday_watchlist`
- **Sunday 1:00 PM ET** — weekly portfolio review
- **Sunday 3:00 PM ET** — build/refresh stock profiles
- **Sunday-Thursday 7:00 PM ET** — prepare fresh profiles for next-trading-day earnings names from `earnings_calendar`
- **Sunday 9:00 PM ET** — weekly Opus review promotes top `7` per pathway to `active`

### Weekday flow

- **7:00 AM ET** — corporate actions
- **8:00 AM ET** — macro regime detection
- **9:00 AM ET** — pre-market scan
- **10:00 AM ET** — daily 4-phase analysis
- **2:00 PM ET** — daily 4-phase analysis
- **3:00 PM ET** — earnings reminder processing
- **11:00 AM ET** — earnings reminder grading for eligible rows
- **4:30 PM ET** — structured exit review
- **Every 30 minutes during market hours** — approved trade processing + pathway exit monitoring
- **Hourly during market hours** — order reconciliation
- **6:00 PM ET** — daily summary
- **Hourly** — expire stale approvals

## Shared intelligence model

Whiskie’s design now centers on a shared-intelligence layer rather than isolated feature silos.

That shared layer includes:

- stock profiles
- pathway/watchlist context
- technical indicators
- structured Tavily macro/news context
- deterministic earnings timing and post-earnings signals
- market regime and risk context

Consumers of that intelligence include:

- daily 4-phase live analysis
- adhoc analysis
- options analyzer
- earnings predictor
- post-earnings analysis
- Portfolio Hub holdings review
- Portfolio Hub recommended new positions

## Stock profile behavior

Stock profiles are operationally important and currently work like this:

- source inputs: **FMP fundamentals + FMP historical price data + Tavily news + Gemini generation**
- profile build path is intentionally **Yahoo-free**
- profile generation is split into 3 Gemini calls:
  - `core-business`
  - `competition-management`
  - `risks-catalysts-metadata`
- step-level timings are logged for each symbol
- profiles overwrite the current row in `stock_profiles` using a canonical current-record model
- incremental refresh updates the existing row rather than appending a second current row
- adhoc flows now block on stale-profile refresh instead of analyzing against stale profile data
- post-earnings analysis now explicitly refreshes profile context before final analysis

## Current analysis universe rules

- Sunday profile build covers `saturday_watchlist` names
- next-day earnings profile prep uses `earnings_calendar` as the source of truth
- manual profile trigger currently rebuilds `pending` names in `saturday_watchlist`
- Adhoc Analyzer can also build or refresh an individual profile on demand
- daily analysis core universe is `active` watchlist names
- during market hours, daily pre-ranking can also merge in broader momentum/discovery names
- missing profiles do **not** block analysis; some flows continue without them

## Autonomous execution model

The old human approval gate is no longer the primary operating model.

Current behavior:

- analysis proposes trades
- trades are persisted in `trade_approvals` (legacy table name)
- system-generated intents can be auto-approved immediately through `submitForExecution(...)`
- executor processes approved trade intents on schedule
- operator can still inspect or reject pending/manual-review items through the Trade Queue UI

Important note:

- `trade_approvals` now functions as a **trade-intent queue**
- “manual approval” is an override/fallback path, not the default architecture

## Daily analysis decision model

The daily analyzer uses a 4-phase pipeline with deterministic ranking as a hard prior:

- Phase 1 pre-ranking scores/order are the anchor, not a loose suggestion
- Phase 2/3 can override a higher-ranked name only for a material reason
- Phase 4 must explicitly record override metadata when it displaces a stronger prior candidate
- Phase 4 execution lines must match the summarized final long/short positions 1:1

Daily decisions use multiple inputs together, not stock profiles alone:

- Phase 1 ranking and pathway context
- stock profile context
- tactical daily state / what changed
- technicals and momentum
- catalysts and recent news
- earnings timing / risk context
- market regime and portfolio construction constraints

## Earnings system and post-earnings workflow

Whiskie now treats earnings as a structured lifecycle with deterministic timing and session-aware post-analysis.

### Timing sources

- FMP provides core earnings dates
- DoltHub provides session timing:
  - `pre_market`
  - `post_market`
  - `unknown` fallback only when no reliable session exists

### Reminder / predictor workflow

- `earnings_calendar` stores event timing
- `earnings_reminders` stores persisted predictor lifecycle
- predictors are generated, emailed, and later graded

### Post-earnings analysis

`analyzeAfterEarnings(...)` now:

- refreshes the stock profile before final analysis
- respects session-aware timing gates
- uses trading-day-aware recency instead of naive calendar-day filtering
- prevents `post_market` names from finalizing too early
- computes deterministic reaction metrics including:
  - `preEarningsClose`
  - `gapPct`
  - `closeToCloseReactionPct`
  - `intradayReactionPct`
  - `liveReactionPct`
  - `dipBasisPct`

### PHUB interaction

Fresh post-earnings signals are persisted and later consumed by PHUB.

That means PHUB can:

- see whether a recent earnings reaction looks buyable
- suppress adds when the post-earnings signal is `PASS`
- incorporate refreshed thesis/profile/news context into holding review and recommendations

### One-time deploy prep endpoint

There is now a one-time operator endpoint for post-earnings prep:

- `POST /api/trigger-earnings-post-prep-once`

Default target dates:

- `2026-04-28`
- `2026-04-29`

Purpose:

- refresh profiles for those earnings cohorts
- attempt post-earnings analysis when already eligible
- pre-stage data for the next valid 10:00 AM session-aware run

Optional body:

```json
{
  "earningsDates": ["2026-04-28", "2026-04-29"]
}
```

## Portfolio Hub (PHUB)

Portfolio Hub is a manual household portfolio operating surface, not a brokerage execution engine.

It now includes:

- multi-account transaction ledger
- account cash tracking
- holdings review with Whiskie context
- recommended new positions
- manual holding stop/target plans
- advisory stop/target overlays
- post-earnings signals in holdings context
- account-type-aware recommendation context
- unified cycle tracking

### Unified cycle

The unified cycle is the main PHUB recomputation workflow.

It:

1. rebuilds PHUB view/context
2. runs holdings review
3. runs recommended new positions
4. persists cycle metadata for audit/debugging

### Important PHUB design boundary

- PHUB does not execute broker trades
- PHUB uses Whiskie intelligence, but remains advisory only

## Provider/API reference and local environment map

The goal of this section is that a future session should not need you to restate the basic provider setup again.

### External APIs in use

| Provider | What it is used for | Doc URL | Key / env names in this project | Current setup notes |
| --- | --- | --- | --- | --- |
| Quatarly | Claude/Opus/Gemini gateway | `https://www.quatarly.cloud/docs` | `QUATARLY_API_KEY`, `QUATARLY_BASE_URL` | Current base URL is `https://api.quatarly.cloud/` |
| FMP | Fundamentals, quotes, historical prices, earnings, core market data | `https://site.financialmodelingprep.com/developer/docs/stable` | `FMP_API_KEY_1` | Current code assumes a paid single-key setup and `/stable` endpoints |
| Tavily | Search plus provider-returned content extraction for structured market/news retrieval | `https://tavily.com` | `TAVILY_API_KEY` | Used as the app-wide news/content provider with usage tracking and workflow-specific query helpers |
| DoltHub | Earnings session timing (`pre_market` / `post_market`) | `https://www.dolthub.com/repositories/post-no-preference/earnings/data/master/earnings_calendar` | none | Used as the earnings session timing source layered on top of earnings dates |
| Tradier | Brokerage, market open state, order/account actions | `https://documentation.tradier.com/brokerage-api` | `TRADIER_API_KEY`, `TRADIER_BASE_URL`, `TRADIER_SANDBOX_API_KEY`, `TRADIER_SANDBOX_URL`, `TRADIER_ACCOUNT_ID`, `TRADIER_SANDBOX_ACCOUNT_ID` | Supports live and sandbox/paper flows |
| Resend | Email delivery | `https://resend.com/docs` | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ALERT_EMAIL` | Used for alerts and reminder email delivery |
| FRED | Macro calendar/economic support | `https://fred.stlouisfed.org/docs/api/fred/` | `FRED_API_KEY` | Present in env for macro/economic data support |

### Important live/local references

These are the kinds of values future sessions should expect to exist and know about, even if secrets should not be printed back unnecessarily:

- app URL (production): `https://whiskie-production.up.railway.app`
- database env name: `DATABASE_URL`
- current deployment host pattern: Railway-hosted app + Railway Postgres
- local env file: `.env`
- env template: `.env.example`

### Important note on secrets

The docs should record **which env names exist and what they are for**, not repeatedly echo secret values into normal session responses unless specifically needed for an operational task.

## Commands


### Runtime

```bash
npm start
npm run dev
npm run start:paper
npm run start:live
```

For Railway paper trading, keep app runtime in production but explicitly force sandbox brokerage mode:

```bash
TRADING_MODE=paper
NODE_ENV=production
```

`TRADING_MODE` is the source-of-truth override for Tradier sandbox selection.

### Database and maintenance

```bash
npm run db:init
npm run db:reset
node scripts/populate-universe-v2.js
node scripts/refresh-earnings-fmp.js
npm run update-etb
```

### Important note

```bash
npm run populate-stocks
```

still exists in `package.json`, but it points to the deprecated hardcoded universe script and should not be used for the live workflow.

## Validation

`npm test` is not configured. Current useful validation commands are:

```bash
node tests/safeguard.test.js
node test/test-4phase.js
node test/test-analysis.js
node test/test-fmp.js
node test/test-full-analysis.js
```

Use focused syntax checks with `node --check` when making targeted file changes.

## Manual API triggers

Current important routes include:

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
- `POST /api/trigger-earnings-reminders`
- `POST /api/trigger-earnings-post-prep-once`
- `POST /api/trigger-trade-executor`
- `GET /adhoc-analyzer`
- `POST /adhoc-analyzer/analyze`
- `POST /adhoc-analyzer/build-profile`
- `GET /adhoc-analyzer/debug-build-profile`
- `POST /chat`

## Environment setup

Use `.env.example` as the reference layout. Keep `.env` grouped, clean, and limited to required live values.


Current important variables:

- `TRADING_MODE`
- `QUATARLY_API_KEY`
- `QUATARLY_BASE_URL`
- `FMP_API_KEY_1`
- `TAVILY_API_KEY`
- `NEWS_SUMMARY_MODEL`
- `TRADIER_API_KEY`
- `TRADIER_BASE_URL`
- `TRADIER_SANDBOX_API_KEY`
- `TRADIER_SANDBOX_URL`
- `DATABASE_URL`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `ALERT_EMAIL`
- `NODE_ENV`
- portfolio/risk limit variables

Current short-risk implementation notes:

- `risk-manager.js` is the authoritative source for portfolio-level short limits
- `short-manager.js` enforces symbol-level short eligibility and references risk-manager limits for exposure caps
- VIX regimes now use:
  - `CALM` `<15`
  - `NORMAL` `15-20`
  - `ELEVATED` `20-25` with conviction-only shorts
  - `CAUTION` `25-28` with exceptional/defensive shorts only
  - `FEAR` `28-35` with no single-name shorts
  - `PANIC` `35+` with no new positions
- conviction short tracking is persisted in `conviction_override_log`

Recent reliability/performance updates:

- adhoc analysis now degrades gracefully when profile building fails and can reuse cached Opus responses
- pathway exit actions that reduce or close positions now route into the autonomous trade-intent queue instead of bypassing queue state
- circuit breaker now checks both weekly loss and daily drawdown
- options analyzer keeps low-conviction options ideas as warnings instead of force-converting them to `no_trade`
- earnings trim lot changes now execute inside a DB transaction
- shared services now provide reusable profile-build coordination, Tavily/news caching, quote caching, and Opus-response caching
- post-earnings analysis now uses trading-day-aware eligibility and session-aware deterministic dip logic
- PHUB recommended-position persistence now retains technical snapshots and recommended-account context

Paper/sandbox deployments should always set:

- `TRADING_MODE=paper`
- `TRADIER_SANDBOX_URL`
- `TRADIER_SANDBOX_API_KEY`
- `TRADIER_SANDBOX_ACCOUNT_ID`

Current Adhoc Analyzer behavior:

- missing stock profiles auto-build before analysis continues
- stale stock profiles auto-refresh before analysis continues
- duplicate `Analyze` / `Build Profile` clicks are blocked while a request is in flight
- if a profile build/refresh fails, adhoc analysis can still continue with reduced context and surfaces warnings in the UI
- BUY-oriented adhoc results can surface an embedded options alternative and deep-link into the Options Analyzer
- `/adhoc-analyzer/debug-build-profile` exists for profile-build diagnostics

## Earnings prediction workflow

Whiskie now uses `earnings_calendar` as the source of truth for upcoming earnings and persists official predictions in `earnings_reminders`.

### Schedule

- **Sunday-Thursday 7:00 PM ET** — prepare fresh profiles for symbols with earnings on the next trading day
- **Sunday-Thursday 3:00 PM ET** — sync and process due earnings reminders, then save official predictions
- **Weekdays 11:00 AM ET** — grade eligible saved predictions

### Current lifecycle

- `active` — waiting for official prediction
- `predicted` — prediction saved
- `graded` — post-earnings reaction evaluated
- `expired` — no longer valid

### Grading timing

- pre-market earnings on date `D` → grade at **11:00 AM ET on `D`**
- post-market earnings on date `D` → grade at **11:00 AM ET on the next trading day**
- unknown session follows the post-market/next-trading-day rule

### Operator UI

`/earnings-reminders` now acts as an operating console:

- searchable symbol setup
- saved official prediction details
- sortable/filterable table
- dark glassmorphism dashboard styling
- date-only earnings values are rendered as literal calendar dates, not timezone-shifted timestamps

Tavily/news-provider behavior:
- selected Tavily provider/account failures that surface as soft HTTP 432/433 responses now degrade to empty news context in major workflows instead of automatically failing the full job

## Dashboard behavior

The main dashboard now prefers live portfolio totals from the Tradier-backed analysis engine when available, so cash/invested values reflect the actual synced account state instead of only the most recent saved snapshot row.

Trade approval UI behavior:

- pending approvals can now include standard entries and pathway-exit-generated actions
- approval cards surface `source_phase` so operators can distinguish pathway exits from normal portfolio construction flow
- approval stats now include expired approvals

Portfolio Hub UI behavior:

- holdings rows now include direct links into Adhoc Analyzer and Options Analyzer
- running Portfolio Hub Opus review can return either:
  - refreshed recommendations for only the holdings that currently need review
  - or a no-op message if no holdings are stale / materially changed / near earnings
- Portfolio Hub holdings review and Recommended New Positions both now pass shared FMP-backed technical context into Opus, including SMA/RSI/volume-based posture data used for stops, targets, and trim/add timing
- Portfolio Hub accounts now store account types (`Taxable Cash`, `Taxable Margin`, `IRA`, `HSA`, `Other`) and show them in the PHub UI
- Portfolio Hub recommendation logic is now tax-aware: taxable-heavy exposure biases toward lower churn, while IRA/HSA exposure can support more medium-term tactical turnover when justified

Note: `MAX_DAILY_TRADES` is no longer part of the active configuration model.

## Important current design decisions

- `trade_approvals` is the live approval system
- `saturday_watchlist` is the live weekly candidate source
- `stock_profiles` stores one current canonical row per symbol
- profile history, if needed later, should live in a separate history table rather than duplicate current rows
- strategy-aware management state (`thesis_state`, `holding_posture`, `target_type`) must stay aligned across prompts, DB, monitoring, and UI
- there is no longer a hard daily trade-count cap in the execution path; weekly loss protection remains active via the circuit breaker

## Repo cleanup note

This repo contains some archival planning and review files. They can be retained for context, but new sessions should rely on the canonical docs listed above first.


## Canonical kept scripts and tests

After cleanup, the intended core operational scripts are:

- `scripts/populate-universe-v2.js`
- `scripts/refresh-earnings-fmp.js`
- `scripts/update-etb-status.js`
- `scripts/build-missing-profiles.js`
- `scripts/build-specific-profiles.js`
- `scripts/retry-failed-profiles.js`
- `scripts/rebuild-fresh-start.js`
- `scripts/reset-database.js`
- `scripts/reset-database-clean.js`

Current kept core validation scripts are:

- `test/test-4phase.js`
- `test/test-analysis.js`
- `test/test-fmp.js`
- `test/test-full-analysis.js`
