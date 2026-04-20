# Whiskie Architecture

Technical reference for the current Whiskie implementation.

## Documentation map

Canonical docs:

- `README.md` — high-level operator guide
- `ARCHITECTURE.md` — technical behavior and system structure
- `FUNDAMENTAL_SCREENER_METRICS.md` — current screener logic
- `CLAUDE.md` — project guidance for future coding sessions

Historical planning/review docs remain in the repo, but they are archival context rather than the current implementation contract.

## System overview

Whiskie is a Node.js trading system built around four connected layers:

1. **Universe + screening** — build `stock_universe`, then score names into `saturday_watchlist`
2. **Research context** — maintain reusable stock profiles and recent market/news context
3. **Daily decisioning** — run a 4-phase analysis pipeline during the trading week
4. **Execution controls** — queue trades for approval, execute approved trades, reconcile orders, and monitor exits

Primary modules:

- `src/index.js` — orchestration, cron scheduling, API server, daily analysis flow
- `src/fundamental-screener.js` — weekly long/short screening
- `src/pre-ranking.js` — live candidate filtering and scoring
- `src/weekly-opus-review.js` — Sunday pathway review and activation
- `src/stock-profiles.js` — reusable research dossiers
- `src/trade-approval.js` — approval queue lifecycle
- `src/trade-executor.js` — execution of approved trades
- `src/dashboard.js` — web UI for approvals and monitoring

## Universe construction

The live universe is populated by `scripts/populate-universe-v2.js`.

### Core rules

- fetch FMP company screener results with market cap `>= $7B`
- keep active US-listed equities only
- exclude ETFs and funds
- group by industry and keep the top `7` by market cap

### Growth expansion bucket

The same script also adds a second universe bucket for growth-oriented names:

- market cap between `$1B` and `$10B`
- sectors limited to `Technology`, `Healthcare`, and `Consumer Cyclical`
- minimum volume threshold applied in the script

### Current output model

Rows are written to `stock_universe` with fields such as:

- `symbol`
- `sector`
- `industry`
- `market_cap`
- `market_cap_tier`
- `avg_daily_volume`
- `is_growth_candidate`
- `universe_bucket`
- `status`

Avoid hardcoding a fixed universe count in docs. The size now varies with current screen results and deduplication between the core and growth buckets.

## Weekly screening and watchlist lifecycle

### Saturday screening

`src/fundamental-screener.js` loads active names from `stock_universe`, screens them, and updates `saturday_watchlist`.

Current behavior:

- old `active` and `pending` watchlist rows are expired first
- passing long and short candidates are inserted with `status='pending'`
- Sunday Opus review decides which pending names become `active`

### Watchlist states

The current watchlist lifecycle is:

- `pending` — produced by weekly screening and awaiting Sunday review
- `active` — selected by the weekly Opus review for daily use
- `expired` — superseded by newer weekly runs

### Sunday Opus review

`src/weekly-opus-review.js`:

- reads pending watchlist rows grouped by pathway
- analyzes the top `20` names per pathway by fundamental score
- activates the top `7` per pathway
- stores `opus_conviction` and `opus_reasoning`

This is the live implementation and replaces older docs that described top-15 activation.

## Fundamental screener behavior

The screener is a combined long/short pass over the current `stock_universe`.

### Shared baseline filters

- minimum price: `$5`
- minimum dollar volume: `$5M`
- long avg volume floor: `250k` shares/day
- short avg volume floor: `500k` shares/day
- short market cap floor: `$2B`
- short dollar volume floor: `$20M`

### Long pathways

Current implemented long pathways:

- `deepValue`
- `highGrowth`
- `inflection`
- `cashMachine`
- `qarp`
- `qualityCompounder`
- `turnaround`

Current thresholds:

- `LONG_THRESHOLD = 48`
- `SHORT_THRESHOLD = 65`

See `FUNDAMENTAL_SCREENER_METRICS.md` for the current pathway rules and gating logic.

