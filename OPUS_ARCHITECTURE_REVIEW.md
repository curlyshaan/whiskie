# Whiskie Architecture Review - Third-Party Analysis
**Reviewer:** Claude Opus 4  
**Date:** 2026-04-19  
**Review Scope:** Proposed redesign for long-running daily analysis optimization

---

## Executive Summary

The proposed redesign is **architecturally sound** and addresses real inefficiencies in the current system. The core insight—separating durable company intelligence from tactical trading state—is correct and aligns with institutional PM workflows.

**Recommendation:** Approve with critical implementation requirements documented below.

---

## Key Strengths

### 1. Memory Model Separation (Strong Design)
- `stock_profiles` for stable company research
- New tactical snapshot layer for run-to-run state
- Matches how institutional PMs actually operate
- Reduces redundant company-level re-analysis

### 2. Universe Split (Critical Improvement)
- `saturday_watchlist` as primary deep-analysis universe
- `stock_universe` as discovery-only layer
- Prevents unbounded candidate expansion during market hours
- Preserves continuity and profile reuse

### 3. Incremental Run Design (Practical)
- 10 AM strategic, 2 PM incremental makes operational sense
- Avoids wasteful full rebuilds
- Preserves quality while reducing redundant work
- Next-day incremental by default is correct

### 4. Data Source Optimization (Overdue)
- FMP insider endpoint validated and usable
- Earnings calendar already in DB
- Tavily should focus on news/catalysts, not structured data lookups
- Reduces unnecessary API costs

---

## Critical Design Gaps (Must Address Before Implementation)

### 1. Stale State Management (CRITICAL)
**Problem:** Weekly refresh must explicitly expire old `active` rows, but lifecycle rules are underspecified.

**Required Specification:**
- Weekly refresh: expire all `active` → `expired` before new activation
- Promotion queue: expire after 7 days if not activated
- Tactical snapshots: delete rows >30 days old
- Document cleanup order to prevent race conditions

**Risk if not addressed:** Stale data persists and pollutes daily runs, causing incorrect candidate selection.

---

### 2. Multi-Pathway Deduplication Logic (CRITICAL)
**Problem:** How is primary pathway selected when symbol qualifies for 3+ pathways?

**Required Specification:**
- Define selection rule: highest score? Most recent? Pathway priority ranking?
- Recommend: highest fundamental score wins, or pathway priority ranking (e.g., `deepValue` > `qarp` > `qualityCompounder`)
- Document how secondary pathways are preserved
- Specify how this affects downstream trade management and exit strategies

**Risk if not addressed:** Inconsistent pathway assignment breaks exit monitoring and position management.

---

### 3. Trigger Definitions (HIGH PRIORITY)
**Problem:** "Material change" needs quantitative thresholds.

**Required Specification:**
- Price move: >3% intraday escalates to deep refresh
- Volume: >2x average escalates to deep refresh
- News: major catalyst categories (earnings, M&A, guidance, insider activity)
- Technical: support/resistance breaks, moving average crosses
- Earnings proximity: <3 days requires deep refresh

**Risk if not addressed:** "Light refresh" vs "deep refresh" becomes subjective and inconsistent.

---

### 4. Tactical Snapshot Schema (HIGH PRIORITY)
**Problem:** Single table or multiple tables? Retention policy? Index strategy?

**Recommended Schema:**
```sql
CREATE TABLE daily_symbol_state (
  symbol VARCHAR(10) NOT NULL,
  run_date DATE NOT NULL,
  run_time TIME NOT NULL,
  run_type VARCHAR(30) NOT NULL, -- '10am_full', '2pm_incremental', 'nextday_incremental'
  primary_pathway VARCHAR(30),
  secondary_pathways TEXT[], -- array of pathway names
  last_thesis TEXT,
  last_conviction VARCHAR(20), -- 'high', 'medium', 'low'
  last_action VARCHAR(20), -- 'buy', 'short', 'hold', 'pass'
  news_fingerprint VARCHAR(64), -- hash of recent news content
  technical_fingerprint VARCHAR(64), -- hash of technical state
  catalyst_fingerprint VARCHAR(64), -- hash of catalyst state
  what_changed TEXT, -- summary of changes since prior run
  next_review_due TIMESTAMP,
  escalation_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (symbol, run_date, run_time)
);

CREATE INDEX idx_daily_symbol_state_symbol ON daily_symbol_state(symbol);
CREATE INDEX idx_daily_symbol_state_run_date ON daily_symbol_state(run_date);
CREATE INDEX idx_daily_symbol_state_next_review ON daily_symbol_state(next_review_due);
```

