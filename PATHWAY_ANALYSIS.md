> [!IMPORTANT]
> Historical or planning document.
> This file is retained for context, but it is **not** the source of truth for the current implementation.
> Use `README.md`, `ARCHITECTURE.md`, `FUNDAMENTAL_SCREENER_METRICS.md`, and `CLAUDE.md` for current behavior.

# Whiskie Pathway Structure Analysis

**Document Purpose**: Comprehensive review of fundamental screening pathways for third-party AI analysis  
**Date**: 2026-04-16  
**System**: Whiskie AI Portfolio Manager

---

## Overview

Whiskie uses a **Saturday fundamental screening** system that scores stocks across multiple pathways (investment strategies). Stocks are added to `saturday_watchlist` table with pathway tags, then filtered daily by Phase 1 (pre-ranking) before reaching Phase 2 (Opus deep analysis).

**Designed Pathways**: 9 total (6 long + 3 short)  
**Implemented Pathways**: 7 total (6 long + 1 short)  
**Active Pathways**: 7 (producing candidates)

---

## LONG PATHWAYS (6 implemented)

### 1. deepValue
**Status**: ✅ Active (5 stocks in watchlist)  
**Market Cap**: $2B minimum  
**Threshold**: 48 points (LONG_THRESHOLD)

**Scoring Logic** (`fundamental-screener.js:336-437`):
- Requires 2 of 3 value signals: PEG ≤ sector ideal, P/E < sector low, positive FCF
- Quality floor ≥25 pts + ≥3 quality signals (ROE, margins, debt, ROIC, liquidity, dividend)
- **Hard gates**:
  - Revenue declining >10% → rejected (value trap protection)
  - Accrual ratio >12% → rejected (earnings not backed by cash)
  - Quality score <25 → rejected
  - <3 quality signals → rejected

**Assessment**: Well-designed, appropriately strict. Avoids value traps while catching genuine deep value opportunities.

---

### 2. highGrowth
**Status**: ✅ Active (7 stocks in watchlist)  
**Market Cap**: $500M minimum  
**Threshold**: 48 points

**Scoring Logic** (`fundamental-screener.js:440-532`):
- Tiered revenue growth scoring: 15% (15 pts), 20% (25 pts), 30% (35 pts), 50% (45 pts)
- Earnings growth bonus: 20% (15 pts), 40% (30 pts)
- Operating margin scoring: >15% (15 pts), >5% (8 pts), <0% (-20 pts penalty)
- Uses forward PEG for growth stocks (smart - reflects expected growth)
- **Hard gates**:
  - Accrual ratio >12% → rejected
  - Quality score <20 → rejected (avoids one-metric wonders)
- **Penalties**:
  - Debt/Equity >2.0 → -25 pts
  - Debt/Equity >1.5 → -15 pts
  - Accrual ratio 8-10% → -15 pts
  - Accrual ratio 10-12% → -25 pts

**Assessment**: Good balance of growth + quality. Prevents chasing unprofitable growth.

---

### 3. inflection
**Status**: ✅ Active (4 stocks in watchlist)  
**Market Cap**: $500M minimum  
**Threshold**: 48 points

**Scoring Logic** (`fundamental-screener.js:534-607`):
- Requires 2 of 4 criteria:
  1. Revenue acceleration: Q-over-Q growth increasing >10% (35 pts) or >5% (20 pts)
  2. Margin expansion: Operating margin expanding >5pp (30 pts) or >2pp (15 pts)
  3. FCF growth: >50% growth with positive FCF (20 pts)
  4. Reasonable valuation: PEG <3.0 (15 pts)
- Balance sheet quality minimum: ≥15 pts from debt <0.5, quick ratio >1.5, current ratio >2.0
- **Hard gates**:
  - Accrual ratio >12% → rejected
  - <2 criteria met → rejected
  - Balance sheet score <15 → rejected

**Assessment**: Slightly strict (only 4 stocks). Multi-criteria requirement is sound but may miss early inflections. Consider relaxing to "1 strong criterion OR 2 weak criteria".

---

### 4. cashMachine
**Status**: ✅ Active (7 stocks in watchlist)  
**Market Cap**: $2B minimum  
**Threshold**: 48 points

**Scoring Logic** (`fundamental-screener.js:609-696`):
- FCF yield tiers: ≥10% (45 pts), ≥8% (35 pts), ≥5% (15 pts)
- FCF growth: >20% and faster than revenue (25 pts), >10% (12 pts)
- Quality metrics: Low debt (15 pts), ROIC >20% (15 pts), negative cash conversion cycle (15 pts)
- Requires ≥3 distinct categories: FCF yield, FCF growth, efficiency, balance sheet
- **Hard gates**:
  - Accrual ratio >12% → rejected
  - Revenue declining >5% AND FCF growth ≤10% → rejected (melting ice cube protection)
  - Quality score <20 → rejected
  - <3 distinct categories → rejected
- **Penalties**:
  - Accrual ratio 8-10% → -15 pts
  - Accrual ratio 10-12% → -25 pts

**Assessment**: Excellent filters. Catches real cash generators while avoiding yield traps.

