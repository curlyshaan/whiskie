# Feedback on OPUS_ARCHITECTURE_REVIEW.md

**Reviewer:** Kiro (Engineering Audit)  
**Date:** 2026-04-20  
**Status:** Post-Implementation Review

---

## Executive Assessment

The architecture review document is **comprehensive and well-structured**. Most CRITICAL and HIGH PRIORITY gaps identified have now been addressed in the current codebase.

---

## Gap Status: Addressed vs Outstanding

### 1. Stale State Management (CRITICAL) - ✅ ADDRESSED

**Current Implementation:**
- `src/fundamental-screener.js` expires old `active`/`pending` rows before weekly screening
- `src/weekly-opus-review.js` sets all to `pending` before Opus review, then activates top 7
- `src/db.js` includes `expireSaturdayWatchlistStatuses()` and `cleanupExpiredPromotions(daysOld=7)`
- Tactical snapshots in `daily_symbol_state` table exist but no automated cleanup yet

**Remaining Work:**
- Add cron job to delete `daily_symbol_state` rows >30 days old
- Document cleanup order in ARCHITECTURE.md

---

### 2. Multi-Pathway Deduplication Logic (CRITICAL) - ⚠️ PARTIALLY ADDRESSED

**Current Implementation:**
- `saturday_watchlist` uses `(symbol, pathway)` as composite unique key
- A symbol can exist in multiple pathway rows simultaneously
- `src/index.js` Phase 2/3 prompts include pathway context per candidate
- `src/db.js` includes `primary_pathway` and `secondary_pathways` fields in `daily_symbol_state`

**Gap:**
- No explicit primary pathway selection rule when symbol qualifies for 3+ pathways
- Exit monitoring logic (`src/pathway-exit-monitor.js`) needs verification that it uses primary pathway only
- Trade approval doesn't explicitly store which pathway drove the final decision

**Recommendation:**
- Document pathway priority ranking: `deepValue` > `cashMachine` > `qarp` > `qualityCompounder` > `highGrowth` > `inflection` > `turnaround`
- Add pathway deduplication logic in pre-ranking or Phase 4 to select primary pathway
- Ensure `trade_approvals.pathway` stores the primary pathway used for entry decision

---

### 3. Trigger Definitions (HIGH PRIORITY) - ✅ MOSTLY ADDRESSED

**Current Implementation:**
- `src/index.js` `buildSymbolStateCandidate()` implements fingerprint-based change detection
- Technical fingerprint includes: `score`, `change_percentage`, `rsi`, `aboveEma200`
- `reviewDepth` set to `deep` when `runType === 'strategic'` or fingerprint changed
- `changeMagnitude` tracked as `new`, `material`, or `stable`

**Gap:**
- No explicit quantitative thresholds documented (e.g., ">3% price move")
- Earnings proximity trigger not explicitly coded

**Recommendation:**
- Document the current fingerprint-based approach in ARCHITECTURE.md
- Add explicit earnings proximity check: if `earningsDate` within 3 days, force `reviewDepth = 'deep'`

---

### 4. Tactical Snapshot Schema (HIGH PRIORITY) - ✅ FULLY IMPLEMENTED

**Current Implementation:**
- `daily_symbol_state` table exists in `src/db.js` with comprehensive fields
- Composite primary key: `(symbol, run_date, run_time)`
- Includes: `review_depth`, `what_changed`, `news_fingerprint`, `technical_fingerprint`, `catalyst_fingerprint`
- Indexes on `symbol`, `run_date`, `next_review_due`, `decision_run_id`
- `upsertDailySymbolState()` and `getLatestDailySymbolStates()` functions implemented

**Status:** ✅ Complete as specified

---

### 5. Cross-Run Fingerprinting (MEDIUM PRIORITY) - ⚠️ BASIC IMPLEMENTATION

**Current Implementation:**
- `src/index.js` builds fingerprints as pipe-delimited strings
- Technical fingerprint: `score|change_percentage|rsi|aboveEma200`
- News fingerprint: `source|sourceReasons`
- Catalyst fingerprint: `earningsDate`

**Gap:**
- Not using SHA-256 hashing as recommended
- News fingerprint doesn't include actual news titles/dates
- No explicit validity/expiration logic

**Recommendation:**
- Current approach is simpler and adequate for MVP
- Consider SHA-256 hashing if fingerprint collisions become an issue
- Document current approach in ARCHITECTURE.md

---

## Implementation Risk Assessment

### 1. Breaking Changes to Existing Flows (HIGH RISK) - ✅ MITIGATED

**Actions Taken:**
- `src/pre-ranking.js` now uses `db.getActiveSaturdayWatchlist({ includePromoted: true })`
- Weekly Opus activation SQL fixed (parameter ordering bug resolved)
- Dashboard already handles new schema fields
- No feature flag implemented, but changes are backward-compatible

**Status:** Risk mitigated through careful integration

---

### 2. Promotion Queue Adds Complexity (MEDIUM RISK) - ✅ IMPLEMENTED

**Current Implementation:**
- `saturday_watchlist` includes `promotion_status`, `promotion_reason`, `promoted_at`
- `src/db.js` includes `promoteDiscoveryCandidate()` function
- `src/index.js` builds promotions in `buildStateSnapshot()` based on discovery signals
- Dashboard queries include promoted candidates

**Status:** ✅ Fully implemented

