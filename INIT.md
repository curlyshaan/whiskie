# Whiskie Init Notes

## What this project is

Whiskie is an AI-assisted US equities operating system with two distinct modes:

- a live long/short trading workflow with manual approval before execution
- a separate Portfolio Hub household advisory workflow

## First files to read

1. `README.md`
2. `ARCHITECTURE.md`
3. `docs/PORTFOLIO_HUB_RECOMMENDATION_SYSTEM_REVIEW.md`
4. `docs/DAILY_ANALYSIS_RULES_REVIEW.md`

## Core business rules to remember

- live bot execution is not the same thing as Portfolio Hub
- `trade_approvals` is the approval gate for real trading actions
- `saturday_watchlist` is the curated upstream candidate source
- stock profiles use a canonical current-row model
- earnings reminder dates must preserve literal calendar dates
- earnings reminder auto-sync should not reuse old-event notes/timing metadata for a new earnings date
- Portfolio Hub recommendation score is a local heuristic, not the same as model conviction
- Portfolio Hub holdings review and Recommended New Positions both use shared technical context in Opus prompts
- Portfolio Hub accounts persist account types, and PHub recommendations now distinguish taxable accounts from IRA/HSA accounts

## Critical subsystems

- `src/index.js` — cron jobs and manual trigger routes
- `src/db.js` — schema plus persistence helpers
- `src/dashboard.js` — main operator UI and Portfolio Hub rendering
- `src/portfolio-hub.js` — Portfolio Hub recommendation/review logic
- `src/earnings-reminders.js` — persisted earnings prediction and grading workflow

## Current recommendation gate

For Portfolio Hub Recommended New Positions:

- `low` conviction is blocked
- `high` conviction is allowed regardless of score
- `medium` conviction requires deterministic score `>= 60`
- account type context is included in the recommendation/review prompt layer

## Validation habits

Before closing work:

- run focused `node --check` on changed JS files
- run `npm test`
- inspect `git diff` before any commit

## Current architectural caution

`src/db.js` is a critical shared dependency for many workflows. Changes there can impact:

- dashboard views
- cron jobs
- Portfolio Hub persistence
- earnings reminders
- live trading workflows


## News retrieval

- `SERPER_API_KEY` powers URL discovery via Serper
- `NEWS_SUMMARY_MODEL` selects the Quatarly model used to summarize fetched article text (default: `claude-sonnet-4-6-thinking`)
- `src/news-search.js` fetches top result pages, extracts readable article text with Cheerio, and produces structured bullets for downstream prompts
