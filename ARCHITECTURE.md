# Whiskie Architecture

## Purpose

This document describes how Whiskie is structured today at the code and system level, with emphasis on the live trading workflow, Portfolio Hub, earnings reminders, and the shared persistence model.

It is intended to be a practical engineering map, not a product pitch.

## Top-level architecture

Whiskie is a Node.js + Express application backed by PostgreSQL on Railway.

Core subsystems:

- live long/short trading workflow
- weekly screening and watchlist promotion
- stock-profile research pipeline
- daily 4-phase analysis and approval queue
- Portfolio Hub advisory workflow
- earnings prediction and grading workflow
- dashboard and operator-trigger surfaces

Primary code areas:

- `src/index.js` — app bootstrap, cron scheduling, trigger routes
- `src/db.js` — schema management and persistence helpers
- `src/dashboard.js` — dashboard HTML rendering and operator UI routes
- `src/portfolio-hub.js` — Portfolio Hub recomputation, review, and recommendation logic
- `src/earnings-reminders.js` — earnings prediction, lifecycle, and grading logic
- `src/analysis.js` and related modules — daily market/trade analysis pipeline

## Runtime model

The app is a single long-running server process that does three things:

1. serves web/operator routes
2. runs scheduled cron jobs
3. executes shared business logic against the same Postgres-backed state

Important consequence:

- manual API triggers and cron jobs usually call the same underlying functions
- persistence state is shared across UI, automation, and reporting
- operational correctness depends on DB state transitions being consistent

## Data providers and service boundaries

External providers:

- Quatarly / Claude-family models for reasoning and structured generation
- FMP for fundamentals, quotes, technicals, and earnings data
- Tavily for news and web context
- Tradier for brokerage state, order placement, and market-hours checks
- Resend for email alerts

Service-layer patterns currently in use:

- profile build coordination services
- news caching
- quote caching
- Opus response caching

The design intent is to keep provider-specific logic out of route handlers and centralize it in source modules/helpers.

## Main execution domains

### 1. Weekly screening and watchlist formation

Main purpose:

- turn a broad stock universe into a smaller, curated opportunity list

High-level flow:

1. refresh stock universe
2. run weekly screening
3. save candidates to `saturday_watchlist`
4. run weekly Opus review
5. promote the strongest names into `active` watchlist state

Important persistence:

- `stock_universe`
- `saturday_watchlist`

Business role:

- this is the upstream curation layer for most downstream analysis

### 2. Stock profile research

Main purpose:

- maintain reusable company context so daily and adhoc analysis are not forced to rebuild deep research every time

Profile behavior:

- one canonical current row per symbol
- refresh updates the current record instead of creating parallel “current” rows
- next-day earnings names are proactively prepared
- adhoc analysis can trigger missing or stale profile rebuilds

Important persistence:

- `stock_profiles`

Business role:

- profiles are the reusable research memory layer for Whiskie

### 3. Daily 4-phase analysis pipeline

Main purpose:

- convert market state, watchlist context, portfolio state, and technicals into proposed trades or no-trade decisions

High-level business logic:

1. pre-rank candidates deterministically
2. perform deeper long/short analysis
3. construct portfolio-aware final actions
4. send actions to manual approval rather than directly forcing execution

Important design rule:

- deterministic ranking is a hard prior, not a cosmetic hint

Important persistence:

- analysis/history tables and approval-related tables in `src/db.js`
- `trade_approvals` is the live approval queue

Business role:

- this is the main decision engine for live Whiskie trading

### 4. Trade approval and execution workflow

Main purpose:

- ensure trades remain human-approved before brokerage execution

Flow:

1. daily analysis proposes actions
2. actions enter `trade_approvals`
3. operator approves/rejects
4. executor submits approved trades through Tradier
5. positions, lots, and trade history are updated in Postgres

Important design rule:

- execution is gated by approval state; analysis and execution are intentionally separated

### 5. Portfolio Hub advisory system

Main purpose:

- provide a household-portfolio operating surface that is separate from the live bot

Portfolio Hub is:

- multi-account
- advisory only
- manually maintained through the UI and transaction logs
- allowed to use Whiskie research and market context

Main surfaces:

1. combined holdings review
2. latest recommendation changes
3. recommended new positions
4. account, cash, and transaction management

Important persistence:

- `portfolio_hub_accounts`
- `portfolio_hub_transactions`
- Portfolio Hub review/recommendation history tables

Design boundary:

- Portfolio Hub does not auto-place trades
- it is intentionally decoupled from the live bot execution path

### 6. Earnings reminder system

Main purpose:

- persist official earnings predictions, send reminders, and later grade the reaction

High-level flow:

1. sync earnings calendar
2. build/refresh profiles for next-day earnings names
3. generate official prediction records
4. persist predictions in `earnings_reminders`
5. grade predictions after the correct session-dependent window

Lifecycle states:

- `active`
- `predicted`
- `graded`
- `expired`

Important design rule:

- date-only earnings values are handled as literal calendar dates to avoid timezone drift

## Scheduling architecture

Cron scheduling is configured in `src/index.js` using `node-cron`.

Key scheduled families:

- weekday pre-market and intraday analysis
- earnings refresh / prediction / grading
- weekly screening and weekly review jobs
- Portfolio Hub snapshots

The scheduler does not create a separate worker process. The server itself runs the cron jobs.

Operational implication:

- long-running jobs must be defensive about concurrency and duplicate processing

## Persistence architecture

`src/db.js` is both:

- schema initializer
- shared repository layer for business operations

Patterns visible in the current implementation:

- operational tables store current canonical state
- history tables store review/recommendation output over time
- helper functions try to encode lifecycle transitions rather than leaving every caller to write raw SQL

Recent architectural direction:

- prefer selecting the most relevant event rows instead of relying on simplistic status-only filters
- reduce duplicate “active/current” records
- persist recommendation/advice history for auditability and diffing

## API and UI architecture

The UI is server-rendered through Express routes rather than a separate SPA.

Important route families:

- dashboard/operator pages
- manual trigger endpoints
- Portfolio Hub endpoints
- earnings-reminder endpoints
- adhoc analyzer endpoints

The dashboard serves two roles:

1. observability console
2. operator control panel

## Concurrency and safety controls

Current safety concepts include:

- advisory locks for Portfolio Hub generation paths
- approval gating before live execution
- circuit-breaker and risk-manager controls
- sector concentration and exposure logic
- stateful earnings lifecycle transitions

These controls are important because several subsystems use LLM output, but the system is not intended to trust raw model output blindly.

## Current architectural boundaries that matter most

### Live bot vs Portfolio Hub

- live bot can lead to broker execution after approval
- Portfolio Hub is advisory only

### Heuristic local scoring vs model conviction

- deterministic local scores are portfolio-fit heuristics
- model conviction is a separate semantic field
- they should not be treated as the same signal

### Current-state tables vs history tables

- current operational state should remain canonical and singular where possible
- history should be persisted separately for audits, diffing, and reviewer visibility

## Known structural limitations

- `src/db.js` is large and centralizes many concerns
- route, business logic, and rendering layers are cleaner than before but still tightly coupled in places
- some validation coverage is lightweight relative to business complexity
- some canonical docs referenced by `README.md` did not exist before this update

## Recommended reading order

1. `README.md`
2. `ARCHITECTURE.md`
3. `docs/PORTFOLIO_HUB_RECOMMENDATION_SYSTEM_REVIEW.md`
4. `docs/DAILY_ANALYSIS_RULES_REVIEW.md`