**Retention:** 30 days rolling, delete rows older than 30 days in weekly cleanup.

**Risk if not addressed:** Implementation will be ad-hoc and difficult to query efficiently.

---

### 5. Cross-Run Fingerprinting (MEDIUM PRIORITY)
**Problem:** How are news/technical/catalyst fingerprints computed?

**Recommended Approach:**
- News fingerprint: SHA-256 hash of concatenated recent news titles + dates (last 7 days)
- Technical fingerprint: hash of `{price, volume, RSI, MACD, support/resistance levels}`
- Catalyst fingerprint: hash of `{earnings_date, insider_activity, analyst_changes}`
- Validity: same-day fingerprints valid until next run; cross-day fingerprints expire at market open

**Risk if not addressed:** Reuse logic will be unreliable and may miss important changes.

---

## Implementation Risks

### 1. Breaking Changes to Existing Flows (HIGH RISK)
**Problem:** Pre-ranking currently merges universe + watchlist during market hours. Changing this affects Phase 1 → Phase 2 handoff.

**Mitigation:**
- Document current data flow: `pre-ranking.js` → `index.js` Phase 2/3
- Create migration path with feature flag to toggle old/new behavior
- Test both off-market and in-market scenarios before full cutover
- Update dashboard, approvals, and execution to handle new data model

---

### 2. Promotion Queue Adds Complexity (MEDIUM RISK)
**Problem:** New DB fields/tables required, UI must surface promoted names.

**Mitigation:**
- Add `promotion_queue` table or `status='promoted'` to `saturday_watchlist`
- Update dashboard to show promoted names separately
- Weekly refresh must handle promoted → active transitions
- Document promotion criteria and lifecycle

---

### 3. Tavily Redesign Scope is Large (MEDIUM RISK)
**Problem:** Current code has ~15+ Tavily call sites. Replacing with FMP/DB/Yahoo requires careful validation.

**Mitigation:**
- Phase the rollout: start with insider activity and earnings date substitutions
- Keep Tavily for news/catalyst discovery initially
- Add cache/fingerprint logic incrementally
- Validate decision quality doesn't degrade

---

### 4. No Rollback Strategy (MEDIUM RISK)
**Problem:** If incremental runs produce worse decisions, how do you detect it?

**Mitigation:**
- Add validation metrics (see below)
- Keep feature flag to revert to full runs
- Monitor decision quality for 2 weeks after rollout
- Document rollback procedure

---

## Specific Technical Concerns

### 1. Profile Freshness Thresholds are Inconsistent
**Current State:** Code has both 12-day and 14-day checks.

**Recommendation:** Standardize to 14 days everywhere, or document why different thresholds exist.

---

### 2. Pathway Exit Strategies Depend on Pathway Field
**Problem:** If you dedupe symbols across pathways, which pathway drives exit logic?

**Recommendation:** Use primary pathway only for exit strategy. Document this clearly in `pathway-exit-monitor.js`.

---

### 3. FMP Rate Limiting is Already Tight
**Current State:** 300 calls/minute on Starter tier.

**Recommendation:** Validate total call budget doesn't exceed limits after adding insider lookups. Consider batching or caching.

---

### 4. Tactical Snapshot Retention is Unclear
**Problem:** How long do you keep run snapshots? Disk/DB growth implications?

**Recommendation:** 30 days rolling retention. Estimate: ~50 symbols × 2 runs/day × 30 days = 3,000 rows. Acceptable.

---

## Missing Validation Plan

The spec lists validation scenarios but no success criteria.

### Required Validation Metrics

**Before/After Comparison:**
- Tavily credit usage (target: 50% reduction)
- Opus token usage (target: 30% reduction)
- Run latency (target: 40% reduction for 2 PM runs)
- Decision quality: track win rate, Sharpe ratio, max drawdown

