# Serper Integration Review

## Scope
This review covers Whiskie modules that rely on `src/serper.js` and `src/news-search.js` for market/news context used in live trading and Portfolio Hub decision-making.

Reviewed modules include:
- `src/serper.js`
- `src/news-search.js`
- `src/services/news-cache-service.js`
- `src/portfolio-hub.js`
- `src/analysis.js`
- `src/order-manager.js`
- `src/pre-market-scanner.js`
- `src/earnings-analysis.js`
- `src/earnings-reminders.js`
- `src/stock-profiles.js`
- `src/catalyst-research.js`
- `src/index.js`
- `src/db.js`

## Executive Summary
Whiskie is broadly integrated with Serper and is already using structured search helpers rather than one-off raw queries in most critical workflows. The integration is directionally strong, but there are two quality risks for a live-trading system: silent degradation to empty news context and uneven result quality from broad query construction / weak domain controls.

Overall assessment: **materially improved after hardening, with tiered retrieval now in place, but still worth continued live tuning for sparse-symbol and premarket scenarios**.

## Architecture Overview
Whiskie currently uses this pipeline:
1. `src/serper.js` builds tiered search/news requests to Serper and applies in-memory caching, cooldown behavior, source-tier logic, and result normalization.
2. `src/news-search.js` enriches Serper results by fetching full articles and summarizing them with Claude.
3. Feature modules consume either direct structured search methods or `news-cache-service`.
4. Search usage is logged to Postgres via `serper_usage_events`.

Key workflow entry points:
- Daily analysis: `src/index.js`
- Portfolio Hub market + holding review context: `src/portfolio-hub.js`
- Position monitoring / order review: `src/analysis.js`, `src/order-manager.js`
- Earnings flows: `src/earnings-analysis.js`, `src/earnings-reminders.js`
- Premarket scanning: `src/pre-market-scanner.js`
- Profile building / catalyst research: `src/stock-profiles.js`, `src/catalyst-research.js`
- Chat endpoint: `src/index.js`

## Live Validation Findings
I ran live Serper checks with the provided API key against representative workflows.

### 2026-04-30 META workflow quality spot-check
I ran direct live Serper `news`-engine checks centered on `META` and compared simpler versus more structured query shapes across Whiskie workflows.

Representative checks:
- Daily Run market context: `stock market news today earnings fed inflation`
- Stock Profile: `"Meta Platforms" META company news strategy outlook`
- Earnings: `"Meta Platforms" META earnings preview`
- Stock Catalysts: `"Meta Platforms" META partnership acquisition product launch customer`
- Sector News: `technology sector stocks news catalysts outlook`
- Portfolio Hub / general stock context: `"Meta Platforms" META stock news`

Observed results:
- **Daily Run**: strong; returned 10 results with timely market-week context and Reuters present.
- **Stock Profile**: returned 10 results, but included lower-signal pages like CNN quote pages; useful breadth, mixed precision.
- **Earnings**: strong; returned 10 timely preview/reaction results with good direct relevance.
- **Stock Catalysts**: returned 10 results, but quality was mixed and included commentary / low-signal holdings articles when queries were too thematic.
- **Sector News**: returned 10 results, but the more structured `sector stocks news catalysts outlook` phrasing skewed toward weekly commentary and generic roundups.
- **Portfolio Hub**: returned 10 results and was directionally useful, but simple `stock news` phrasing still admitted some quote/summary pages.

Simple-vs-structured findings:
- Simple earnings query: `"Meta Platforms" META earnings preview` performed well.
- Structured earnings query: `"Meta Platforms" META guidance outlook analyst expectations` also returned results, but mixed in more post-print and basket stories.
- Simple premarket query: `"Meta Platforms" META stock news today` returned 10 results.
- Over-structured premarket query: `"Meta Platforms" META premarket move gap higher gap lower"` returned **0** results.
- Simple sector query: `technology stocks news` performed better than the more structured sector query.

