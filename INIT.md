# INIT

Use this file as a quick-start memory reset for future sessions.

## Read first

1. `README.md`
2. `ARCHITECTURE.md`
3. `FUNDAMENTAL_SCREENER_METRICS.md`

## Current operational facts

- stock profiles use **FMP + Tavily + Gemini**, not Yahoo
- profile generation is split into 3 Gemini passes with per-step timing logs
- `stock_profiles` is a single current-row table per symbol
- incremental refresh overwrites the current row and increments `profile_version`
- Sunday profile build is operationally important before Sunday 9 PM weekly Opus review
- daily analysis core universe is active `saturday_watchlist` names, with discovery/momentum additions during market hours
- missing profile does not always block analysis/review flows
- adhoc analysis auto-builds a missing stock profile before continuing
- daily analysis now runs at 10:00 AM, 12:00 PM, and 2:00 PM ET
- Phase 1 ranking is a hard prior; Phase 4 must justify overrides and emit 1:1 execution lines
- there is no active daily trade-count cap in execution; weekly loss guard remains in the circuit breaker

## Current provider docs

- FMP: `https://site.financialmodelingprep.com/developer/docs/stable`
- Tavily: `https://docs.tavily.com/welcome`
- Tavily API ref: `https://docs.tavily.com/documentation/api-reference/introduction`
- Quatarly: `https://www.quatarly.cloud/docs`
- Tradier: `https://documentation.tradier.com/brokerage-api`

## Important reminders

- prefer existing structured Tavily helpers over adding new ad hoc searches
- preserve consistency across prompts, DB fields, API routes, and dashboard UI
- do not treat historical planning docs as canonical source of truth
- if changing profile behavior, preserve FMP historical price usage
- if adding history for profiles, use a separate history model rather than multiple current rows


## Quick operational memory

- production app URL: `https://whiskie-production.up.railway.app`
- DB connection is always via `DATABASE_URL`
- provider docs live in README/ARCHITECTURE and should be consulted before changing integrations
- future sessions should avoid asking again for provider names, env names, and core app URL unless those are believed to have changed


## Cleanup memory

- deprecated universe scripts and many one-off test helpers were removed
- when discussing supported validation, prefer only the remaining core `test/` scripts
