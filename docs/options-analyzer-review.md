# Options Analyzer — Rules Review & Suggestions

**Reviewed by:** Claude Opus 4.6  
**Date:** 2026-04-20  
**Source doc:** `docs/options-analyzer-rules.md`  
**Source code:** `src/options-analyzer.js`

---

## Summary

The overall architecture is sound. Opus handles directional judgment, deterministic code handles contract filtering, and equity / no-trade are first-class outcomes. The following findings are the only ones strong enough to flag before live or paper use.

---

## ✅ Implemented — Earnings proximity gate on short-term runs

**Where it hits:** `short_term` horizon (14–42 days)

The options analyzer now checks both:

- `earnings-guard.js` blackout logic
- next known earnings date against the selected short-term expiration window

A short-term long call or long put that expires within an earnings window is almost always wrong without explicit intent. The stock may move in the right direction but IV crush the day after earnings will destroy the premium regardless.

**Implemented behavior:**

- If the next earnings date falls inside the short-term expiration window and Opus prefers `use_options`, the analyzer now forces `recommendation_type` to `no_trade`.
- The result includes a prominent `EARNINGS OVERLAP DETECTED` warning.
- Standard blackout warnings from `earnings-guard` are also surfaced.

---

## ✅ Implemented — `volatile` thesis no longer silently resolves to one directional bet

**Where it hits:** `getStrategyCandidates()` + `selectBestRecommendation()`

When Opus returns `direction_call: volatile`, the analyzer still computes viable candidates, but it no longer auto-picks a bullish or bearish spread just because one side scored better.

This is a logic mismatch. A volatile thesis means the direction is unknown. Silently auto-picking one directional spread because that side happened to have better open interest is misleading and could cause real harm.

**Implemented behavior:**

- If a long position exists and a valid `protective_put` candidate survives filtering, that hedge is auto-selected.
- Otherwise the analyzer returns `no_trade`.
- Bullish and bearish spread candidates may still appear in the payload/UI for information, but they are not auto-selected.

---

## ✅ Implemented — `conviction: low` now has a downstream gate

**Where it hits:** `buildThesis()` result → `analyzeSymbol()`

If Opus returns `conviction: low` but `equity_preference: use_options`, the engine proceeds to rank and recommend contracts exactly as it would for `conviction: high`. Low conviction with options means premium at risk with no strong edge behind it.

**Implemented behavior:**

- If Opus returns `conviction: low` and `equity_preference: use_options`, the analyzer now overrides that to `no_trade`.
- A prominent low-conviction warning is added to the risk/warning set.

---

## ✅ Implemented — High IV now influences strategy selection

**Where it hits:** `warnings` array + `selectBestRecommendation()`

When ATM IV is at or above 60%, the engine appends a warning string. It does not change which strategy is selected. A `long_call` and a `bull_call_spread` score identically under high IV conditions because IV is not a scoring input.

High IV strongly favors defined-risk spread structures over outright premium purchases. Buying a long call at 60%+ IV is an expensive bet that needs a large move just to break even.

**Implemented behavior:**

- When `atmImpliedVolatility >= 60`, the analyzer removes `bullish_directional` and `bearish_directional` from the candidate list.
- It retains only defined-risk structures and other non-directional income/hedge structures that remain valid.
- The result now includes a warning that outright premium buys were excluded in the high-IV regime.

---

## ✅ What is solid — no changes needed

| Area | Status |
|---|---|
| Horizon windows (14–42, 60–120, 180–540 days) | Well-defined |
| Eligibility rules (spread %, OI, volume, delta band) | Deterministic and complete |
| Equity and no-trade as first-class outcomes | Correct design |
| Opus thesis + deterministic filtering split | Sound architecture |
| Sentiment metrics descriptive-only | Intentional and correctly documented |
| Strike tolerance windows exposed for review | Good explainability |
| Top-6 contract cap per strategy | Appropriate |
| Persistence of full result payload | Correct |

---

## Status

All four high-priority review suggestions have now been implemented in the live rules.