Conclusion from live META tests:
- The user’s instinct was right: several workflows were still too structured.
- For Serper `news`, simpler phrasing generally produced better breadth and better hit-rate than operator-heavy or overly thematic queries.
- Premarket was the clearest failure mode when the query became too specific.
- A **minimum result floor of 4** is appropriate for Whiskie’s decision workflows; fewer than that often leaves the prompt under-contextualized.

### Successful cases
- `searchMarketNews(3)` returned timely market headlines.
- `searchStructuredMacroContext({ maxResults: 3 })` returned macro-relevant results.
- `searchStructuredStockContext('NVDA', { companyName: 'NVIDIA' })` returned results, but quality was mixed.
- `searchStructuredEarningsContext('MSFT', { companyName: 'Microsoft' })` returned timely earnings-related headlines.
- `searchStructuredMonitoringContext('NVDA')` returned results, but relevance quality was mixed.
- Generic `search(..., { engine: 'search' })` worked for broad explanatory queries.

### Weak/failed cases
- strict high-quality-only retrieval can still return `0` results for some symbols/time windows, which is why the implementation now uses tiered retrieval (primary factual sources first, broader fallback second).
- premarket searches remain the most likely sparse area and still deserve additional live tuning.

These outcomes show why tiered retrieval is necessary: factual-source-first improves quality, but fallback paths are needed to prevent starving the pipeline.

## What Whiskie Is Doing Well
- Centralized search implementation in `src/serper.js`.
- Separate structured methods for stock, monitoring, earnings, premarket, and macro contexts.
- Usage logging via `serper_usage_events`.
- Enrichment layer in `src/news-search.js` that upgrades snippets into fuller article summaries.
- Reuse via `news-cache-service` in some important paths.
- Basic resilience via cooldown on `401/403/429`.

## Key Quality Risks

### 1. Silent degradation to empty results
Several workflows explicitly convert Serper failure into `[]`, which can make downstream trading logic proceed as though “no news exists” rather than “search is unavailable”.

Examples:
- `src/earnings-reminders.js:432-433`
- `src/earnings-reminders.js:617`
- `src/portfolio-hub.js:868`
- `src/adhoc-analyzer.js:770-773`
- `src/earnings-analysis.js:35`

This is the biggest audit concern. In a news-sensitive trading system, empty context and unavailable context are materially different states.

### 2. Missing API key also degrades silently
In `src/serper.js`, when `SERPER_API_KEY` is missing, the code logs a warning and returns `[]`.
This makes local or deployed misconfiguration look like a legitimate “no results” state unless logs are actively monitored.

### 3. Cooldown behavior can suppress all search without surfacing severity upstream
In `src/serper.js`, `401/403/429` trigger cooldown and subsequent calls return `[]` during cooldown. That protects rate limits, but again presents as empty news unless callers explicitly inspect health.

### 4. Query quality still needs monitoring, but retrieval is now tighter
The integration has now been tightened to reduce commentary bias and prefer factual/catalyst-heavy sources first. Current design uses:
- workflow-specific `day`/`week` recency defaults
- `$TICKER` stock query prefixes
- tiered retrieval (primary factual sources first, broader fallback second)
- default exclusion of several commentary-heavy domains
- a minimum structured-search result floor of 4 across key workflows

This is a major improvement, though continued live validation is still important.

### 5. Domain filtering implementation has improved
`filterDomainResults()` now uses parsed hostnames instead of substring matching, which is materially stronger for allow/block logic. The remaining challenge is tuning the source lists and fallback tiers rather than the hostname-matching mechanism itself.

### 6. In-memory caching only
Caching in both `serper.js` and `news-cache-service.js` is process-local. That is acceptable for latency reduction, but it gives no cross-instance cache stability on Railway and no historical observability of cache effectiveness beyond usage logs.

### 7. Search health is logged, but not elevated to decision policies
`serper_usage_events` is useful operationally, but I did not find evidence that major workflows gate or annotate decisions based on search freshness / availability state.

## Module-by-Module Assessment

### `src/serper.js`
Quality: Improved / Moderate-to-strong
- Good: centralized query construction, logging, cooldown, structured helpers, hostname-aware filtering, explicit health metadata, tiered retrieval, and minimum-result enforcement.
- Remaining weakness: sparse situations can still require more live tuning, especially for premarket flows.

