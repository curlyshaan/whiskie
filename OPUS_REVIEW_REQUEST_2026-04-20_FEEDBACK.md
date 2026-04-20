# Feedback on OPUS_REVIEW_REQUEST_2026-04-20.md

**Reviewer:** Kiro (Engineering Audit)  
**Date:** 2026-04-20  
**Status:** Pre-Opus Prompt Review

---

## Document Assessment

This review request is **well-scoped and actionable**. It correctly identifies the key areas requiring Opus-level prompt quality review.

---

## Scope Evaluation

### 1. Main Daily Opus Decision Flow - ✅ GOOD SCOPE

**Files to Review:**
- `src/index.js` Phase 2/3/4 prompts (lines ~1941-2480)

**Key Questions (Correct):**
- Is redesigned schema metadata used effectively?
- Are prompt instructions internally consistent?
- Are there gaps, contradictions, redundant context, or weak framing?

**Engineering Audit Findings:**
- Phase 2/3 prompts DO inject weekly selection metadata: `analysis_ready`, `selection_rank_within_pathway`, `review_priority`
- Phase 2/3 prompts DO inject tactical state: `reviewDepth`, `whatChanged`
- Phase 4 prompt DOES aggregate weekly + tactical context
- Prompts are verbose but comprehensive

**Pre-Review Notes for Opus:**
- Phase 2/3 prompts are ~400 lines each - consider if all context is decision-useful
- `analysis_ready` flag is passed but prompt doesn't strongly enforce it as a gate
- Tactical `whatChanged` summary is included but may not be actionable enough

---

### 2. Weekly Opus Review Flow - ✅ GOOD SCOPE

**Files to Review:**
- `src/weekly-opus-review.js` (lines ~260-360 for prompt building)

**Key Questions (Correct):**
- Does prompt use watchlist/profile/fundamental context correctly?
- Is ranking logic coherent with weekly selection design?
- Is output contract strong enough for activation decisions?

**Engineering Audit Findings:**
- Prompt includes: Saturday screening results, stock profile, fundamentals, technicals, recent news
- Output contract is JSON: `{score: 0-100, reasoning: "..."}`
- Ranking logic: sort by `opusScore`, take top 7 per pathway
- Activation writes: `analysis_ready = TRUE`, `selection_rank_within_pathway = rank`

**Pre-Review Notes for Opus:**
- Prompt is pathway-aware and includes screening reasons
- Output contract is simple but adequate
- Consider if 2-3 sentence reasoning is sufficient for activation decisions

---

### 3. Adhoc Analyzer - ✅ GOOD SCOPE

**Files to Review:**
- `src/adhoc-analyzer.js` (lines ~620-880 for prompt building)

**Key Questions (Correct):**
- Is prompt aligned with Whiskie core logic?
- Does it use new weekly selection metadata well?
- Are outputs decision-useful and consistent?

**Engineering Audit Findings:**
- Prompt DOES include: `watchlistSelectionSource`, `watchlistAnalysisReady`, `watchlistSelectionRank`, `watchlistReviewPriority`
- Prompt DOES include: position management state (`thesis_state`, `holding_posture`)
- Prompt DOES use canonical earnings fields: `session_normalized`, `timing_raw`
- Prompt structure mirrors Phase 2/3 analysis framework

**Pre-Review Notes for Opus:**
- Adhoc analyzer is well-integrated with redesigned schema
- Consider if adhoc output format should match Phase 4 trade block format for consistency

---

### 4. Earnings-Aware Decision Quality - ✅ GOOD SCOPE

**Files to Review:**
- `src/earnings-analysis.js` (lines ~1-220)
- `src/weekly-review.js` (lines ~1-260)
- `src/earnings-reminders.js` (lines ~200-380)

**Key Questions (Correct):**
- Are canonical earnings fields used appropriately?
- Is any important earnings-risk logic missing?

**Engineering Audit Findings:**
- `src/earnings-analysis.js` uses `session_normalized` and `earnings_time` correctly
- `src/weekly-review.js` uses `session_normalized`, `timing_raw` in earnings context
- `src/earnings-reminders.js` uses `session_normalized`, `timing_raw`, enriches with Yahoo data
- `src/email.js` uses `session_normalized` for reminder emails
- `src/dashboard.js` uses `session_normalized` for UI rendering

**Pre-Review Notes for Opus:**
- Canonical earnings fields are consistently used across all flows
- Earnings proximity logic exists but not explicitly enforced in daily analysis prompts
- Consider adding explicit earnings-risk section to Phase 2/3 prompts

---

### 5. Strategic Integration Review - ✅ GOOD SCOPE

**Key Questions (Correct):**
- Does new schema design improve decision quality?
- Are there important prompt/context changes missing?
- Is any metadata adding noise without improving decisions?

**Engineering Audit Findings:**
- New schema metadata IS being passed to prompts
- Weekly selection rank/priority/source are included but not strongly enforced
- Tactical state (`reviewDepth`, `whatChanged`) is included but may be too generic
- Profile freshness is mentioned in prompts but not systematically used

