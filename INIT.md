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
- adhoc analysis also refreshes stale profiles before continuing
- adhoc analyzer blocks duplicate build/analyze clicks while a request is in flight
- daily analysis now runs at 10:00 AM, 12:00 PM, and 2:00 PM ET
- earnings profile prep now runs Sunday-Thursday at 7:00 PM ET using `earnings_calendar` for next-trading-day symbols
- official earnings predictions save into `earnings_reminders` without sending email
- earnings grading now runs at 11:00 AM ET
- grading rule: pre-market earnings grade same day 11:00 AM ET; post-market earnings grade next trading day 11:00 AM ET
- dashboard cash/invested display now prefers live Tradier-backed portfolio state when available
- approving a trade in the dashboard now triggers immediate execution submission plus a post-trade metadata sync path
- homepage includes a manual `Sync Portfolio` button for Tradier -> Whiskie reconciliation
- flexible fundamental positions intentionally show `Flexible` in the Take Profit column instead of forcing a fixed numeric target
- Portfolio Hub is now a separate transaction-ledger-based multi-account system, not part of Whiskie live trading positions
- Portfolio Hub supports `buy`, `sell`, `short`, `cover`, `deposit`, and `withdraw` transactions and derives holdings from ledger history
- default Portfolio Hub accounts are: Sai-Webull-Cash, Sai-Webull-Margin, Sai-Webull-IRA, Sai-Fidelity-IRA, Sai-Tradier-Cash, Sara-Webull-Cash, Sara-Webull-IRA
- Portfolio Hub combined holdings now group by `symbol + position type`, not symbol alone
- Portfolio Hub share guidance is whole-number based
- Portfolio Hub Opus review now uses market context (VIX + SPY regime), structured Tavily macro context, and capped structured Tavily stock context for priority holdings
- Portfolio Hub Opus review auto-builds missing Whiskie stock profiles for held symbols before running
- Phase 1 ranking is a hard prior; Phase 4 must justify overrides and emit 1:1 execution lines
- there is no active daily trade-count cap in execution; weekly loss guard remains in the circuit breaker
- Railway paper trading should use `TRADING_MODE=paper` even if `NODE_ENV=production`
- short-risk limits now come from `risk-manager.js`; `short-manager.js` should not maintain separate portfolio short caps
- VIX regime logic now includes `ELEVATED` conviction-short handling and `CAUTION` exceptional-short handling, plus conviction override logging
- adhoc analyzer now supports graceful degraded analysis when profile refresh/build fails and can surface an options alternative for BUY setups
- Portfolio Hub now links directly into adhoc/options analysis and Opus review only refreshes holdings that are stale, moving sharply, or near earnings
- earnings pre-analysis now includes options earnings context and Portfolio Hub transaction saves reject oversells/overcovers at the account level
- approvals page now shows pathway-exit origin via `source_phase` and includes expired approval stats

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
