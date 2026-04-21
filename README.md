# Whiskie

Whiskie is an AI-assisted long/short US equities portfolio manager built around weekly screening, reusable stock research profiles, a daily 4-phase decision pipeline, and a manual approval gate before execution.

## Canonical docs

Start every new session with these files:

- `README.md` — operator guide, current workflow, environment setup, and source-of-truth notes
- `ARCHITECTURE.md` — technical implementation, pipelines, data flow, API routes, and persistence model
- `FUNDAMENTAL_SCREENER_METRICS.md` — screening thresholds, pathways, and watchlist rules
- `INIT.md` — concise onboarding notes for future coding sessions

Everything else should be treated as supporting or archival context unless these files explicitly point to it.

## Current system summary

Whiskie currently does the following:

- builds and maintains a curated `stock_universe` from FMP
- runs weekly screening into `saturday_watchlist`
- builds stock profiles for watchlist names using FMP + Tavily + Gemini
- runs weekday daily analysis using a 4-phase pipeline
- queues trades into `trade_approvals` for manual approval
- executes approved trades and monitors exits during market hours
- auto-builds missing stock profiles inside the Adhoc Analyzer before running analysis

## Current operating workflow

### Weekly flow

- **Friday 8:00 PM ET** — refresh earnings data
- **Saturday 10:00 AM ET** — rebuild `stock_universe` with `scripts/populate-universe-v2.js`
- **Saturday 3:00 PM ET** — run full weekly screener, writing `pending` candidates to `saturday_watchlist`
- **Sunday 1:00 PM ET** — weekly portfolio review
- **Sunday 3:00 PM ET** — build/refresh stock profiles
- **Sunday 9:00 PM ET** — weekly Opus review promotes top `7` per pathway to `active`

### Weekday flow

- **7:00 AM ET** — corporate actions
- **8:00 AM ET** — macro regime detection
- **9:00 AM ET** — pre-market scan
- **10:00 AM ET** — daily 4-phase analysis
- **12:00 PM ET** — daily 4-phase analysis midday refresh
- **2:00 PM ET** — daily 4-phase analysis
- **3:00 PM ET** — earnings reminder processing
- **4:15 PM ET** — earnings reminder grading
- **4:30 PM ET** — structured exit review
- **Every 30 minutes during market hours** — approved trade processing + pathway exit monitoring
- **Hourly during market hours** — order reconciliation
- **6:00 PM ET** — daily summary
- **Hourly** — expire stale approvals

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

## Current analysis universe rules

- Sunday profile build covers `saturday_watchlist` names
- manual profile trigger currently rebuilds `pending` names in `saturday_watchlist`
- Adhoc Analyzer can also build or refresh an individual profile on demand
- daily analysis core universe is `active` watchlist names
- during market hours, daily pre-ranking can also merge in broader momentum/discovery names
- missing profiles do **not** block analysis; some flows continue without them

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

## Provider/API reference and local environment map

The goal of this section is that a future session should not need you to restate the basic provider setup again.

### External APIs in use

| Provider | What it is used for | Doc URL | Key / env names in this project | Current setup notes |
| --- | --- | --- | --- | --- |
| Quatarly | Claude/Opus/Gemini gateway | `https://www.quatarly.cloud/docs` | `QUATARLY_API_KEY`, `QUATARLY_BASE_URL` | Current base URL is `https://api.quatarly.cloud/` |
| FMP | Fundamentals, quotes, historical prices, earnings, core market data | `https://site.financialmodelingprep.com/developer/docs/stable` | `FMP_API_KEY_1` | Current code assumes a paid single-key setup and `/stable` endpoints |
| Tavily | Structured company/news context | `https://docs.tavily.com/welcome` and `https://docs.tavily.com/documentation/api-reference/introduction` | `TAVILY_API_KEY` | Prefer structured helper usage in `src/tavily.js` |
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
- `POST /api/trigger-trade-executor`
- `GET /adhoc-analyzer`
- `POST /adhoc-analyzer/analyze`
- `POST /adhoc-analyzer/build-profile`
- `POST /chat`

## Environment setup

Use `.env.example` as the reference layout. Keep `.env` grouped, clean, and limited to required live values.


Current important variables:

- `QUATARLY_API_KEY`
- `QUATARLY_BASE_URL`
- `FMP_API_KEY_1`
- `TAVILY_API_KEY`
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