---

### 5. qarp (Quality At Reasonable Price)
**Status**: ✅ Active (7 stocks in watchlist)  
**Market Cap**: $2B minimum  
**Threshold**: 48 points

**Scoring Logic** (`fundamental-screener.js:698-800+`):
- P/E ceiling: 35 (enforces "reasonable price")
- Quality + value combination scoring
- **Hard gates**:
  - P/E >35 → rejected (too expensive for QARP)
  - Accrual ratio >12% → rejected

**Assessment**: Working as intended. Good balance of quality and value.

---

### 6. qualityCompounder
**Status**: ✅ Active (2 stocks in watchlist)  
**Market Cap**: $2B minimum  
**Threshold**: 48 points

**Scoring Logic** (`fundamental-screener.js:800+`):
- Focuses on high-quality businesses during temporary dips
- Requires strong fundamentals with temporary earnings weakness
- **Note**: Low count (2 stocks) suggests very selective criteria

**Assessment**: Appropriately selective for quality compounders.

---

### 7. turnaround (MISSING FROM ACTIVE WATCHLIST)
**Status**: ❌ Inactive (0 stocks in watchlist)  
**Market Cap**: $500M minimum  
**Threshold**: 48 points

**Scoring Logic** (`fundamental-screener.js:921-1000`):
- Requires BOTH operational improvement AND financial improvement:
  - Operational score ≥20 pts (margin expansion, debt reduction)
  - Financial score ≥15 pts (revenue stabilizing, FCF turning positive)
- **Hard gates**:
  - Debt/Equity >2.0 → rejected (balance sheet must survive recovery)
  - Operational score <20 → rejected
  - Financial score <15 → rejected

**Problem**: Dual requirement is TOO STRICT. Zero stocks pass.

**Recommendation**: Lower thresholds to operational ≥15 AND financial ≥10. This keeps the dual requirement (confirms turnaround is real, not a falling knife) but catches more candidates.