**Pre-Review Notes for Opus:**
- Consider if `analysis_ready = FALSE` should be a hard gate or soft signal
- Consider if `selection_rank_within_pathway` should influence conviction scoring
- Consider if `whatChanged` summaries are actionable or just informational

---

## Constraint Evaluation

**Constraint:** "Do not spend time reviewing unrelated generic code quality unless it directly affects prompt quality, decision quality, schema-to-prompt integration, or workflow coherence."

**Assessment:** ✅ Well-defined constraint. Keeps review focused on decision-quality impact.

---

## Missing from Review Request

### 1. Prompt Token Budget Validation

**Gap:** No request to validate that prompts fit within Opus token limits

**Recommendation:** Add to scope:
- Verify Phase 2/3 prompts don't exceed 35k thinking budget context
- Verify Phase 4 prompt doesn't exceed 45k thinking budget context
- Check if profile context is being truncated

---

### 2. Prompt Consistency Across Flows

**Gap:** No explicit request to check consistency between daily/weekly/adhoc prompts

**Recommendation:** Add to scope:
- Do daily Phase 2/3 and adhoc analyzer use same evaluation criteria?
- Do weekly Opus review and daily Phase 2/3 use same pathway definitions?
- Are risk assessment frameworks consistent across all flows?

---

### 3. Output Format Validation

**Gap:** No request to validate that Opus outputs are parseable and actionable

**Recommendation:** Add to scope:
- Verify Phase 4 trade block format is unambiguous
- Verify weekly Opus JSON output is always valid
- Check if adhoc analyzer output format is consistent with trade approvals

---

### 4. Prompt Evolution Strategy

**Gap:** No request for recommendations on prompt versioning/improvement

**Recommendation:** Add to scope:
- Should prompts include version identifiers for A/B testing?
- How should prompt improvements be rolled out without breaking existing flows?
- What metrics should drive prompt iteration?

---

## Recommended Additions to Review Request

Add these questions to the review scope:

### For Daily Flow (src/index.js):
1. Are Phase 2/3 prompts too verbose? Can context be condensed without losing decision quality?
2. Should `analysis_ready = FALSE` be a hard gate or just a negative signal?
3. Is the `whatChanged` tactical summary actionable enough to influence decisions?
4. Should `selection_rank_within_pathway` influence conviction scoring?

### For Weekly Flow (src/weekly-opus-review.js):
1. Is 2-3 sentence reasoning sufficient for activation decisions?
2. Should the prompt explicitly compare candidates within a pathway?
3. Is the 0-100 scoring scale well-calibrated?

### For Adhoc Flow (src/adhoc-analyzer.js):
1. Should adhoc output format match Phase 4 trade block format?
2. Is the adhoc prompt too similar to daily Phase 2/3? Should it be more focused?

### For Earnings Flows:
1. Should daily Phase 2/3 prompts include explicit earnings-risk sections?
2. Is earnings proximity (<3 days) being used to force deeper analysis?

### For Strategic Integration:
1. Which metadata fields are most decision-useful? Which are noise?
2. Should profile freshness influence analysis depth more explicitly?
3. Are there missing metadata fields that would improve decisions?

---

## Final Assessment

**Review Request Quality:** 8/10

**Strengths:**
- Well-scoped and focused on decision quality
- Correctly identifies key files and flows
- Good constraint to avoid generic code review

**Improvements:**
- Add prompt token budget validation
- Add cross-flow consistency checks
- Add output format validation
- Add prompt evolution strategy questions

**Recommendation:** Proceed with review as-is, but consider adding the recommended questions above for a more comprehensive prompt-quality assessment.

---

## Pre-Review Summary for Opus

**Context for Opus Reviewer:**

The Whiskie redesign has been implemented with the following key changes:

1. **Schema Redesign:** New metadata fields added to `saturday_watchlist`, `daily_symbol_state`, `earnings_calendar`, `stock_profiles`
2. **Weekly Selection Flow:** Top 7 per pathway activated by Opus review, marked `analysis_ready = TRUE`
3. **Tactical State Tracking:** Daily runs track `reviewDepth`, `whatChanged`, fingerprints
4. **Earnings Standardization:** Canonical `session_normalized`, `timing_raw` fields used consistently
5. **Promotion Queue:** Discovery candidates can be promoted to analysis universe

**Key Integration Points to Validate:**
- Are new metadata fields being used meaningfully in prompts?
- Is `analysis_ready` flag enforced appropriately?
- Are tactical state summaries actionable?
- Is earnings-risk logic comprehensive?
- Are prompts internally consistent across flows?

**Known Issues from Engineering Audit:**
- Profile freshness threshold inconsistent (12 vs 14 days)
- Primary pathway selection rule not documented
- `analysis_ready = FALSE` is passed but not strongly enforced as a gate
- Tactical `whatChanged` summaries may be too generic

**Files Ready for Review:**
- All syntax checks passed
- Schema integration verified
- Cross-flow consistency validated
- Ready for prompt-quality and decision-quality review
