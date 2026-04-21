# Options Analyzer Rules Review

## Purpose

This document summarizes the live decision rules currently implemented by Whiskie's options analyzer for third-party review.

Primary implementation sources:

- `src/options-analyzer.js`
- `src/dashboard.js`

## High-Level Flow

1. Validate `symbol` and `intentHorizon`.
2. Pull context from:
   - FMP quote and fundamentals
   - latest stock profile
   - latest Saturday watchlist entry
   - latest trade approval
   - current positions
   - Tavily news context
   - Tradier expirations and option chains
3. Ask Opus to produce a structured directional thesis.
4. Deterministically filter and score option contracts.
5. Choose between:
   - `use_options`
   - `buy_shares`
   - `short_shares`
   - `no_trade`
6. Persist the full run in `options_analysis_runs`.

## Horizon Rules

Supported horizons:

- `short_term`: 14 to 42 days to expiration, mapped to 2-6 weeks
- `medium_term`: 60 to 120 days to expiration, mapped to 2-4 months
- `long_term`: 180 to 540 days to expiration, mapped to 6-18 months

If no expiration exists inside the selected window, the run fails.

Additional event-risk rule:

- For `short_term`, if the next known earnings date falls inside the selected expiration window and Opus wants `use_options`, the analyzer forces `no_trade` and emits an `EARNINGS OVERLAP DETECTED` warning.

## Opus Thesis Contract

Opus is required to return JSON with these fields:

- `direction_call`: `bullish | bearish | neutral | volatile`
- `conviction`: `low | medium | high`
- `equity_preference`: `buy_shares | short_shares | use_options | no_trade`
- `thesis_summary`
- `near_term_catalysts`
- `mid_term_catalysts`
- `long_term_catalysts`
- `risks`
- `guardrails`
- `why_options_or_not`

The model is explicitly instructed to prefer equity or no trade when options are impractical due to horizon, expected move, or premium inefficiency.

## Strategy Library

Implemented strategy families:

- `long_call`
- `bull_call_spread`
- `long_put`
- `bear_put_spread`
- `covered_call`
- `cash_secured_put`
- `protective_put`

Each strategy defines:

- recommendation type
- option type (`call` or `put`)
- delta range
- strike range
- rationale

## Strategy Candidate Mapping

### Bullish thesis

Candidate order:

1. `bullish_directional`
2. `bullish_defined_risk`
3. `income_cash_secured_put` if horizon is not short term
4. `income_covered_call` only if shares are already owned

### Bearish thesis

Candidate order:

1. `bearish_directional`
2. `bearish_defined_risk`
3. `hedge_protective_put` only if shares are already owned

### Volatile thesis

Candidate order:

1. `hedge_protective_put` if shares are already owned
2. `bullish_defined_risk`
3. `bearish_defined_risk`

Selection rule:

- A `volatile` thesis no longer auto-selects between bullish and bearish spreads by score.
- If a long position exists and a valid protective put survives filtering, `protective_put` is the only auto-selected options structure.
- Otherwise the analyzer returns `no_trade` and leaves any directional spread candidates informational only.

### Neutral thesis

- No standalone options strategy is forced.
- `income_covered_call` is considered only if the account already owns shares.

## Contract Eligibility Rules

A contract must pass all of the following:

1. Option type matches the strategy.
2. Strike falls inside the strategy-specific strike range relative to spot.
3. Liquidity minimum:
   - open interest at least `50`, or
   - volume at least `10`
4. Both bid and ask must be positive.
5. Bid/ask spread must be at most `18%` of ask.
6. Delta must fall inside the strategy delta band.
7. `covered_call` and `protective_put` require an existing long position.

Only the top 6 contracts by score are retained per strategy.

## Strike Selection Rules

The engine now exposes explicit strike tolerance guidance for review:

- Calls: approximately `20% below` to `25% above` spot
- Puts: approximately `25% below` to `20% above` spot
- Fallback neutral window: approximately `20% below` to `20% above` spot

Notes:

- These tolerance windows are surfaced in the result payload and in the dashboard UI.
- Final eligibility is still enforced by each strategy's narrower `strikeRange`.
- The tolerance layer is intended as a review and explainability rule, not a wider override of the strategy library.

## Scoring Rules

Each surviving contract receives a deterministic score made from:

- liquidity score
  - open interest contribution capped at 10
  - volume contribution capped at 5
- spread score
  - tighter spreads score better
- delta score
  - options closer to the midpoint of the strategy delta band score better
- distance score
  - strikes closer to spot score better

Higher total score ranks higher.

## Recommendation Selection Rules

### Thesis risk overrides

Before recommendation selection:

- If Opus returns `conviction: low` and `equity_preference: use_options`, the analyzer overrides this to `no_trade`.
- A low-conviction options warning is added to the risk/warning set.

### No valid options candidates

If no strategy produces valid contracts:

- return `short_shares` if Opus explicitly requested `short_shares`
- return `buy_shares` if Opus explicitly requested `buy_shares`
- otherwise return `no_trade`

### Explicit equity preference from Opus

If Opus says:

- `buy_shares` → return equity long recommendation
- `short_shares` → return equity short recommendation
- `no_trade` → return no trade

This overrides otherwise available option candidates.

### Otherwise

- sort viable strategies by best candidate score
- pick the highest-scoring strategy
- return `use_options` with that strategy

### High IV restriction

When ATM implied volatility is at least `60%`:

- `long_call` and `long_put` style directional premium buys are removed from consideration
- only defined-risk structures remain eligible
- a high-IV warning is added explaining that outright premium buys were excluded

## Sentiment Metrics Produced

The analyzer also summarizes the chain:

- put/call volume ratio
- put/call open-interest ratio
- ATM implied volatility
- count of unusual calls
- count of unusual puts

These metrics inform the final payload and UI, but they do not currently override the main deterministic selection path.

## Warning Rules

Warnings may include:

- up to four thesis risks from Opus
- low conviction options override warning
- `EARNINGS OVERLAP DETECTED` for short-term expirations spanning the next earnings event
- standard earnings blackout warning from `earnings-guard`
- no liquid options passed guardrails
- ATM implied volatility is at least `60%`, with directional premium buys excluded
- user capital is below `100`

## Default Guardrails in Result Payload

If Opus does not supply its own guardrails, the system falls back to:

1. Reject contracts with wide bid/ask spreads.
2. Reject low volume and low open-interest contracts.
3. Prefer no-trade or equity if options pricing is unattractive.
4. Keep selected strikes within roughly 20-25% of spot based on bullish/bearish structure.

## Persistence

Every run is saved to `options_analysis_runs` with:

- symbol
- intent horizon
- underlying price
- recommendation type
- strategy type
- direction call
- conviction
- thesis summary
- catalysts
- risks
- warnings
- guardrails
- profile version
- full result payload

## UI Exposure

The dashboard exposes these rules at:

- route: `/options-analyzer`
- API: `POST /api/options-analyzer`

The UI currently shows:

- symbol and horizon form
- capital input
- strike rule summary
- recent runs
- recommendation type and strategy
- warnings and guardrails
- candidate strategies with strike windows and ranked contracts

## Current Review Notes

Important reviewer caveats:

1. Strike tolerance windows are explanatory and broader than some strategy strike bands.
2. Opus determines directional thesis, but contract selection is deterministic after that point.
3. Equity and no-trade recommendations are first-class outcomes, not failure states.
4. Sentiment metrics are mostly descriptive, but ATM IV now hard-gates outright premium buys at 60%+.
5. Volatile theses only auto-resolve to protective puts when shares are already owned; otherwise they default to no-trade.
