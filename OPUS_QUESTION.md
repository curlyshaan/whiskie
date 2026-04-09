# Question for Opus: Sector Cap vs Growth Stock Discovery

## User Concern
The 3-4 stock per sub-sector cap might block emerging "home run" stocks from being analyzed.

**Example scenario:**
- Semiconductors already have NVDA, AMD, TSM (3 popular stocks)
- Stock X (e.g., SMCI, AVGO) starts breaking out with massive volume
- Does the 3-4 cap prevent Stock X from being analyzed?

## Current System Design

**Pre-Ranking (425 → 120 candidates):**
- Algorithmic scoring: volume surge, momentum, sector strength
- NO sector caps at this stage
- Stock X would make the 120-candidate list if surging

**Phase 1 (120 → 25-35 stocks):**
- Opus selects from pre-ranked candidates
- 3-4 stock per sub-sector cap applies HERE
- Watchlist stocks get priority (bypass cap)

**Phase 2 (25-35 → final trades):**
- Deep analysis with full market data
- Final trade decisions

## User's Proposed Solution
Multiple watchlists to ensure growth stocks aren't missed:

1. **Buy Watchlist** - stocks to add to long-term positions
2. **Swing Watchlist** - short-term trade opportunities (2-10 days)
3. **Growth Watchlist** - emerging stocks to monitor (not ready to buy yet)
4. **Short Watchlist** - short candidates

Stocks can be on multiple lists (e.g., NVDA on both Buy and Swing).

## Questions for Opus

1. **Is the 3-4 sector cap too restrictive?** Could it cause us to miss breakout stocks?

2. **Does the pre-ranking algorithm adequately surface emerging stocks?** Or do we need additional mechanisms?

3. **Should the 3-4 cap be relaxed if a stock has exceptional momentum?** (e.g., >5% move + 3x volume surge)

4. **Is the multi-watchlist approach helpful or over-engineered?** Would it improve stock discovery or just add complexity?

5. **Alternative solutions?** What's the best way to balance:
   - Sector diversification (prevent over-concentration)
   - Growth stock discovery (don't miss breakouts)
   - Analysis efficiency (can't analyze all 425 stocks daily)

## Current Watchlist Implementation
- Single watchlist table with: symbol, target_entry_price, why_watching, why_not_buying_now
- Watchlist stocks get priority in Phase 1 selection
- No categorization (buy vs swing vs growth vs short)

## Request
Please evaluate the user's concern and proposed solution. Recommend the optimal approach for balancing sector diversification with growth stock discovery.