## Pre-ranking

`src/pre-ranking.js` is the live Phase 1 candidate filter.

### Inputs

- active `saturday_watchlist` names
- active `stock_universe` names

Watchlist names are merged ahead of the rest of the universe so they keep priority.

### Live filters

Current live quote filters in code:

- minimum dollar volume: `$50M`
- maximum spread: `0.5%`
- minimum price: `$5`

### Earnings window handling

The pre-ranker builds an earnings map for names with earnings from `-3` to `+7` days relative to today.

That means:

- recent post-earnings names can still qualify
- upcoming earnings are visible during ranking

### Output shape

The current implementation returns:

- top `80` long candidates
- top `40` short candidates

It also preserves pathway/source context where available.

### Momentum bypass logic

These pathways can bypass some momentum-style filtering pressure because the code explicitly treats them as slower-moving fundamental setups:

- `deepValue`
- `cashMachine`
- `qarp`
- `qualityCompounder`

## Daily 4-phase analysis pipeline

The weekday analysis flow is orchestrated in `src/index.js`.

### Phase 1 — Pre-ranking

- fetches and filters live candidates
- builds long and short candidate sets

### Phase 2 — Long analysis

- Opus deep analysis of long candidates
- current thinking budget in code: `35,000`

### Phase 3 — Short analysis

- Opus deep analysis of short candidates
- current thinking budget in code: `35,000`

### Phase 4 — Portfolio construction

- combines Phase 2 and Phase 3 outputs into final trade recommendations
- current thinking budget in code: `45,000`

### Trade output contract

The parser expects the current exact command prefixes:

```text
EXECUTE_BUY: SYMBOL | QTY | ENTRY | STOP | TARGET | PATHWAY | INTENT
EXECUTE_SHORT: SYMBOL | QTY | ENTRY | STOP | TARGET | PATHWAY | INTENT
```

The richer Phase 4 output also includes thesis, catalysts, fundamentals, risk, stop, holding metadata, and explicit override markers (`OVERRIDE_PHASE2_DECISION`, `OVERRIDE_SYMBOL`, `OVERRIDE_REASON`) that feed the approval queue.

The current Phase 4 trade blocks also request structured fields such as:

- `THESIS`
- `STRATEGY`
- `CATALYSTS`
- `FUNDAMENTALS`
- `TECHNICAL`
- `RISKS`
- `STOP_TYPE` / `STOP_REASON`
- `TARGET_TYPE` / `TRAILING_STOP_PCT` / `REBALANCE_THRESHOLD_PCT` / `MAX_HOLD_DAYS`
- `OVERRIDE_PHASE2_DECISION` / `OVERRIDE_SYMBOL` / `OVERRIDE_REASON`


## Stock profiles

Profiles live in `stock_profiles` and are used to reduce repeated research work.

### Current behavior in code

- `src/stock-profiles.js` generally treats profiles older than `14` days as stale
- the Sunday bulk profile builder in `src/index.js` currently skips profiles newer than `12` days
- new names get a full profile build
- stale names get an incremental or deeper refresh depending on context

Because the code has both 12-day and 14-day checks in different flows, docs should describe that nuance instead of claiming a single universal threshold.

## Strategy-aware post-entry management

Whiskie now treats post-entry position management as a persisted state machine rather than relying only on entry-time targets.

### Persisted management fields

The live system stores and consumes:

- `thesis_state`
- `holding_posture`
- `target_type`
- `has_fixed_target`
- `trailing_stop_pct`
- `rebalance_threshold_pct`

These fields exist across `trade_approvals`, `positions`, and `position_lots`. Database initialization backfills and normalizes these values so dashboard rendering, weekly review, and pathway exits stay aligned.

### Current prompt context improvements

Weekly Opus-driven reviews now use richer prompt context:

- FMP fundamentals
- FMP technical indicators
- structured Tavily searches for catalysts, analyst changes, guidance, and material risks