### `src/news-search.js`
Quality: Strong
- Good enrichment layer with article fetch + summarization.
- Good publisher normalization.
- Main risk: if upstream Serper returns weak or empty results, this layer cannot recover quality.

### `src/services/news-cache-service.js`
Quality: Moderate-to-strong
- Good for reuse and TTL control.
- Cache keys now include more search-shaping fields, improving semantic correctness for cached structured stock context.

### `src/portfolio-hub.js`
Quality: Improved / Moderate-to-strong
- Uses structured macro and stock contexts in important decision prompts.
- Degraded Serper state is now surfaced into prompts/output instead of being silently flattened to neutral/no-news.

### `src/analysis.js` and `src/order-manager.js`
Quality: Moderate
- Good use of structured monitoring context for live position review.
- Risk: if result quality is noisy, the LLM receives weak trade context.

### `src/earnings-analysis.js` / `src/earnings-reminders.js`
Quality: Improved / Moderate-to-strong
- Good separation of earnings-specific context queries.
- Degraded Serper state is now carried into these event-sensitive flows instead of being silently flattened.

### `src/pre-market-scanner.js`
Quality: Improved / Moderate
- Earlier over-structured premarket phrasing could return zero results in live conditions.
- Simpler same-day stock-news phrasing materially improved hit rate for live META checks.

### `src/stock-profiles.js` / `src/catalyst-research.js`
Quality: Moderate
- Good use of structured stock context for profile generation.
- Weakness: even with simpler queries, profile/general stock context can still admit quote pages and commentary-adjacent content, so source tuning remains important.

## Recommendations

### High priority
1. **Continue tuning tiered retrieval by workflow**
   - The new design now uses explicit health metadata and tiered retrieval.
   - Next refinements should focus on symbol-class sensitivity (mega-cap vs biotech vs event-driven names) and premarket sparsity.

2. **Surface search-health into decision prompts and UI/workflow logs**
   - This has begun in critical flows, but should be extended further into all decision-critical consumers.

3. **Strengthen structured query precision**
   - For stock/monitoring context, prefer simpler high-hit-rate phrasing first, then intent-specific fallback queries.
   - Avoid quote pages and low-signal commentary where possible.

4. **Harden premarket search strategy**
   - Keep same-day simple stock-news phrasing in the first tier.
   - Add fallback query variants if the first query returns zero results.
   - Consider domain-prioritized finance/news sources for premarket catalysts.

### Medium priority
5. **Improve domain filtering implementation**
   - Filter by parsed hostname rather than substring matching.

6. **Extend cache key fidelity in `news-cache-service`**
   - Include `includeDomains`, `excludeDomains`, and possibly `companyName` in the cache key.

7. **Add explicit monitoring / alert thresholds**
   - Alert if key workflows repeatedly receive zero results for major symbols or macro context.
   - Alert if cooldown is active during trading hours.

8. **Create a search quality regression harness**
   - Maintain a fixed test set of symbols and scenarios:
     - mega-cap earnings
     - biotech catalyst
     - macro/Fed week
     - premarket mover
   - Track counts, freshness, domains, and relevance.

## Suggested Audit Language
Whiskie uses Serper through a centralized integration layer with structured search helpers by workflow type (macro, stock, monitoring, earnings, premarket). Search requests are normalized, cached, and usage-logged. Top results are further enriched by article retrieval and model summarization before entering trading and portfolio-review prompts. Current improvement areas are search-health signaling, tighter source controls, and stronger no-results vs provider-unavailable differentiation.

## Final Assessment
Serper is integrated deeply enough to support Whiskie’s decision workflows, but the current implementation still relies too much on soft-fail-to-empty behavior. For a system where recent news materially influences trading and Portfolio Hub recommendations, the next step should be to make search degradation explicit and tighten structured query quality.

**Updated rating after hardening: 8/10 for production effectiveness, 7/10 for third-party audit readiness.**
