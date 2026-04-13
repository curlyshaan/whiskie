# Design Question: Watchlist Integration & Trade Intent Tracking

## Current State

**Saturday Screening:**
- `fundamental-screener.js` identifies stocks with pathways (deepValue, highGrowth, inflection, cashMachine, qarp, turnaround, overvalued)
- Stores ALL candidates in `saturday_watchlist` table with pathway + score
- Example: MSFT → deepValue pathway, score 45

**Daily Analysis (10am, 2pm):**
- `pre-ranking.js` filters stock_universe by volume/spread/price
- Does NOT use saturday_watchlist at all
- Opus Phase 1-4 analysis runs on filtered stocks
- Trade approvals created with intent defaulting to 'momentum'

**The Problem:**
1. `saturday_watchlist` is populated but never used in daily analysis
2. `quality_watchlist` and `overvalued_watchlist` tables exist but are empty
3. Pathway/intent information is lost - user can't tell if a trade is:
   - Dip-buying a quality stock (deepValue)
   - Momentum/swing trade
   - Shorting overvalued stock
   - Growth play

## Design Options

### Option 1: Use saturday_watchlist directly in pre-ranking
- Pre-ranking pulls from saturday_watchlist (with pathway tags)
- Passes pathway through to Opus
- Opus includes pathway in trade recommendations
- Trade approvals show intent (e.g., "Dip-buying deepValue opportunity")

**Pros:**
- Simple, uses existing data
- Pathway preserved end-to-end

**Cons:**
- saturday_watchlist refreshes weekly, may miss intraday opportunities
- Mixes fundamental screening with momentum/technical plays

### Option 2: Separate quality/overvalued watchlists + saturday_watchlist
- Saturday screening populates 3 tables:
  - `quality_watchlist`: Top 15 deepValue + cashMachine + qarp stocks (dip-buying candidates)
  - `overvalued_watchlist`: Top 15 overvalued stocks (short candidates)
  - `saturday_watchlist`: All other pathways (highGrowth, inflection, turnaround)
- Pre-ranking uses all 3 sources + live filtering
- Each source tagged with intent

**Pros:**
- Clear separation of strategies
- quality_watchlist = "buy the dip on great companies"
- overvalued_watchlist = "short overextended stocks"
- saturday_watchlist = "opportunistic plays"

**Cons:**
- More complex, 3 tables to maintain
- Need to decide which pathways go where

### Option 3: Hybrid - saturday_watchlist + dynamic intent detection
- Pre-ranking uses saturday_watchlist + live filtering
- Opus Phase 4 dynamically assigns intent based on:
  - Original pathway from saturday_watchlist
  - Current price action (dip vs momentum)
  - Technical setup
- Trade approvals show both pathway + current intent

**Pros:**
- Flexible, adapts to market conditions
- Pathway is starting point, not constraint
- Can catch "deepValue stock now showing momentum"

**Cons:**
- More complex logic in Opus prompt
- Intent may not match original pathway

## Questions for Opus

1. **Which design best balances simplicity vs clarity?**
   - Should we use saturday_watchlist directly (Option 1)?
   - Or separate into quality/overvalued watchlists (Option 2)?
   - Or hybrid approach (Option 3)?

2. **How should pathways map to trade intent?**
   - deepValue, cashMachine, qarp → "dip-buying" or "value"?
   - highGrowth, inflection → "growth" or "momentum"?
   - turnaround → "turnaround" or "opportunistic"?
   - overvalued → "short_overvalued"?

3. **Should Opus be able to override pathway intent?**
   - Example: MSFT tagged as deepValue on Saturday, but by Tuesday it's up 5% and showing momentum
   - Should trade intent be "dip-buying" (original pathway) or "momentum" (current setup)?

4. **What should the trade approval UI show?**
   - Just intent? (e.g., "Dip-buying opportunity")
   - Pathway + intent? (e.g., "deepValue → dip-buying")
   - Pathway + score + intent? (e.g., "deepValue (score: 45) → dip-buying")

5. **How to handle stocks NOT in saturday_watchlist?**
   - Pre-ranking may find stocks with volume surge that aren't in saturday_watchlist
   - Should these default to "momentum" intent?
   - Or should Opus assign intent based on fundamentals?

## Current Database Schema

```sql
-- saturday_watchlist (populated weekly)
CREATE TABLE saturday_watchlist (
  symbol VARCHAR(10),
  intent VARCHAR(10),        -- 'LONG' or 'SHORT'
  pathway VARCHAR(50),       -- deepValue, highGrowth, etc.
  sector VARCHAR(100),
  industry VARCHAR(200),
  score INTEGER,
  metrics JSONB,
  reasons TEXT,
  price DECIMAL(10, 2),
  status VARCHAR(20),        -- 'active' or 'expired'
  added_date TIMESTAMP
);

-- quality_watchlist (currently empty)
CREATE TABLE quality_watchlist (
  symbol VARCHAR(10),
  sector VARCHAR(100),
  industry VARCHAR(200),
  added_date TIMESTAMP,
  notes TEXT
);

-- overvalued_watchlist (currently empty)
CREATE TABLE overvalued_watchlist (
  symbol VARCHAR(10),
  sector VARCHAR(100),
  industry VARCHAR(200),
  added_date TIMESTAMP,
  notes TEXT
);

-- trade_approvals (has intent field)
CREATE TABLE trade_approvals (
  symbol VARCHAR(10),
  action VARCHAR(20),
  quantity INTEGER,
  entry_price DECIMAL(10, 2),
  stop_loss DECIMAL(10, 2),
  take_profit DECIMAL(10, 2),
  order_type VARCHAR(20),
  intent VARCHAR(50),        -- Currently defaults to 'momentum'
  reasoning TEXT,
  status VARCHAR(20)
);
```

## Recommendation Needed

Please analyze these options and recommend:
1. Best design approach (Option 1, 2, 3, or hybrid)
2. Pathway → intent mapping
3. Whether Opus should override pathway intent based on current conditions
4. What to display in trade approval UI
5. How to handle stocks not in saturday_watchlist