This replaces looser stock-news-only prompting in the reviewed flows.

## Trade approval and execution

The live approval flow uses `trade_approvals`.

### Current status values

- `pending`
- `approved`
- `rejected`
- `executed`
- `expired`

### Current data captured

The table stores more than basic order details. It also records metadata such as:

- `pathway`
- `intent`
- `investment_thesis`
- `strategy_type`
- `catalysts`
- `fundamentals`
- `technical_setup`
- `risk_factors`
- `holding_period`
- stop and target metadata

### Legacy note

`src/db.js` still contains legacy `pending_approvals` schema/helpers, but the current app flow routes through `trade_approvals` and `src/trade-approval.js`.

### Execution loop

During market hours, `src/index.js` runs:

- approved trade processing every `30` minutes
- pathway exit monitoring every `30` minutes
- order reconciliation hourly
- approval expiration hourly

## Risk management defaults

Current default limits in `src/risk-manager.js` are environment-overridable, but the code defaults are:

- max position size: `12%`
- max short position size: `10%`
- min cash reserve: `10%`
- max sector allocation: `30%`
- max total short exposure: `20%`
- max portfolio drawdown: `20%`
- max daily trades: `7`

The portfolio-construction prompt also applies strategy guidance for position count, sector spread, and sub-sector concentration.

## Cron schedule

All schedules are configured for `America/New_York`.

### Weekdays

| Time | Job |
|---|---|
| 7:00 AM | Corporate actions check |
| 8:00 AM | Macro regime detection |
| 9:00 AM | Pre-market scan |
| 10:00 AM | Morning daily analysis |
| 2:00 PM | Afternoon daily analysis |
| Every 30 min, 9 AM-4 PM | Approved trade processing + pathway exit monitor |
| 4:30 PM | Structured exit review |
| Hourly, 9 AM-4 PM | Order reconciliation |
| 6:00 PM | Daily summary |
| Hourly | Expire stale approvals |

### Weekly

| Time | Job |
|---|---|
| Friday 8:00 PM | Earnings calendar refresh |
| Saturday 10:00 AM | Universe refresh |
| Saturday 3:00 PM | Fundamental screening |
| Sunday 1:00 PM | Weekly portfolio review |
| Sunday 3:00 PM | Profile building for watchlist names |
| Sunday 9:00 PM | Weekly Opus review |

## Data sources and caching

### FMP

Current facts from `src/fmp.js`:

- `/stable` endpoints are the intended API surface
- quote fan-out uses controlled parallel single-symbol requests because `batch-quote` is restricted on the active FMP plan
- repeated requests are cached in-memory for `30 minutes`

### Tradier

Used for:

- quotes
- history
- ETB status
- order placement and management

### Tavily

Used for external news context in research flows.

### Yahoo Finance

Used selectively where FMP coverage is incomplete.

### Cache-module note

`src/fmp-cache.js` still exists as a tiered cache module, but the live client behavior documented above is the one currently used by the core screening flow.

## API surface

Current routes defined in `src/index.js` include:

### Health and status

- `GET /health`
- `GET /status`

### Analysis triggers

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

### Chat

- `POST /chat`

## Validation and testing

`package.json` does not provide a working `npm test` target.
Current checks are run directly with Node scripts from `test/`, for example:

```bash
node test/test-4phase.js
node test/test-analysis.js
node test/test-fmp.js
node test/test-full-analysis.js
node test/test-yahoo-finance.js
```

## Historical docs

The following files remain useful as historical context only and should not be treated as the live system spec:

- `IMPLEMENTATION_PLAN.md`
- `FINAL_IMPLEMENTATION_PLAN.md`
- `PATHWAY_ANALYSIS.md`
- `PATHWAY_REVIEW_RESPONSE.md`
- `docs/WHISKIE_INVESTMENT_STRATEGY.md`
- `docs/BETA_PLAY_STRATEGY.md`
- `docs/fundamental_screener_criteria.md`
