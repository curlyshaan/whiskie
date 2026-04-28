# Daily Analysis Rules Review

## Purpose

This document describes the current Whiskie daily analysis rules for third-party review. It focuses on the live/paper trading bot workflow only and excludes Portfolio Hub.

## Daily analysis objective

The daily analysis system is designed to:

- review current portfolio positions
- evaluate active weekly-screened candidates
- optionally surface non-watchlist discovery names
- produce a constrained set of Opus-reviewed long and short candidates
- convert only final approved actions into executable trades

The intended philosophy is not intraday chasing. The primary engine is the Sunday-reviewed active Saturday watchlist. Broad universe discovery is secondary.

## System boundaries

Included in this document:

- daily pre-ranking
- active watchlist handling
- broad discovery handling
- earnings blockers
- Phase 1 through Phase 4 analysis flow
- approvals and execution gating

Excluded:

- Portfolio Hub
- stock profile generation internals
- weekly screening formulas in full detail

## Daily orchestration flow

The daily live analysis run in `src/index.js` follows this broad sequence:

1. fetch portfolio state
2. sync broker positions into local DB state
3. evaluate health, stops, trims, tax logic, trailing-stop logic
4. gather news and macro context
5. run deep Opus analysis
6. parse final recommendations
7. create approvals if valid
8. execute only through approval/execution path

## Candidate architecture

### Primary candidate source: active Saturday watchlist

This is the main daily candidate universe.

Meaning:

- these names were screened on Saturday
- reviewed by Opus on Sunday
- promoted to `active`
- therefore they are already high-priority names for daily consideration

Current intended behavior:

- active Saturday watchlist names should enter the daily analysis universe automatically
- they should not need to re-earn entry through broad intraday momentum logic
- hard blockers may still exclude them

### Secondary candidate source: stock universe discovery

These names come from `stock_universe`.

Meaning:

- they are not already active weekly-reviewed names
- they are broad discovery candidates
- they must earn attention through daily market behavior

This path is intentionally stricter and should remain secondary.

## Phase 1: pre-ranking rules

Pre-ranking lives in `src/pre-ranking.js`.

It produces two distinct buckets:

- `analysis`
- `discovery`

### Analysis universe

This should be driven by:

- `saturday_watchlist` rows with status `active`

Hard exclusions still apply, especially:

- imminent earnings blocker for longs
- invalid/missing quote or invalid price

### Discovery universe

This is built from the broader `stock_universe`.

These names must pass:

- general liquidity
- price sanity
- intraday momentum logic
- score threshold

## Liquidity rules

### Purpose

Liquidity screening is meant to answer:

> Is this stock normally liquid enough to trade responsibly?

It is not meant to answer whether the stock is exciting today.

### Current rule

For broad discovery names during market hours:

- minimum price: `$5`
- minimum general liquidity: `$50M` average dollar volume

The average liquidity baseline now uses:

1. quote average-volume fields if present
2. `stock_universe.avg_daily_volume`
3. live volume only as a last fallback

This preserves the original intent while adapting to the current FMP stable quote payload shape.

### Important distinction

General liquidity should not be based purely on early-session live volume, because that would distort the screen by time of day.

## Earnings blocker

### Long-side hard blocker

For daily long consideration, if a stock has earnings in:

- `0 to 3` days

it is excluded.

Rationale:

- avoid entering longs immediately ahead of a binary event

### Post-earnings allowance

Stocks that reported recently in the `-1 to -3 day` area may still remain eligible for post-earnings opportunity review.

### Application to active watchlist

Even active Saturday watchlist names still respect the hard earnings blocker for longs.

## Discovery momentum rules

These apply mainly to non-watchlist discovery candidates from `stock_universe`.

### Long discovery rules

A broad-universe long candidate generally needs:

- positive daily move
- sector-adjusted minimum move threshold
- minimum volume-surge confirmation

### Short discovery rules

A broad-universe short candidate generally needs:

- pathway-adjusted directional weakness/extension
- minimum move threshold
- minimum volume-surge confirmation

### Volume surge concept

Volume surge is intended to measure:

> Is today’s move confirmed by unusual activity?

This uses:

- live volume as numerator
- average volume baseline as denominator

## Scoring threshold

After passing directional and momentum gates, names are scored using:

- magnitude of move
- volume confirmation
- sector strength/weakness
- pathway context

A minimum score is required before the name survives into ranked output.

## Why active watchlist and discovery must stay separate

This is a core architectural rule.

### Active Saturday watchlist

These are:

- already researched
- already screened
- already Opus-reviewed

Therefore they should be:

- must-consider names
- daily review names
- not forced to requalify through the same discovery logic as fresh universe names

### Discovery names

These are:

- not active
- not already promoted
- opportunistic additions only

Therefore they should still have to prove themselves intraday.

## Intended examples

### Example: NVDA active in Saturday watchlist

Expected behavior:

- include in daily analysis universe
- exclude only if blocked by hard rules such as imminent earnings

### Example: ADBE not active in Saturday watchlist

Expected behavior:

- not automatically analyzed
- only considered if it emerges through discovery/momentum filters

## Phase 2 and Phase 3

### Phase 2

Long candidate review with Opus.

Inputs include:

- portfolio state
- market context
- watchlist/pathway metadata
- technical context
- historical context
- news context

### Phase 3

Short candidate review with Opus.

Same concept, applied to short-side candidates with different thesis standards.

## Phase 4

Portfolio construction merges:

- current holdings
- Phase 2 long outputs
- Phase 3 short outputs
- portfolio constraints
- cash context
- VIX regime context

Phase 4 should not blindly override Phase 1 ordering without a real reason.

## Execution philosophy

Whiskie does not auto-fire trades from raw analysis text alone.

The path is:

1. analysis
2. parsed final recommendations
3. approval creation
4. approved trade execution path

## Current hard controls

Examples of real constraints still in place:

- earnings blackout checks
- execution price drift checks
- portfolio/risk sizing checks
- approval gating
- broker reconciliation

## Recently disabled control

The previous circuit-breaker gate was removed from the execution path because it was driven by internal snapshot comparisons and was creating false pauses not aligned with broker reality.

## Reconciliation behavior

Position reconciliation now performs a verification pass before emailing discrepancy alerts.

Purpose:

- reduce false-positive alerts caused by transient DB/broker timing mismatches

## Third-party review questions

Recommended questions for reviewer assessment:

1. Is the split between active watchlist analysis and broad discovery sufficiently clear?
2. Is the long earnings blocker too strict at `0–3` days?
3. Should active watchlist names ever bypass earnings blockers?
4. Is the discovery momentum logic still too breakout/chase oriented for the intended strategy?
5. Should broad discovery be reduced further and treated only as a tertiary opportunistic layer?
6. Are the short-side thresholds sufficiently conservative?
7. Does Phase 4 preserve the spirit of Phase 1 candidate selection?

## Recommended policy interpretation

The current intended operating model should be interpreted as:

- Sunday Opus review determines the primary active candidate set
- daily analysis reviews those active names consistently
- broad momentum/discovery is supplemental, not the core engine
- the system should avoid turning into an intraday chasing machine

## Summary

The correct mental model for Whiskie daily analysis is:

- active Saturday watchlist = curated daily review universe
- stock universe = secondary discovery universe
- imminent earnings = hard long blocker
- approvals = execution gate
- discovery should supplement, not replace, weekly curated conviction
