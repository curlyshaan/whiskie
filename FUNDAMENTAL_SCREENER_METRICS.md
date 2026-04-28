# Fundamental Screener Metrics

## Purpose

This document summarizes the business role of the weekly screening layer and how it fits into the larger Whiskie pipeline.

It is intentionally operational and high-level. The exact code thresholds can evolve, but the business logic described here is the stable mental model.

## Why the screener exists

Whiskie should not ask the deeper analysis stack to reason over the entire market every day.

The screener exists to:

- reduce the universe to plausible candidates
- preserve pathway-specific context
- create a curated list that can later be promoted, profiled, and monitored

## Current upstream/downstream relationship

The screener sits between:

- `stock_universe` as the broad candidate pool
- `saturday_watchlist` as the curated opportunity set

Downstream consumers include:

- weekly Opus review
- stock profile building
- daily analysis
- Portfolio Hub recommended new positions

## Business logic mental model

The screener is not the final buy/sell decision engine.

Its job is to answer:

> Which symbols deserve deeper attention this week?

That means the screener is optimized for:

- relevance
- pathway fit
- candidate quality
- manageable review volume

It is not optimized to directly output executable trades.

## Current pathway concept

The project uses pathway-style categorization so candidates enter downstream analysis with a strategic frame already attached.

Examples of what pathway context typically represents:

- quality compounders
- tactical momentum or trend continuation
- recovery / inflection setups
- defensive or hedging expressions

Pathway metadata matters because later stages use it for:

- review framing
- sizing posture
- entry expectations
- overlap and diversification judgments

## Promotion logic in practice

Current practical flow:

1. weekly screening writes candidates to `saturday_watchlist`
2. names can exist as `pending`
3. weekly Opus review promotes strongest names into `active`
4. active names become primary inputs for daily analysis

This means screening is a staging layer, not the final authority.

## How to interpret screener metrics

Screener metrics should be interpreted as:

- filtration tools
- ranking hints
- context builders

They should not be interpreted as:

- direct probability-of-success estimates
- a substitute for portfolio construction
- a substitute for catalyst and risk review

## Relationship to Portfolio Hub

Portfolio Hub currently can draw recommendation candidates from watchlist-driven sources.

Important consequence:

- a screened or promoted name can influence advisory recommendations even though Portfolio Hub remains separate from live execution

## Relationship to daily analysis

Daily analysis uses screened and promoted names as a starting point, then layers:

- technical state
- news/catalysts
- portfolio constraints
- earnings timing
- market regime

So the screener narrows the field, but later systems still do most of the final judgment work.

## Stable business rules

- screening should reduce noise, not create execution pressure
- watchlist quality matters more than raw watchlist size
- pathway context should survive into later stages
- promotion into `active` is a meaningful step up from merely being screened
- downstream systems may still reject screened names