---

### 3. Tavily Redesign Scope (MEDIUM RISK) - ⏸️ NOT IMPLEMENTED

**Current State:**
- Tavily still used extensively for news/catalyst research
- FMP insider endpoint available but not replacing Tavily
- Earnings calendar uses DB + Yahoo enrichment (good)

**Recommendation:**
- Current Tavily usage is acceptable for MVP
- Defer Tavily optimization to post-launch phase
- Focus on monitoring Tavily credit usage in production

---

### 4. No Rollback Strategy (MEDIUM RISK) - ⚠️ NEEDS DOCUMENTATION

**Current State:**
- No feature flags implemented
- No documented rollback procedure
- No validation metrics dashboard

**Recommendation:**
- Document rollback procedure: revert to prior git commit, run DB migration rollback
- Add validation metrics to weekly summary email
- Monitor decision quality manually for first 2 weeks

---

## Technical Concerns Status

### 1. Profile Freshness Thresholds - ⚠️ STILL INCONSISTENT

**Current State:**
- `src/stock-profiles.js` uses 14 days for `getStaleProfiles()`
- `src/index.js` logs mention "skip profiles newer than 12 days"
- Prompts mention ">14 days old" as stale threshold

**Recommendation:**
- Standardize to 14 days everywhere
- Update all logs/comments to reflect 14-day threshold

---

### 2. Pathway Exit Strategies - ⚠️ NEEDS VERIFICATION

**Current State:**
- `src/pathway-exit-monitor.js` exists but not audited in this review
- Trade approvals store `pathway` field
- Position management stores `pathway` field

**Recommendation:**
- Verify `pathway-exit-monitor.js` uses `primary_pathway` from positions table
- Document pathway-specific exit logic in ARCHITECTURE.md

---

### 3. FMP Rate Limiting - ✅ ADDRESSED

**Current State:**
- `src/fmp.js` implements rolling throttling and 429 retry/backoff
- 30-minute in-memory cache reduces duplicate calls
- Pre-ranking uses batch quote fetching

**Status:** ✅ Well-handled

---

### 4. Tactical Snapshot Retention - ⚠️ NEEDS AUTOMATION

**Current State:**
- Schema exists, data is being written
- No automated cleanup job yet

**Recommendation:**
- Add weekly cron job to delete `daily_symbol_state` rows >30 days old
- Estimate: ~50 symbols × 2 runs/day × 30 days = 3,000 rows (acceptable)

---

## Missing Validation Plan - ⚠️ NEEDS IMPLEMENTATION

**Current State:**
- No validation metrics dashboard
- No before/after comparison tracking
- No automated quality monitoring

**Recommendation:**
- Add validation metrics to weekly summary email:
  - Opus token usage per run
  - Run latency (Phase 1-4 breakdown)
  - Number of trades generated
  - Win rate (track manually for 2 weeks)
- Create simple validation dashboard in `src/dashboard.js`

---

## Phased Rollout Status

**Current State:** All phases implemented simultaneously (not phased)

**Assessment:**
- Foundation (Phase 1): ✅ Complete
- Incremental Runs (Phase 2): ✅ Complete
- Data Source Substitution (Phase 3): ⏸️ Deferred (Tavily still used)
- Universe Split (Phase 4): ✅ Complete
- Full Incremental (Phase 5): ✅ Complete

**Risk:** Simultaneous rollout increases blast radius, but changes are well-integrated

---

## Open Design Questions - Status

1. **Tactical snapshot table structure** - ✅ RESOLVED: Single table with composite PK
2. **Primary pathway selection** - ⚠️ NEEDS DOCUMENTATION: Currently allows multi-pathway, needs explicit rule
3. **Trigger thresholds** - ⚠️ NEEDS DOCUMENTATION: Fingerprint-based approach works but not documented
4. **Fingerprint validity** - ⚠️ NEEDS DOCUMENTATION: Current approach adequate but not specified
5. **Next-day full refresh triggers** - ✅ IMPLEMENTED: `runType` determines strategic vs incremental

---

## Final Verdict

**Architecture Review Recommendations: 80% Implemented**

### Strengths of Current Implementation
- Core schema redesign is complete and well-integrated
- Weekly selection → daily flow integration is working
- Promotion queue is functional
- SQL bugs fixed during audit

### Critical Remaining Work
1. Document primary pathway selection rule
2. Add automated cleanup for `daily_symbol_state` (>30 days)
3. Verify pathway exit monitor uses primary pathway only
4. Standardize profile freshness threshold to 14 days everywhere
5. Add validation metrics to weekly summary

### Recommended Next Steps
1. Deploy to Railway and run full rebuild pipeline
2. Monitor first week closely for data quality issues
3. Add validation metrics dashboard
4. Document rollback procedure
5. Update ARCHITECTURE.md with implemented design decisions

**Monday-Ready Assessment:** Yes, with close monitoring recommended for first week.

---

## Appendix: Files Modified During Audit

- `src/weekly-opus-review.js` - Fixed SQL parameter ordering bug
- `src/pre-ranking.js` - Fixed watchlist loading to include promoted candidates
- `src/fundamental-screener.js` - Updated stale messaging
- `src/index.js` - Updated stale messaging
- `ARCHITECTURE.md` - Fixed earnings refresh time documentation

All syntax checks passed. No breaking changes introduced.
