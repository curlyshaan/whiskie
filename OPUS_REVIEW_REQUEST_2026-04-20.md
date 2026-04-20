# OPUS Review Request for Whiskie

Please review the current Whiskie redesign from a prompt-quality, decision-quality, and strategic integration perspective.

## Scope to review

Focus on these areas:

1. Main daily Opus decision flow in `src/index.js`
   - Phase 2 long prompt
   - Phase 3 short prompt
   - Phase 4 portfolio construction prompt
   - whether the redesigned schema metadata is being used effectively, not just included
   - whether prompt instructions are internally consistent
   - whether there are gaps, contradictions, redundant context, or weak framing

2. Weekly Opus review flow in `src/weekly-opus-review.js`
   - whether the prompt uses watchlist/profile/fundamental context correctly
   - whether the ranking logic is coherent with the weekly selection design
   - whether the output contract is strong enough for activation decisions

3. Adhoc Analyzer in `src/adhoc-analyzer.js`
   - whether the prompt is genuinely aligned with Whiskie core logic
   - whether it uses the new weekly selection metadata, earnings metadata, and profile context well
   - whether its outputs are decision-useful and consistent with the main Whiskie system

4. Earnings-aware decision quality
   - review `src/earnings-analysis.js`
   - review `src/weekly-review.js`
   - review whether canonical earnings fields (`session_normalized`, `timing_raw`) are used appropriately in prompts and outputs
   - whether any important earnings-risk logic is still missing

5. Strategic integration review
   - does the new schema design actually improve decision quality?
   - are there important prompt/context changes still missing?
   - is any of the added metadata not worth keeping because it adds noise without improving decisions?

## What to return

Please return:

1. High-confidence problems only
2. Specific recommendations for prompt improvements
3. Any cases where the new schema/context is being passed but not used meaningfully
4. Any contradictions between weekly flow, daily flow, adhoc flow, and earnings flow
5. A final verdict on whether Whiskie is truly Monday-ready from a decision/prompt perspective

## Important constraint

Do not spend time reviewing unrelated generic code quality unless it directly affects:
- prompt quality
- decision quality
- schema-to-prompt integration
- workflow coherence

## Relevant files

- `src/index.js`
- `src/weekly-opus-review.js`
- `src/adhoc-analyzer.js`
- `src/weekly-review.js`
- `src/earnings-analysis.js`
- `src/db.js`
- `src/dashboard.js`
- `src/stock-profiles.js`
- `src/earnings-reminders.js`
