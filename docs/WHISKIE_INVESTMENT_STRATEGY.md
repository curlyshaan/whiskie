> [!IMPORTANT]
> Historical or planning document.
> This file is retained for context, but it is **not** the source of truth for the current implementation.
> Use `README.md`, `ARCHITECTURE.md`, `FUNDAMENTAL_SCREENER_METRICS.md`, and `CLAUDE.md` for current behavior.

# Whiskie Investment Strategy - Complete Overview

**Last Updated:** 2026-04-08

---

## Core Philosophy

**"The way to build superior long-term returns is through preservation of capital and home runs."** — Stanley Druckenmiller

Whiskie combines:
- **Capital preservation** through hard-coded safety limits
- **Home run potential** by letting winners run without mechanical trimming
- **Dynamic management** where Opus adjusts strategy based on market conditions

---

## Portfolio Structure: Beta Play Strategy

### Target Allocation
- **70-80% Long Exposure** - Quality stocks with asymmetric upside
- **0-30% Short Exposure** - Opportunistic shorts in overvalued/deteriorating names
- **10-20% Cash** - Dry powder for opportunities and risk buffer

### Position Sizing
- **Standard position:** 10% of portfolio
- **High conviction:** up to 15% (requires strong thesis + multiple confirming signals)
- **Maximum single position:** 15%
- **Short positions:** 5-10% each, max 30% total short exposure

---

## Stock Universe

**~365 stocks** across 41 sub-industries:
- Large-cap ($10B+) and mid-cap ($2B-10B) only
- US-listed NYSE/NASDAQ stocks
- Covers all 11 GICS sectors
- ETB (Easy-to-Borrow) status tracked for shorting

**Daily scanning:** Opus analyzes all 365 stocks every trading day based on:
- Revenue trends and earnings momentum
- Technical signals (breakouts, support/resistance)
- News catalysts (partnerships, product launches, regulatory changes)
- Sector rotation and macro trends
- Options sentiment (put/call ratios, unusual activity)
- Institutional activity (block trades, accumulation patterns)

---

## Trading Schedule

**3x Daily Analysis** (automated via cron):
1. **10:00 AM ET** - Morning analysis after market open volatility settles
2. **2:00 PM ET** - Afternoon analysis during peak liquidity
3. **3:30 PM ET** - Pre-close analysis for overnight positioning

**Additional triggers:**
- Weekly review (Sundays 9:00 PM ET) - Deep Opus analysis with extended thinking
- Earnings announcements for held positions
- Major market events or volatility spikes

---

## How Whiskie Identifies Opportunities

### Long Positions (Including Swing Trades)

**Opus scans for multiple opportunity types:**

**1. Swing Trades (Short-term, 2-8 weeks)**
- Technical breakouts with volume confirmation
- Oversold bounces at key support levels
- Pre-earnings momentum plays
- News-driven catalysts (FDA approval, partnership announcement)
- **Entry:** 5-8% position size
- **Exit:** Opus manages dynamically based on technical signals and news

**2. Growth Compounders (Medium-term, 3-12 months)**
- Revenue acceleration (growth rate increasing 3+ quarters)
- Gross margin expansion (pricing power emerging)
- Institutional accumulation (high volume, stable price)
- Narrative re-categorization (market starting to see company differently)
- **Entry:** 8-12% position size
- **Exit:** Thesis-based, not price-based (see Exit Strategy below)

**3. Blue Chip Anchors (Long-term, 1+ years)**
- Stable mega-caps (MSFT, AAPL, JPM, UNH)
- Consistent earnings growth and dividend history
- Market leadership in their sectors
- **Entry:** 10-15% position size
- **Exit:** Only on fundamental deterioration or allocation rebalancing

**Pre-Breakout Signals (Finding "NVDA at $50"):**
- Revenue acceleration (not just growth, but growth rate increasing)
- Gross margin expansion while revenue grows
- Volume accumulation without price explosion (institutions building quietly)
- Narrative shift in analyst reports (business model re-categorization)

### Short Positions

**Two categories:**

