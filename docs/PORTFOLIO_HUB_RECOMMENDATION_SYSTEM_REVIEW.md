# Portfolio Hub Recommendation System Review

## Purpose

This document describes how Portfolio Hub recommendation logic currently works inside Whiskie so a third-party reviewer can assess the architecture, decision quality, and risk controls.

It is intentionally focused on the Portfolio Hub recommendation subsystem and its surrounding context. It is not a description of the Whiskie live trading bot as a whole, and it does not cover Portfolio Hub performance charts in detail unless they influence recommendation logic.

## Context: what Portfolio Hub is

Portfolio Hub is a separate household portfolio dashboard inside Whiskie.

Important boundaries:

- it is manual and advisory
- it is multi-account
- it does not auto-place trades
- it is distinct from Whiskie live bot execution
- it uses Whiskie research context, market context, and portfolio state to assist human decision-making

Portfolio Hub currently supports two different Opus-driven recommendation surfaces:

1. **Combined Holdings review**
   - reviews existing held positions
   - returns actions such as Add, Trim, Reduce, Hold, or Cover
   - saves deltas into “Latest Recommendation Changes”

2. **Recommended New Positions**
   - proposes new long-term or medium-term ideas
   - intended to surface additive or rotational opportunities
   - does not directly manage existing holdings

This document is primarily about the second surface, but includes the surrounding system because reviewer feedback will likely depend on the broader context.

## High-level system objective

The “Recommended New Positions” system is meant to answer:

> Given the current household portfolio, its cash level, sector concentration, existing holdings, weekly watchlist context, and current market regime, what are a small number of practical new ideas worth considering?

The intended philosophy is:

- prefer long-term or medium-term ideas
- avoid intraday churn
- avoid low-quality “just because it ranked first” outputs
- use watchlist and Whiskie context as inputs, but keep Portfolio Hub advisory and human-reviewed

## Where the logic lives

Primary implementation:

- `src/portfolio-hub.js`
- `src/dashboard.js`
- `src/db.js`

Relevant functions include:

- `buildPortfolioHubView()`
- `runPortfolioHubRecommendedPositions()`
- `buildRecommendedPositionCandidates()`
- `enforceRecommendedPositionConstraints()`
- `scoreRecommendedPositionItem()`
- `inferRelatedHoldingForRecommendation()`

## System flow overview

The Recommended New Positions flow is:

1. load current Portfolio Hub state
2. collect candidate symbols from curated sources
3. enrich candidates with quote, stock, and Whiskie context
4. build a market-context snapshot
5. ask Opus for structured JSON recommendations
6. normalize the Opus response
7. apply local Portfolio Hub constraints
8. assign a deterministic local ranking score
9. apply a hard quality gate
10. sort and persist the surviving ideas
11. render them in the Portfolio Hub UI

## Current trigger behavior

The UI button **Refresh Recommendations** calls:

- `POST /api/portfolio-hub/recommended-positions`

That route directly calls:

- `runPortfolioHubRecommendedPositions()`

Inside that function, a fresh Opus call is made through:

- `claude.analyze(prompt, { model: 'opus' })`

So a manual refresh currently forces a fresh Opus generation pass, unless a recommendation run is already in progress and the advisory lock causes the system to return the latest saved run instead of launching a second concurrent run.

## Scheduled refresh cadence

Portfolio Hub Recommended New Positions is also refreshed automatically on weekdays at:

- 10:30 AM ET
- 2:30 PM ET

This means the recommendation subsystem normally runs multiple times per trading day even without manual interaction.

## Candidate sourcing

Candidate construction happens in `buildRecommendedPositionCandidates()`.

Current candidate pool sources:

1. `saturday_watchlist`
   - statuses currently supplied: `active` and `pending`
   - pathway, intent, and score context are preserved

2. latest daily symbol states
   - used as a secondary source when a symbol is not already captured by the watchlist candidate map

Held symbols are also tracked so the system knows whether a proposed idea overlaps with an existing holding.

Current behavior:

- watchlist candidates are inserted first
- daily-state candidates are added only if not already present
- final candidate list is sorted by source score / conviction proxy
- only the top 20 candidates are passed forward to context building and Opus prompting

## Context gathered before Opus is called

Before prompting Opus, the system builds context for candidate symbols including:

- quotes
- stock metadata
- Whiskie context
- FMP-backed technical context from the shared analysis engine
- portfolio summary
- sector allocation
- current holdings
- market context

The market context is intended to include regime and macro/news overlays so Opus sees portfolio state plus environment, not just isolated ticker lists.

### Technical inputs now included

Portfolio Hub recommendation generation now explicitly passes the shared Whiskie technical bundle into Opus context for each candidate, including fields such as:

- `sma50`
- `sma200`
- `distanceFrom200MA`
- `sma200Slope`
- `rsi`
- `volumeRatio`
- trend / above-below moving-average state

This matters because the recommendation surface is expected to use technical posture when suggesting:

- whether the setup is constructive or weak
- whether a name is extended
- how aggressive the entry should be
- whether stop-loss and take-profit levels are sensible

## What Opus is asked to do

Opus is prompted to return JSON only.

It is asked to produce up to 5 ideas with fields including:

- `symbol`
- `direction`
- `horizonLabel`
- `conviction`
- `starterShares`
- `starterPositionValue`
- `entryZone`
- `stopLoss`
- `takeProfit`
- `targetFramework`
- `pathway`
- `thesis`
- `whyNow`
- `portfolioFit`
- `sectorImpact`
- `invalidation`
- `relationshipType`
- `relatedHoldingSymbol`
- `relatedHoldingAction`
- `modelReasoning`

Prompt-level rules currently emphasize:

- no short-term trades
- staged entries
- practical sizing
- use of portfolio concentration, cash, and sector exposure
- explicit handling of overlap with existing holdings

## Relationship logic with current holdings

The system locally classifies the relationship of a proposed idea to existing holdings using `inferRelatedHoldingForRecommendation()`.

Possible relationship types:

- `existing_holding`
- `replacement_candidate`
- `complementary`

Interpretation:

### Existing holding

The symbol is already owned in Portfolio Hub.

Current handling:

- it remains valid as a recommendation candidate
- but should conceptually be managed through holdings workflow rather than treated as a brand-new idea

### Replacement candidate

The candidate overlaps with an existing holding enough by industry or by sector+pathway that it is treated as a possible rotation or comparison case.

### Complementary

No meaningful overlap was found, so the idea is treated as diversification or additive exposure.

## Local constraint layer before scoring

After Opus returns raw items, `enforceRecommendedPositionConstraints()` applies local gating.

Current constraints include:

### Sector concentration block

If a candidate is **not already held** and the portfolio is already above the long sector concentration threshold for that candidate’s sector, the candidate is rejected unless it is a `replacement_candidate`.

### Duplicate-sector suppression

Within a single recommendation batch, the system generally avoids returning multiple ideas from the same sector unless the candidate is a `replacement_candidate`.

### Output count cap

The constrained list stops at 5 ideas maximum.

## Deterministic local scoring

After constraints, each surviving item gets a deterministic local score from `scoreRecommendedPositionItem()`.

This score is **not** Opus confidence and **not** a percentage probability of success.

It is a local ranking heuristic.

### Current scoring inputs

The score is currently composed of:

- **conviction**
  - high = 15
  - medium = 8
  - low = 3

- **long bias**
  - long = 10
  - short = 2

- **diversification**
  - complementary = 12
  - replacement candidate = 7
  - existing holding / other = 3

- **sector penalty / support**
  - if sector concentration already exceeds policy threshold: `-12`
  - otherwise sector contribution is `max(0, 8 - round(sectorWeight / 5))`

- **cash support**
  - cash >= 10%: 8
  - cash >= 5%: 4
  - otherwise: 0

- **pathway bonus**
  - if pathway exists: 5

### Important interpretation

This local score should be interpreted as:

- a portfolio-fit / prioritization heuristic
- not a direct conviction scale from Opus
- not a normalized 0–100 recommendation quality score

Historically, this meant a name could still appear with a relatively modest number if it ranked highest in a weak batch.

## New hard quality gate

To reduce low-quality recommendations surfacing just because they ranked highest in a weak run, a hard gate was added.

Current quality gate:

- conviction must be `medium` or `high`
- `high` conviction ideas are allowed regardless of deterministic local score
- `medium` conviction ideas must have deterministic local score `>= 60`

This is now applied **after** local scoring and **before** final sorting/persistence.

### Practical effect

This means:

- a low-conviction idea will not appear
- a medium-conviction idea with score below 60 will not appear
- a high-conviction idea can still appear even if its local heuristic score is below 60
- a symbol can no longer survive just because it was “best among weak options”

## Final saved output

After the quality gate:

- surviving ideas are sorted by descending deterministic score
- rank is assigned (`deterministicRank`)
- the final list is saved to:
  - `portfolio_hub_recommended_position_runs`
  - `portfolio_hub_recommended_position_items`

The UI then reads the latest persisted run and displays it inside Portfolio Hub.

## Email alert behavior

The recommendation system now also supports email alerts using the same Resend configuration already used by the Whiskie live bot:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `ALERT_EMAIL`

The alert is sent to the same alert email address already configured for Whiskie.

### When an email is sent

After a new recommendation run is saved, the system compares the final qualified recommendation list to the immediately previous saved run.

An email is sent only if one or more of these are true:

1. **New symbol added**
   - symbol appears in current final list but was absent from previous final list

2. **Material recommendation payload changed for an existing symbol**
   - same symbol remains, but key recommendation fields changed

### Material-change fields currently tracked

For an existing symbol, email diffing currently watches:

- `direction`
- `conviction`
- `starterShares`
- `starterPositionValue`
- `entryZone`
- `stopLoss`
- `takeProfit`
- `targetFramework`
- `relationshipType`
- `relatedHoldingSymbol`
- `relatedHoldingAction`
- `pathway`

### Important clarification

The email alert is based on **recommended-position payload changes**, not raw portfolio holding changes by themselves.

Example:

- if a user manually increases an MSFT position from 7 shares to 10 shares
- but the generated recommendation payload for MSFT does not materially change

then no recommendation email should be sent.

If the changed holding causes the next recommendation output to materially change, then an email can be sent.

### Why this alert design was chosen

This approach tries to balance:

- visibility into new ideas
- awareness of meaningful recommendation shifts
- low enough noise to stay useful

The intent is to avoid emailing on pure wording tweaks or simple ranking displacement while still emailing when the final actionable recommendation meaning changes.

## UI behavior

The Recommended New Positions section currently shows:

- symbol
- direction
- horizon / conviction / pathway / relationship chips
- starter sizing
- entry / stop / target and portfolio-fit fields
- thesis / why now / invalidation / related-action content
- deterministic score and rank
- scoring breakdown

This UI is advisory only and does not produce trade execution.

## Advisory locking and concurrency

`runPortfolioHubRecommendedPositions()` uses a Postgres advisory lock.

Purpose:

- prevent duplicate concurrent generation runs
- avoid multiple app instances creating overlapping recommendation batches at the same time

Behavior:

- if lock is acquired, a new run is generated
- if lock is unavailable, the function returns the latest saved recommendation run instead

This is relevant for reviewers because refresh behavior is not purely “always create a new row”; it is “create a new row unless a run is already in progress.”

## What the system does well

### 1. Uses multiple layers, not raw LLM output alone

The system does not blindly render the raw Opus output. It adds:

- candidate curation
- holding-overlap interpretation
- sector concentration logic
- deterministic ranking
- hard quality gating

### 2. Keeps Portfolio Hub distinct from live trading

This is a major safety property.

- Portfolio Hub recommendations are advisory
- they do not directly create live trades
- human review remains central

### 3. Takes portfolio composition seriously

The recommendation engine is not only ticker-driven. It sees:

- cash
- concentration
- sector exposure
- existing holdings
- potential replacement relationships

### 4. Now blocks weak absolute recommendations

The added gate materially improves output quality by avoiding weak survivors from thin candidate batches.

### 5. Produces a persisted change history plus external alerting

Because the system saves every run and now compares the newest run against the previous one, changes in the final qualified recommendation set can be monitored outside the UI through email alerts.

## Known limitations / reviewer focus areas

### 1. The local score is still heuristic, not calibrated

Even with the threshold, the score is still hand-built and heuristic.

Reviewer questions:

- Is the weighting sensible?
- Should `conviction` have more influence?
- Should sector overlap penalties be harsher?
- Should pathway bonus matter less?

### 2. Candidate source includes `pending` watchlist names

Current candidate construction includes both:

- `active`
- `pending`

This may be correct, but it means names not yet fully promoted can still feed recommendation generation.

Reviewer question:

- Should `pending` names be eligible for Portfolio Hub new-position recommendations, or should the system require `active` only?

### 3. No explicit minimum diversity count or fallback explanation

If fewer than 5 names survive, the system simply returns fewer names.

Reviewer question:

- Should the UI explain why fewer names survived?
- Should rejected reasons be retained for debugging?

### 4. Output quality still depends on prompt discipline

The system asks for structured long-term / medium-term ideas, but the quality still depends on Opus understanding and the quality of market/portfolio context.

Reviewer question:

- Are the prompt instructions sufficiently precise for long-horizon household portfolio recommendations?

### 5. Existing holdings can still appear in this surface

The system can classify a proposed recommendation as `existing_holding`.

Reviewer question:

- Should “Recommended New Positions” exclude already-held names entirely and force those to stay inside the holdings review workflow?

### 6. Threshold choice is policy, not scientific truth

The new gate uses:

- conviction `medium/high`
- `high` conviction bypasses the score threshold
- `medium` conviction requires score `>= 60`

Reviewer questions:

- Is 60 the right threshold?
- Should there be different thresholds for long vs short?
- Should replacement candidates have different standards?

### 7. Alert diffing is intentionally narrow

The email alert compares a selected set of material fields rather than the full raw LLM payload.

Reviewer questions:

- Is the chosen material-field list correct?
- Should thesis/why-now changes also count?
- Is it correct to ignore removals and only alert on additions and material changes?
- Should repeated churn in the same symbol be rate-limited further?

## Recommended reviewer questions

1. Is the separation between holdings review and new-position recommendations sufficiently clear?
2. Should `pending` Saturday watchlist names be allowed into the candidate pool?
3. Should existing holdings ever appear in the “Recommended New Positions” surface?
4. Is the local deterministic scoring formula sensible, or does it need recalibration?
5. Is the new quality gate strict enough?
6. Should the system keep a rejected-ideas audit trail for transparency?
7. Should score be displayed as a ranking heuristic rather than a generic “score” to reduce misinterpretation?
8. Are the portfolio concentration controls strong enough for a household portfolio assistant?
9. Is the replacement-candidate logic sufficiently reliable for same-sector rotations?
10. Should the UI distinguish “core long-term” vs “medium-term swing” more strongly in sizing and gating?
11. Is the email alert diff definition appropriate for a household portfolio workflow?

## Suggested mental model

The correct mental model is:

- Opus proposes ideas
- local Portfolio Hub logic decides whether those ideas are acceptable
- deterministic local scoring ranks acceptable ideas
- a hard gate blocks weak ideas
- the final output is advisory, not executable

## Summary

Portfolio Hub Recommended New Positions is a hybrid recommendation system:

- curated symbol sourcing
- portfolio-aware context building
- Opus structured generation
- local constraint enforcement
- deterministic local ranking
- hard conviction/score gating
- persisted, reviewable advisory output

The most important recent policy change is:

- only `medium` / `high` conviction ideas
- with `high` conviction always allowed
- and `medium` conviction requiring local score `>= 60`

are now allowed to surface in the final Recommended New Positions output.
