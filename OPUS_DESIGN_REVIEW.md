# Opus Design Review - Whiskie Trading Bot

**Date**: 2026-04-12  
**Reviewer**: Claude Opus 4.6 (30k thinking budget)

## Executive Summary

**Overall Assessment**: Strong foundation with solid screening logic and 4-phase analysis structure. However, significant execution and risk management gaps that must be addressed before production use.

**Core Strengths**:
- Combined long + short screening prevents overvalued-stock-blindness
- 4 independent long pathways catch diverse opportunities
- Stock profile system reduces redundant research
- Tiered FMP caching is cost-effective

**Critical Gaps**:
- Inadequate meme stock protection for shorts
- No intraday position monitoring (only EOD checks)
- No correlation analysis (could recommend 3 correlated stocks)
- No circuit breakers (max trades/day, max weekly loss)
- Learning insights are write-only (no feedback loop)

---

## Detailed Assessment

### 1. Overall Architecture ✅ (with caveats)

**What works**:
- Single-pass evaluation of all 407 stocks is efficient
- Combined long + short screening prevents blind spots
- 4-phase separation allows different thinking budgets

**Issues**:
- No feedback loop from Sunday insights to daily analysis
- No portfolio-level risk metrics (beta, Sharpe, max drawdown)
- Static 407 stock universe (no IPO additions, delisting removals)

---

### 2. Long Pathways - Missing 2 Key Strategies ⚠️

**Current pathways (solid)**:
- ✅ Deep Value: Traditional Graham/Buffett
- ✅ High Growth: Momentum plays
- ✅ Inflection Point: Q-over-Q acceleration (catches NVDA-type stocks)
- ✅ Cash Machine: FCF/dividend plays

**Missing pathways**:

#### A. Turnaround Situations
Stocks with improving metrics but poor TTM numbers won't pass any pathway until turnaround is complete.

**Add criteria**:
- Debt reduction (debt/equity declining 20%+ YoY)
- Margin expansion (operating margin improving 3+ percentage points)
- Management change (new CEO/CFO within 12 months)
- Revenue stabilization (after decline, now flat or growing)

#### B. Quality at Reasonable Price (QARP)
High ROIC/ROE compounders at fair valuations. Deep Value requires P/E <15, missing quality businesses at P/E 20-25.

**Add pathway**:
- ROIC >15%
- ROE >20%
- P/E 15-25 (reasonable, not cheap)
- Consistent earnings growth (positive 8 of last 10 quarters)

---

### 3. Short Safety - INADEQUATE ❌

**Current protections have holes**:

#### Issue 1: Short float <20% is not enough
GME had ~15% short float before squeeze. Real metric is **days to cover**.

**Fix**: 
- Change threshold to <15% (not 20%)
- Add days-to-cover check: reject if >5 days
- Formula: short interest / avg daily volume

#### Issue 2: IV <80% is arbitrary
Stock can have IV 75% and still be meme stock.

**Fix**:
- Use **IV percentile** (current IV vs 1-year history)
- Reject if IV is in 90th percentile or higher
- This catches stocks with elevated IV relative to their own history

#### Issue 3: Missing borrow fee rate
High borrow costs signal crowded short and squeeze risk.

**Fix**:
- Add borrow fee check at execution time
- Reject if >10% annually
- Reduce position to 5% if 5-10%

#### Issue 4: No social sentiment monitoring
Reddit/Twitter buzz is leading indicator.

**Fix** (optional, medium-term):
- Integrate LunarCrush or Stocktwits API
- Flag high-buzz stocks (>90th percentile mentions)

#### Issue 5: No recent squeeze history
Stock that squeezed 3 months ago could squeeze again.

**Fix**:
- Check for >50% move in past 6 months
- If yes, avoid shorting

**Recommended short safety stack**:

**Screening time (Saturday 3pm)**:
- Short float <15% (not 20%)
- Days to cover <5
- Market cap >$2B
- Volume >$20M/day

**Execution time (every 5 min)**:
- IV percentile <90%
- Borrow fee <10%
- ETB verified
- No recent squeeze (>50% move in 6 months)

---

### 4. Stock Profile System - Needs Event-Driven Updates ⚠️

**Issues with biweekly refresh**:

#### Issue 1: Catalyst blindness
Stock announces earnings/FDA approval 1 day after refresh → profile stale for 13 days.

**Fix**:
- Keep biweekly baseline
- Add event-driven triggers:
  - Earnings announcements
  - FDA decisions (biotech/pharma)
  - Major news (>5% price move)
  - Analyst upgrades/downgrades

#### Issue 2: One-size-fits-all refresh
Some sectors need weekly (biotech), others monthly (utilities).

**Fix**:
- Biotech/pharma: weekly refresh
- Tech/consumer: biweekly (current)
- Utilities/staples: monthly

#### Issue 3: Quality flag permanence
Penny stock that graduates to legitimate company stays flagged.

**Fix**:
- Re-evaluate quality flags quarterly
- Allow stocks to "graduate" from skip list

---

### 5. Token Budget Misallocation ⚠️

**Current budgets**:
- Phase 1: unspecified
- Phase 2: 50k (long analysis)
- Phase 3: 50k (short analysis)
- Phase 4: 20k (portfolio construction)

**Issues**:

1. **Phase 2/3 at 50k might be overkill**: If profiles are comprehensive, 30-35k should suffice
2. **Phase 4 at 20k is too light**: Portfolio construction with sector constraints, correlation, risk management needs 40-50k
3. **No feedback loop**: If Phase 4 rejects all recommendations, does it loop back?