**1. Structural Hedges (5-8% total)**
- Sector-level hedges when portfolio is concentrated
- Reduces beta, not meant to generate alpha
- Closed when long exposure is reduced

**2. Conviction Shorts (3-5% each, max 2-3 positions)**
- Revenue deceleration (growth rate slowing 3+ quarters)
- Gross margin compression
- Institutional distribution (high volume, price can't hold rallies)
- Narrative breaking (story that held stock up is falling apart)
- **Requirements:** ETB verification, mid/large-cap only, stop-loss required

---

## Entry Execution

**Order Types (Opus decides based on situation):**

1. **Market orders** - Immediate execution (emergency situations only)
2. **Limit orders** - Better entry prices (standard for entries)
3. **OTOCO orders** - Limit entry with automatic OCO bracket (most common)
   - Example: "Buy NVDA at $140 limit, stop at $126, target at $168"
4. **Extended hours** - Pre-market/after-hours trading when needed

**Position Entry Strategy:**
- Start with 5-10% position (smaller entry for growth stocks)
- Add 2-5% on confirmation if thesis strengthens
- Maximum position size: 15%
- Set initial stop-loss immediately (10-15% below entry for longs)

---

## Exit Strategy: NO AUTOMATIC TRIMMING

**CRITICAL CHANGE:** Automatic trim triggers removed. Opus has full control via dynamic order modification.

### How Exits Work Now

**Dynamic Order Modification (3x daily):**
- Opus analyzes news for each position
- Can raise/lower stop-loss based on thesis changes
- Can raise/lower take-profit based on new catalysts
- Can trigger emergency market sell if thesis breaks

**Exit Triggers:**

**For ALL Positions:**
1. **Thesis breaks** - Earnings miss + guidance down, loss of key customer, regulatory setback
2. **Parabolic move** - Stock up >40% in <3 weeks (always retraces, trim 25-30%)
3. **Position too large** - Grows to >18% of portfolio (allocation discipline)
4. **Stop-loss hit** - Automatic exit at predetermined level

**For Growth Compounders:**
- NO automatic trimming on price targets
- Trailing stop activated at +50% gain (15% below current price)
- Trailing stop tightens as position appreciates
- Only exit on thesis change or trailing stop trigger

**For Swing Trades:**
- Opus manages exits based on technical signals
- Typical hold: 2-8 weeks
- Exit on target hit, technical breakdown, or thesis invalidation

**For Blue Chip Anchors:**
- Never trim on price alone
- Only trim if >18% of portfolio or 2+ consecutive earnings misses
- Long-term hold mentality

### Example: NVDA Home Run Scenario

**Old system (automatic trimming):**
- Buy at $50
- Trim 25% at $57.50 (+15%)
- Trim 25% at $62.50 (+25%)
- Trim 25% at $70 (+40%)
- Only 25% left when it hits $250 (5x)
- **Result:** Turned 5x into 2x

**New system (Opus control):**
- Buy at $50, stop $40, target $70
- At $65 on META partnership news: Opus raises target to $85
- At $85 on strong earnings: Opus raises target to $110, activates trailing stop
- At $150 on AI boom: Trailing stop at $127 (15% below peak)
- At $250: Still holding with trailing stop at $212
- **Result:** Full 5x captured (minus small trailing stop buffer)

---

## Risk Management

### Hard-Coded Limits (Cannot Be Overridden)

- **Max 5 trades per day**
- **Max $15,000 per single trade** (15% of $100k)
- **Max $50,000 daily exposure change**
- **Max 10% per short position**
- **Max 30% total short exposure**
- **Stop-loss REQUIRED for all shorts**

### Dynamic Stop-Loss Management

**Long Positions:**
- Initial stop: 10-15% below entry
- Trail stop as position appreciates
- Widen stop if high conviction and thesis intact
- Tighten stop before earnings if position is profitable

**Short Positions:**
- Initial stop: 15-20% ABOVE entry (inverse logic)
- Trail stop as stock declines
- Cover immediately if thesis breaks
- Never let short loss exceed 25%

### Market Timing

**Avoids low-quality trading windows:**
- First 15 minutes (9:30-9:45 AM) - high volatility, wide spreads
- Last 15 minutes (3:45-4:00 PM) - closing auction volatility
- Lunch hour (12:00-1:00 PM) - low liquidity

**Best execution windows:**
- 9:45-11:30 AM ET
- 2:00-3:45 PM ET

---

## AI Decision Framework

### When to Deploy Capital (Go Long)

Opus recommends longs when:
1. High conviction setup with multiple confirming signals
2. Asymmetric risk/reward (3:1 or better)
3. Clear catalyst path (earnings, product launch, sector rotation)
4. Good entry point (pullback to support, not chasing)

### When to Short

Opus recommends shorts when:
1. Overvaluation + deteriorating fundamentals
2. Catalyst for decline (earnings miss, guidance cut, loss of key customer)
3. Technical breakdown (breaking support, distribution pattern)
4. ETB verified (stock is easy to borrow)

### When to Hold Cash

Opus holds cash when:
1. No compelling setups (risk/reward not attractive)
2. Market uncertainty (elevated volatility, unclear direction)
3. Waiting for catalyst (known event coming - FOMC, earnings)
4. Preservation mode (protecting gains after strong run)

### When to Modify Orders

Opus modifies stop-loss/take-profit when:
1. News changes thesis (earnings call, product launch, macro event)
2. Technical levels change (new support/resistance established)
3. Volatility changes (widen stops in high volatility, tighten in low)
4. Time decay (approaching earnings, tighten stops if profitable)

---

## Data Sources

**Market Data:**
- Tradier API (real-time quotes, intraday bars, time & sales)
- Options chain data (put/call ratios, implied volatility)
- Market clock (trading calendar, market status)
- ETB list (Easy-to-Borrow for shorting)

**News & Sentiment:**
- Tavily API (stock-specific, sector, and macro news)
- News sanitization (prevents prompt injection)
- Sentiment analysis on headlines

**Performance Learning:**
- Tradier gain/loss reports
- Identifies winning vs losing patterns
- Tracks hold duration optimization
- Detects repeated mistakes

**Technical Analysis:**
- Intraday momentum (2-hour window)
- Block trade detection (institutional activity)
- Volume-to-price anomalies (accumulation/distribution)
- Support/resistance levels

---

## Performance Metrics

**Success Criteria:**
- **Win rate:** Target 55-60% (more winners than losers)
- **Profit factor:** Target 2.0+ (winners 2x bigger than losers)
- **Max drawdown:** Keep under 15% from peak
- **Sharpe ratio:** Target 1.5+ (risk-adjusted returns)
- **Alpha:** Beat S&P 500 by 3-5% annually

**Tracking:**
- Daily portfolio snapshots
- Trade history with full reasoning
- AI decision logs
- Position performance vs historical patterns

---

## Key Differentiators

**What makes Whiskie unique:**

1. **No mechanical trimming** - Lets winners run based on thesis, not price targets
2. **Dynamic order management** - Adjusts stops/targets 3x daily based on news
3. **Extended thinking** - Opus uses 50k token budget for deep analysis
4. **Swing + growth + anchor** - Identifies multiple opportunity types simultaneously
5. **Long/short capability** - Can profit in both directions
6. **Pre-breakout scanning** - Finds growth stocks before they explode
7. **Thesis-based exits** - Sells on fundamental changes, not arbitrary price levels

---

## Summary

Whiskie operates as an autonomous portfolio manager that:
- Scans 365 stocks daily for opportunities
- Identifies swing trades, growth compounders, and blue chip anchors
- Uses shorts opportunistically for hedging and alpha
- Enters positions with protective stops via OTOCO orders
- Dynamically adjusts stops/targets 3x daily based on news and earnings
- Lets winners run without mechanical trimming
- Exits only on thesis breaks, parabolic moves, or trailing stops

**The goal:** Beat S&P 500 consistently while capturing occasional home runs (3-5x returns) through intelligent position management and letting winners compound.