**Rationale**: Turnarounds ARE risky and need confirmation. The dual requirement is sound logic (don't catch falling knives), but current bars are too high. Nike example: needs confirmation of turnaround before investing, but current filters may miss early-stage turnarounds.

---

## SHORT PATHWAYS (1 implemented, 2 missing)

### 8. overvalued
**Status**: ✅ Active (7 stocks in watchlist)  
**Market Cap**: $2B minimum (MIN_SHORT_MARKET_CAP)  
**Dollar Volume**: $20M minimum (MIN_SHORT_DOLLAR_VOLUME)  
**Threshold**: 65 points (SHORT_THRESHOLD)

**Scoring Logic** (`fundamental-screener.js:1006-1032`):
- Requires ALL THREE criteria:
  1. **Extreme valuation** (≥20 pts): P/E >1.5x sector ceiling, PEG >4.0, EV/EBITDA >40
     - Requires ≥2 valuation extremes
     - Uses forward PEG for growth stocks (>15% revenue growth)
  2. **Deteriorating fundamentals** (≥20 pts): Revenue deceleration, margin compression, FCF decline
  3. **Safety check**: Market cap >$2B, liquidity >$20M, short float <15%
- Accrual ratio bonus: >15% adds 15 pts (earnings quality concerns)

**Problem**: ALL shorts are labeled "overvalued" regardless of whether they scored high on valuation vs deterioration. The `scoreDeterioration` function exists but doesn't create a separate pathway.

**Current pathway assignment** (line 1249):
```javascript
c.symbol, c.shortPathway || 'overvalued', c.sector, c.industry, c.shortScore,
```

**Assessment**: Logic is sound but pathway assignment is incomplete. Should distinguish between valuation-driven shorts vs deterioration-driven shorts.

---

### 9. deteriorating (NOT IMPLEMENTED)
**Status**: ❌ Missing (0 stocks in watchlist)  
**Expected Logic**: Stocks with deteriorating fundamentals (declining margins, revenue deceleration, FCF decline)

**Problem**: The `scoreDeterioration` function exists (lines 1087-1118) and is used in short scoring, but there's no separate "deteriorating" pathway assignment.

**Recommendation**: Add pathway assignment logic based on score breakdown:
```javascript
if (valuationScore > deteriorationScore * 1.5) {
  pathway = 'overvalued';
} else if (deteriorationScore > valuationScore * 1.5) {
  pathway = 'deteriorating';
} else {
  pathway = 'overvalued'; // default when both high
}
```

---

### 10. overextended (NOT IMPLEMENTED)
**Status**: ❌ Missing (0 stocks in watchlist)  
**Expected Logic**: Stocks that have run too far too fast (technical overextension)

**Problem**: No implementation found in codebase. Not mentioned in scoring functions.

**Recommendation**: Implement as technical-focused short pathway:
- Price >20% above 200-day MA
- RSI >70 (overbought)
- Parabolic price action (multiple gap-ups)
- High short interest (crowded trade risk)
- Valuation stretched but not extreme

---

## THRESHOLD ANALYSIS

### Long Threshold: 48 points
- Raised from 38 to improve selectivity (62% pass rate was too high)
- Current pass rates by pathway:
  - qarp: 38 stocks (highest)
  - cashMachine: 33 stocks
  - highGrowth: 21 stocks
  - deepValue: 5 stocks
  - inflection: 4 stocks
  - qualityCompounder: 2 stocks
  - turnaround: 0 stocks ❌

**Assessment**: Threshold is working well for most pathways. Turnaround needs filter relaxation, not threshold change.

### Short Threshold: 65 points
- Raised from 50 to match long threshold increase
- Current: 57 stocks labeled "overvalued"
- Requires ALL THREE criteria (valuation + deterioration + safety)

**Assessment**: Appropriately strict for shorts (higher risk). Pathway assignment needs fixing, not threshold.

---

## MARKET CAP REQUIREMENTS

| Pathway | Min Market Cap | Rationale |
|---------|---------------|-----------|
| deepValue | $2B | Quality value vs value traps |
| qarp | $2B | Quality verification |
| qualityCompounder | $2B | Quality verification |
| cashMachine | $2B | 8% FCF yield at $500M = distress signal |
| highGrowth | $500M | Growth emerges small |
| inflection | $500M | Catch early momentum |
| turnaround | $500M | Distress acceptable, upside compensates |
| **All shorts** | **$2B** | Safety requirement |

**Assessment**: Reasonable tiering. Larger caps for quality/value plays, smaller caps allowed for growth/inflection.

---

## ACCRUAL RATIO CHECKS (Earnings Quality)

All pathways reject stocks with accrual ratio >12% (earnings not backed by cash). This is a critical quality filter across the board.

**Tiered penalties**:
- >12%: Hard rejection
- 10-12%: -25 pts penalty
- 8-10%: -15 pts penalty

**Assessment**: Excellent quality control. Prevents investing in companies with questionable earnings quality.

---

## CURRENT WATCHLIST DISTRIBUTION

```sql
SELECT pathway, intent, COUNT(*) as count 
FROM saturday_watchlist 
GROUP BY pathway, intent;
```

**Results** (all statuses: active + pending):
| Pathway | Intent | Count | Notes |
|---------|--------|-------|-------|
| qarp | LONG | 38 | Active in watchlist |
| cashMachine | LONG | 33 | Active in watchlist |
| highGrowth | LONG | 21 | Active in watchlist |
| deepValue | LONG | 5 | Active in watchlist |
| inflection | LONG | 4 | Active in watchlist |
| qualityCompounder | LONG | 2 | Active in watchlist |
| overvalued | SHORT | 57 | Active in watchlist |
| **deteriorating** | **SHORT** | **0** | ❌ Not assigned (logic missing) |
| **overextended** | **SHORT** | **0** | ❌ Not implemented |
| **turnaround** | **LONG** | **0** | ❌ Filters too strict |

**Status breakdown**:
- Saturday screening populates watchlist with `status = 'pending'`
- Sunday Opus review activates top candidates by setting `status = 'active'`
- Counts above include both active and pending stocks

---

## IDENTIFIED ISSUES

### 1. Turnaround Pathway Too Strict
**Problem**: Requires operational ≥20 AND financial ≥15. Zero stocks pass.  
**Fix**: Lower to operational ≥15 AND financial ≥10  
**Rationale**: Keep dual requirement (confirms real turnaround) but catch more candidates

### 2. Missing "deteriorating" Pathway Assignment
**Problem**: Function exists, but all shorts labeled "overvalued"  
**Fix**: Add pathway assignment logic based on valuation vs deterioration score breakdown  
**Location**: `fundamental-screener.js:1249`

### 3. Missing "overextended" Pathway
**Problem**: Not implemented at all  
**Fix**: Implement as technical-focused short pathway (price extension, RSI, momentum)

---

## RECOMMENDATIONS FOR THIRD-PARTY REVIEW

### Questions for Review:

1. **Pathway Logic**: Are the scoring criteria for each pathway sound? Any illogical combinations?

2. **Threshold Levels**: Is 48 pts for longs and 65 pts for shorts appropriate? Too strict or too loose?

3. **Turnaround Filters**: Should turnaround require BOTH operational AND financial improvement, or is OR logic acceptable? What thresholds make sense?

4. **Short Pathway Distinction**: Should we distinguish "overvalued" vs "deteriorating" vs "overextended", or is one "short" pathway sufficient?

5. **Market Cap Requirements**: Are the tiering decisions ($2B for quality, $500M for growth) reasonable?

6. **Accrual Ratio Gates**: Is 12% the right cutoff for rejecting stocks with earnings quality concerns?

7. **Multi-Criteria Requirements**: Several pathways require multiple criteria (inflection needs 2 of 4, cashMachine needs 3 categories). Are these too strict?

---

## APPENDIX: Code References

- **Main screening logic**: `src/fundamental-screener.js`
- **Pathway scoring functions**: Lines 336-1000
- **Short scoring logic**: Lines 1006-1143
- **Threshold definitions**: Lines 49-50
- **Market cap requirements**: Lines 36-45
- **Watchlist update**: Lines 1218-1261
- **Sector-specific configs**: `src/sector-config.js`

---

**End of Document**