**Incremental Run Quality:**
- Track: incremental run decision changes vs full run baseline
- Track: missed opportunities (symbols that moved >5% but weren't deeply analyzed)
- Alert if incremental run misses >2 material moves per week

**Data Source Substitution:**
- Validate FMP insider data matches Tavily quality
- Validate earnings calendar + Yahoo timing matches Tavily
- Track any decision quality degradation

---

## Phased Rollout Recommendation

**Phase 1: Foundation (Week 1-2)**
- Implement tactical snapshot schema
- Implement symbol dedupe across pathways
- Add stale-state cleanup to weekly refresh
- Validate with off-market runs only

**Phase 2: Incremental Runs (Week 3-4)**
- Implement trigger engine for deep vs light refresh
- Enable 2 PM incremental runs
- Monitor decision quality vs full runs
- Keep 10 AM as full run initially

**Phase 3: Data Source Substitution (Week 5-6)**
- Replace Tavily earnings lookups with DB + Yahoo
- Replace Tavily insider lookups with FMP
- Add Tavily cache/fingerprint logic
- Validate decision quality

**Phase 4: Universe Split (Week 7-8)**
- Implement discovery universe layer
- Implement promotion queue
- Update dashboard for promoted names
- Enable in-market discovery without expanding deep-analysis universe

**Phase 5: Full Incremental (Week 9+)**
- Enable next-day 10 AM incremental runs
- Monitor for 2 weeks
- Document rollback procedure
- Finalize

---

## Open Design Questions (Require Decisions)

1. **Tactical snapshot table structure:** Single table or separate run-level + symbol-level tables?
   - **Recommendation:** Single table with composite primary key `(symbol, run_date, run_time)`.

2. **Primary pathway selection:** Highest score? Pathway priority ranking?
   - **Recommendation:** Highest fundamental score wins. Document tie-breaking rule.

3. **Trigger thresholds:** What exact values?
   - **Recommendation:** See "Trigger Definitions" section above.

4. **Fingerprint validity:** How long are same-day and cross-day fingerprints valid?
   - **Recommendation:** Same-day valid until next run; cross-day expire at market open.

5. **Next-day full refresh triggers:** When should a next-day 10 AM run force a full refresh?
   - **Recommendation:** VIX spike >20%, SPY move >2%, major macro event, or >5 symbols with material changes.

---

## Final Recommendation

**Approve the redesign with the following requirements:**

1. **Before coding:** Address all CRITICAL and HIGH PRIORITY gaps documented above.
2. **Implementation:** Follow phased rollout plan to limit blast radius.
3. **Validation:** Implement all required metrics and monitor for 2 weeks after each phase.
4. **Documentation:** Update `ARCHITECTURE.md` and `README.md` with new behavior.
5. **Rollback:** Document rollback procedure and keep feature flags for 30 days post-launch.

**The design is sound. The execution plan needs more rigor.**

---

## Appendix: Current System Observations

### Confirmed Behaviors
- `stock_profiles` refresh weekly on Sunday 3 PM ET
- Profile freshness: <14 days = incremental update, >14 days = full rebuild
- Weekly Opus review activates top 7 per pathway
- Off-market runs use active watchlist only
- In-market runs merge active watchlist + broader universe (causes expansion)
- FMP insider endpoint validated and usable
- Current Phase 2 token usage: ~436k input tokens for 46 candidates (too high)

### Key Files to Modify
- `src/pre-ranking.js` - universe split logic
- `src/index.js` - run orchestration, incremental mode
- `src/stock-profiles.js` - profile reuse logic
- `src/weekly-opus-review.js` - stale-state cleanup
- `src/db.js` or `src/db-schema-v2.js` - tactical snapshot schema
- `src/tavily.js` - cache/fingerprint logic
- `src/fmp.js` - insider activity integration

### Risk Areas
- `src/dashboard.js` - must handle new data model
- `src/trade-approval.js` - must handle pathway dedupe
- `src/pathway-exit-monitor.js` - must use primary pathway only
- `src/trade-executor.js` - must respect promotion state