**Recommended budgets**:
- Phase 1: 10k (if doing analysis)
- Phase 2: 35k (reduced from 50k)
- Phase 3: 35k (reduced from 50k)
- Phase 4: 45k (increased from 20k)

**Total savings**: 100k → 90k per analysis (10% reduction)

---

### 6. Critical Risks and Gaps

#### IMMEDIATE PRIORITIES (Must fix before production):

1. **No intraday position monitoring** ❌
   - Positions only checked at 4:30pm EOD
   - If stock gaps down 20% at 11am, no stop loss triggers
   - **Fix**: Add 15-minute position monitoring during market hours

2. **No correlation analysis** ❌
   - Could recommend 3 semiconductor longs that move in lockstep
   - **Fix**: Add correlation matrix in Phase 4, reject if >0.7 correlation to existing holdings

3. **No circuit breakers** ❌
   - System could execute 20 trades in one day or lose 10% in a week
   - **Fix**: Max 5 trades/day, max 5% weekly loss, pause trading if triggered

4. **No earnings calendar integration** ❌
   - System checks earnings dates but doesn't systematically avoid trading into earnings
   - **Fix**: Block trades 3 days before earnings (too much event risk)

5. **Learning insights are write-only** ❌
   - Sunday review generates insights but no mechanism to feed back into daily analysis
   - **Fix**: Add insights context to Phase 2/3 - "Last week we learned X, consider Y"

#### MEDIUM-TERM ENHANCEMENTS:

6. **No portfolio-level risk metrics**
   - No beta, Sharpe ratio, max drawdown, VaR calculation
   - **Fix**: Add daily portfolio risk dashboard

7. **OCO order fragility**
   - What if stop hits but positions table doesn't update?
   - **Fix**: Add hourly order status reconciliation (verify positions match broker state)

8. **No liquidity analysis for exits**
   - System checks volume at entry but not exit
   - 15% position in low-volume stock could be hard to exit
   - **Fix**: Position size should be <10% of avg daily volume

9. **No macro regime detection beyond VIX**
   - What about interest rates, recession indicators, sector rotation?
   - **Fix**: Add macro dashboard (Fed policy, yield curve, unemployment, sector momentum)

10. **No handling of corporate actions**
    - Stock splits, dividends, mergers, delistings
    - **Fix**: Add corporate action monitoring, adjust positions automatically or flag for review

#### LONG-TERM CONSIDERATIONS:

11. **No partial fill handling**
    - What if you try to buy 100 shares but only get 50?
    - **Fix**: Retry up to 3 times, then adjust position size proportionally

12. **FMP data quality assumptions**
    - System assumes FMP data is accurate
    - **Fix**: Add data validation (check for outliers: P/E >1000, negative revenue)

13. **No short covering strategy**
    - No analysis of how to exit shorts
    - **Fix**: If borrow fee >15% or IV >100%, cover immediately

14. **Static 407 stock universe**
    - How are stocks added/removed? What about IPOs?
    - **Fix**: Quarterly universe review (add IPOs >6 months old, remove delistings)

15. **Market microstructure ignored**
    - No consideration of bid-ask spreads, market impact
    - System just sends market orders
    - **Fix**: Use limit orders with 0.5% buffer from mid-price, timeout after 5 minutes

---

## Implementation Roadmap

### Phase 1: Critical Safety (Week 1-2)
**Must complete before production use**

1. Add days-to-cover metric for shorts (reject if >5)
2. Add borrow fee rate check (reject if >10%)
3. Add IV percentile check (reject if >90th percentile)
4. Add intraday stop loss monitoring (every 15 min)
5. Add circuit breakers (max 5 trades/day, max 5% weekly loss)
6. Add earnings calendar integration (block trades 3 days before earnings)
7. Add correlation analysis in Phase 4 (reject if >0.7 correlation)

### Phase 2: Risk Management (Week 3-4)

8. Add portfolio risk metrics (beta, Sharpe, max drawdown)
9. Add learning feedback loop (feed Sunday insights into daily analysis)
10. Increase Phase 4 token budget to 45k
11. Add exit liquidity analysis (position <10% of daily volume)
12. Add order status reconciliation (hourly broker state sync)

### Phase 3: Enhanced Screening (Week 5-6)

13. Add QARP pathway (ROIC >15%, ROE >20%, P/E 15-25)
14. Add Turnaround pathway (debt reduction, margin expansion, management change)
15. Add event-driven profile refresh (earnings, major news)
16. Add sector-specific refresh frequencies (biotech weekly, utilities monthly)

### Phase 4: Operational Hardening (Week 7-8)

17. Add macro regime detection (Fed policy, yield curve, sector rotation)
18. Add data validation layer (outlier detection, missing data handling)
19. Add corporate action handling (splits, dividends, mergers)
20. Add partial fill logic (retry + proportional adjustment)
21. Add quarterly universe review (IPOs, delistings, rebalancing)

---

## Final Verdict

**The core design is solid, but execution and risk management need significant hardening before production use.**

The system is optimized for finding opportunities but under-optimized for managing risk and handling edge cases. The screening logic is thoughtful (4 pathways, combined long/short), but the safety mechanisms are insufficient for real money.

**Recommendation**: Complete Phase 1 (Critical Safety) before deploying with real capital. The current system could work in paper trading, but the lack of intraday monitoring, circuit breakers, and correlation analysis creates unacceptable risk for live trading.

**Estimated effort**: 
- Phase 1 (critical): 2-3 weeks
- Phase 2 (risk mgmt): 2 weeks
- Phase 3 (enhanced screening): 2 weeks
- Phase 4 (operational): 2 weeks

**Total**: 8-9 weeks to production-ready state.
