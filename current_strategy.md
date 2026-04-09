# Whiskie Trading Bot - Current Strategy Documentation

**In-depth strategy guide for various market scenarios and operational contexts**

---

## Table of Contents

1. [Core Strategy Philosophy](#core-strategy-philosophy)
2. [Portfolio Construction](#portfolio-construction)
3. [Position Sizing Framework](#position-sizing-framework)
4. [VIX Regime-Based Adaptation](#vix-regime-based-adaptation)
5. [Cash Management Strategy](#cash-management-strategy)
6. [Sector Allocation Rules](#sector-allocation-rules)
7. [Long Position Strategy](#long-position-strategy)
8. [Short Position Strategy](#short-position-strategy)
9. [Risk Management Protocols](#risk-management-protocols)
10. [Market Scenario Playbooks](#market-scenario-playbooks)
11. [Order Management Strategy](#order-management-strategy)
12. [Performance Optimization](#performance-optimization)

---

## Core Strategy Philosophy

### The Beta Play Approach

**"The way to build superior long-term returns is through preservation of capital and home runs."** — Stanley Druckenmiller

Whiskie implements a **Beta Play** strategy that balances:
- **Capital Preservation**: Hard-coded safeguards prevent catastrophic losses
- **Asymmetric Upside**: AI identifies opportunities with 3-5x+ potential
- **Dynamic Positioning**: Adjusts exposure based on market conditions
- **Opportunistic Shorting**: Captures downside in overvalued names

### Three Pillars of Portfolio Management

1. **Long-term Anchors (35-40%)**
   - High-quality mega-cap stocks with durable competitive advantages
   - Secular growth trends (AI infrastructure, cloud computing, electrification)
   - Lower turnover, larger position sizes (10-15%)
   - Examples: NVDA, MSFT, GOOGL, META, AMZN

2. **Swing/Momentum Trades (30-35%)**
   - Medium-term positions (2-8 weeks typical hold)
   - Technical setups with fundamental catalysts
   - Standard position sizes (8-12%)
   - Examples: Earnings plays, sector rotation, breakout trades

3. **Short Positions (15-20%)**
   - Opportunistic shorts in overvalued or deteriorating names
   - Smaller position sizes (5-10% per short)
   - Tighter stop-losses due to unlimited loss risk
   - Examples: Overvalued growth stocks, disrupted industries

---

## Portfolio Construction

### Target Allocation Ranges

**Normal Market Conditions (VIX 15-20):**
- Long exposure: 70-78%
- Short exposure: 10-20%
- Cash reserve: 10-20%

**Elevated Volatility (VIX 20-28):**
- Long exposure: 60-65%
- Short exposure: 5-15%
- Cash reserve: 15-25%

**High Volatility (VIX >28):**
- Long exposure: 45-55%
- Short exposure: 0-10%
- Cash reserve: 20-35%

### Position Count Guidelines

- **Minimum positions**: 8 (adequate diversification)
- **Target positions**: 10-12 (optimal balance)
- **Maximum positions**: 15 (avoid over-diversification)

**Rationale**: With 10-12 positions at 8-12% each, you achieve diversification without diluting conviction. More than 15 positions becomes an index fund with extra fees.

---

## Position Sizing Framework

### Base Position Sizes by Stock Type

**Long Positions:**
- **Index ETFs** (SPY, QQQ): 12-15% max
- **Mega-cap** (>$500B): 10-15% max
- **Large-cap** ($50B-500B): 8-12% max
- **Mid-cap** ($10B-50B): 5-8% max
- **Opportunistic** (<$10B): 3-5% max

**Short Positions:**
- **Index ETFs**: 10-12% max
- **Mega-cap**: 8-10% max
- **Large-cap**: 6-8% max
- **Mid-cap**: 4-6% max
- **Avoid**: Small-cap shorts (squeeze risk too high)

### Conviction-Based Adjustments

**High Conviction** (multiple confirming signals):
- Can size up to maximum for category
- Requires: Strong fundamental thesis + technical confirmation + catalyst path

**Medium Conviction** (standard setup):
- Use middle of range for category
- Typical: 8-10% for large-cap longs, 5-7% for shorts

**Low Conviction** (speculative/opportunistic):
- Use minimum for category
- Typical: 5-6% for longs, 3-4% for shorts

---

## VIX Regime-Based Adaptation

### Five VIX Regimes

#### 1. CALM (VIX <15)
**Market Conditions**: Low volatility, complacent market, steady uptrend

**Position Sizing**:
- Multiplier: 1.10x (10% larger positions)
- Max long allocation: 82%
- Max short allocation: 20%
- Min cash reserve: 10%

**Trading Approach**:
- Full deployment encouraged
- Can take larger positions in high-conviction setups
- Good time for swing trades and momentum plays
- Shorts allowed but watch for low-volatility grind higher

**Example**: Standard 10% position → 11% in CALM regime

---

#### 2. NORMAL (VIX 15-20)
**Market Conditions**: Healthy volatility, normal market function

**Position Sizing**:
- Multiplier: 1.00x (standard sizes)
- Max long allocation: 78%
- Max short allocation: 20%
- Min cash reserve: 10%

**Trading Approach**:
- Standard operations
- Balanced long/short exposure
- Normal risk-taking
- All strategies available

**Example**: Standard 10% position → 10% in NORMAL regime

---

#### 3. ELEVATED (VIX 20-28)
**Market Conditions**: Increased uncertainty, choppy price action

**Position Sizing**:
- Multiplier: 0.75x (25% smaller positions)
- Max long allocation: 65%
- Max short allocation: 15%
- Min cash reserve: 15%

**Trading Approach**:
- Reduce position sizes across the board
- NO NEW SHORTS (volatility rising = short squeeze risk)
- Raise cash to 15%+
- Tighten stop-losses on existing positions
- Focus on high-conviction longs only

**Example**: Standard 10% position → 7.5% in ELEVATED regime

**Critical Rule**: VIX adjustment happens BEFORE sector validation to prevent false rejections

---

#### 4. FEAR (VIX 28-35)
**Market Conditions**: Fear regime, sharp selloffs, panic selling

**Position Sizing**:
- Multiplier: 0.50x (50% smaller positions)
- Max long allocation: 55%
- Max short allocation: 10%
- Min cash reserve: 20%

**Trading Approach**:
- Half-size positions only
- Can still buy dips in quality names
- NO NEW SHORTS (too dangerous)
- Raise cash to 20%+
- Focus on defensive sectors and mega-caps
- Look for capitulation signals to deploy cash

**Example**: Standard 10% position → 5% in FEAR regime

---

#### 5. PANIC (VIX >35)
**Market Conditions**: Market panic, extreme volatility, systemic risk

**Position Sizing**:
- Multiplier: 0.25x (quarter-size only)
- Max long allocation: 45%
- Max short allocation: 0%
- Min cash reserve: 30%

**Trading Approach**:
- DEFENSIVE MODE: Preserve capital
- NO NEW POSITIONS (wait for stabilization)
- NO SHORTS (covering pressure too high)
- Raise cash to 30%+
- Protect existing positions with tight stops
- Wait for VIX to decline before deploying

**Example**: Standard 10% position → 2.5% in PANIC regime

---

### VIX Regime Transition Strategy

**When VIX Rises** (NORMAL → ELEVATED → FEAR):
1. Existing positions are NOT automatically sold
2. New trades are sized smaller
3. Sector limits may tighten (30% → 25%)
4. Cash reserve targets increase
5. Stop-losses may be tightened on profitable positions

**When VIX Falls** (FEAR → ELEVATED → NORMAL):
1. Existing positions remain at current size
2. New trades can be sized larger
3. Sector limits may relax (25% → 30%)
4. Can deploy cash more aggressively
5. New shorts allowed again below VIX 20

**Key Principle**: VIX regime affects NEW trade sizing, not existing positions or sector limits themselves.

---

## Cash Management Strategy

### Cash as Context, Not Constraint

**Philosophy**: Cash is a "target buffer" not a hard floor. Claude can deploy to 0% for high-conviction setups, but cash state informs judgment.

### Four Cash States

#### 1. FLUSH (>12% cash)
**Context**: Full flexibility, ample dry powder

**Trading Approach**:
- Deploy normally on high and medium conviction setups
- No need to be selective
- Can take multiple positions simultaneously
- Good time to build new positions

**Example**: Portfolio at $114k, cash $15k (13%) → FLUSH state

---

#### 2. NORMAL (5-12% cash)
**Context**: Standard operations, 10% is resting target

**Trading Approach**:
- Prefer not to go below 5% without strong conviction
- Prioritize best setups if cash would drop under 5%
- Normal selectivity
- Can still take 2-3 positions if compelling

**Example**: Portfolio at $114k, cash $8k (7%) → NORMAL state

---

#### 3. DEPLOYED (0-5% cash)
**Context**: Nearly fully deployed, limited dry powder

**Trading Approach**:
- Before buying anything new, evaluate existing positions
- Ask: Is there a position with weakened thesis, underperforming sector, or better opportunity available?
- If yes → rotate capital (sell weak position, buy strong setup)
- If no clear rotation target → wait for stop-loss or take-profit to free capital
- Only bypass for extremely high conviction setups (strong catalyst + technical confirmation)

**Rotation Candidate Criteria**:
- Small gains or negative (<5% gain)
- Underperforming vs sector
- Thesis weakening (guidance cut, competitive pressure)
- Better opportunity available

**Example**: Portfolio at $114k, cash $3k (2.6%) → DEPLOYED state
- Rotation candidates: Position with +2% gain, sector up +8% (underperforming)

---

#### 4. ZERO (0% cash)
**Context**: Fully deployed, no dry powder

**Trading Approach**:
- Do NOT buy anything new unless simultaneously rotating out of weaker position
- Review all current positions for rotation candidates
- Criteria: Weak thesis, underperforming vs sector, clearly better opportunity available
- If no rotation makes sense → hold and wait
- Exception: Can sell position at stop-loss or take-profit, then immediately redeploy

**Example**: Portfolio at $114k, cash $0 (0%) → ZERO state
- Must identify rotation candidate before any new buy

---

### Rotation Strategy

**When to Rotate** (DEPLOYED or ZERO state):
1. Identify underperforming position (bottom 20% of portfolio)
2. Confirm new opportunity is materially better
3. Sell underperformer
4. Immediately buy new position with proceeds
5. Net effect: Improved portfolio quality, no cash drain

**Rotation Candidate Identification**:
- Automatically surfaced when cash <5%
- Sorted by gain % (lowest first)
- Shows: Symbol, gain %, position value, stock type
- Top 5 candidates presented to Claude

---

## Sector Allocation Rules

### Base Sector Limits

**Normal Conditions** (VIX <20):
- Maximum 30% per sector (both long and short combined)

**Elevated Volatility** (VIX ≥20):
- Maximum 25% per sector (tighter risk control)

### Sector Allocation Calculation

**Critical**: VIX adjustment must be applied BEFORE sector validation

**Correct Order**:
1. Get VIX regime and multiplier
2. Apply multiplier to all trade quantities
3. Calculate sector allocation with adjusted quantities
4. Validate against sector limits
5. Execute approved trades

**Example** (ELEVATED regime, 0.75x multiplier):
- Original trades: MSFT 20 shares, META 15 shares, AMZN 31 shares
- Technology sector before VIX: 18.5% of portfolio
- After VIX adjustment: MSFT 15, META 11, AMZN 23 shares
- Technology sector after VIX: 13.7% of portfolio ✅ Under 30% limit

**Why This Matters**: Without VIX adjustment first, trades get falsely rejected for "exceeding sector limits" when they actually fit within limits after adjustment.

### Sector Diversification Guidelines

**Recommended Sector Weights** (% of stock positions, not including cash):
- Technology: 20-25% (largest sector, but capped)
- Healthcare: 15-20% (defensive, innovation)
- Financials: 10-15% (cyclical, dividends)
- Consumer Discretionary: 10-15% (economic growth)
- Industrials: 10-15% (infrastructure, defense)
- Communication Services: 5-10% (mega-caps)
- Energy: 5-10% (inflation hedge)
- Consumer Staples: 5-10% (defensive)
- Materials: 0-5% (cyclical, commodity exposure)
- Utilities: 0-5% (defensive, yield)
- Real Estate: 0-5% (rate-sensitive)

**Avoid Over-Concentration**: No single sector should dominate portfolio (30% hard limit prevents this)

---

## Long Position Strategy

### Finding Home Run Longs

**What Makes a Home Run Long**:
1. **Structural Tailwinds**: Secular growth trends (AI, cloud, electrification)
2. **Inflection Points**: Product launches, market share gains, margin expansion
3. **Underappreciation**: Market hasn't priced in full opportunity
4. **Catalyst Path**: Clear near-term events to drive re-rating

### Entry Criteria for High-Conviction Longs

**Technical**:
- Breaking out of consolidation
- Strong relative strength vs sector/market
- Volume confirmation on breakout
- Above key moving averages (20-day, 50-day)

**Fundamental**:
- Revenue acceleration (growth rate increasing)
- Margin expansion (operating leverage)
- Market share gains (taking share from competitors)
- Strong guidance (management confidence)

**Sentiment**:
- Institutional accumulation (block trades, 13F filings)
- Options activity showing bullish positioning
- Analyst upgrades or positive revisions
- Not yet crowded (avoid consensus longs)

**Timing**:
- Good entry point (pullback to support, not chasing)
- Pre-earnings setup (if catalyst expected)
- Sector rotation tailwind
- Macro backdrop supportive

### Position Management for Longs

**Initial Entry**:
- Start with 5-10% position (adjusted for VIX regime)
- Use limit orders for better entry (avoid market orders)
- Set initial stop-loss 10-15% below entry
- Document thesis and catalyst path

**Adding to Winners**:
- Add 2-5% on pullbacks if thesis strengthens
- Maximum position size: 15% (12% in current config)
- Trail stop-loss as position appreciates
- Only add if technical structure intact

**Trimming Strategy**:
- Trim 25% at +30% gain (lock in profits)
- Trim 25% at +60% gain (reduce risk)
- Let remaining 50% run with trailing stop
- Exception: Can hold full position if thesis accelerating

**Exit Signals**:
- Stop-loss hit (automatic exit)
- Thesis breaks (earnings miss, guidance cut, competitive threat)
- Technical breakdown (breaks key support)
- Valuation extreme (parabolic move, no fundamental support)

---

## Short Position Strategy

### Finding Home Run Shorts

**What Makes a Home Run Short**:
1. **Overvaluation**: Priced for perfection, high multiples vs peers
2. **Deteriorating Fundamentals**: Slowing growth, margin compression, market share loss
3. **Structural Headwinds**: Secular decline, disruption, regulatory pressure
4. **Catalyst Path**: Earnings miss, guidance cut, loss of key customer

### Entry Criteria for Shorts

**Technical**:
- Breaking support levels
- Weak relative strength (underperforming sector/market)
- Distribution pattern (selling into rallies)
- Below key moving averages

**Fundamental**:
- Decelerating revenue (growth rate slowing)
- Margin pressure (costs rising faster than revenue)
- Cash burn (negative free cash flow)
- Competitive threats (losing market share)

**Sentiment**:
- Insider selling (executives dumping stock)
- Put activity (bearish options positioning)
- Analyst downgrades
- Not heavily shorted yet (avoid crowded shorts)

**Valuation**:
- Trading at premium to peers despite worse fundamentals
- High P/E, P/S multiples with slowing growth
- Priced for perfection (no room for disappointment)

### Sectors to Avoid Shorting

- **Strong secular tailwinds**: AI infrastructure, cloud leaders (fighting the trend)
- **Monopolies/duopolies**: Hard to disrupt, pricing power (MSFT, GOOGL)
- **Heavily shorted names**: Risk of short squeeze (>20% short interest)
- **Low float stocks**: Manipulation risk, liquidity issues

### Sectors Good for Shorting

- **Overvalued growth stocks**: High multiples, slowing growth (2021-2022 SaaS)
- **Disrupted industries**: Legacy players losing to new tech (traditional retail)
- **Cyclical peaks**: Companies at top of cycle (regional banks 2023)
- **Frauds/accounting issues**: Red flags in financials (Enron-style)

### Position Management for Shorts

**Initial Entry**:
- Start with 5% position (adjusted for VIX regime)
- Use limit orders (don't chase down)
- Set stop-loss 15-20% ABOVE entry (inverse logic)
- Verify ETB status (Easy-to-Borrow via Tradier API)
- REQUIRED: Must have stop-loss protection

**Adding to Winners**:
- Add 2-5% if stock bounces but thesis intact
- Maximum short position: 10%
- Trail stop-loss as stock declines
- Watch borrow rate (if spikes, consider covering)

**Covering Strategy**:
- Cover 50% at -20% (stock down 20%)
- Cover 25% at -40% (stock down 40%)
- Let remaining 25% run or cover on technical bounce
- Cover immediately if thesis breaks (surprise positive news)

**Exit Signals**:
- Stop-loss hit (buy to cover immediately)
- Short squeeze detected (rapid price rise + volume spike)
- Borrow rate spikes (hard to borrow, expensive)
- Thesis breaks (positive surprise, turnaround story)

### Short-Specific Risks

**Unlimited Loss Potential**:
- Longs can only lose 100% (stock to zero)
- Shorts can lose >100% (stock can rise infinitely)
- This is why stops are REQUIRED and tighter

**Short Squeeze Risk**:
- If many shorts try to cover simultaneously, price spikes
- Avoid heavily shorted names (>20% short interest)
- Watch for squeeze signals (rapid rise on volume)

**Borrow Costs**:
- Must pay to borrow shares
- Borrow rate can spike if stock becomes hard to borrow
- Eats into profits, especially on longer holds

---

## Risk Management Protocols

### Hard-Coded Safety Limits

**Daily Trade Limits**:
- Max 3 trades per day (prevents overtrading)
- Tracked in database (persists across restarts)

**Position Size Limits**:
- Max 12% per long position (down from 15%)
- Max 10% per short position (tighter due to unlimited loss risk)
- Max 30% total short exposure (20% initially, scales up after 60 days)

**Portfolio Drawdown Limit**:
- Max 20% drawdown triggers defensive mode
- Defensive mode: Reduce new position sizes 50%, tighten stops 20%, raise cash to 10%

**Sector Allocation Limits**:
- Max 30% per sector (normal conditions)
- Max 25% per sector (elevated volatility)

### Stop-Loss Management

**Automatic Stop-Loss Levels** (Long Positions):
- Index ETFs: -12%
- Blue-chip: -12%
- Large-cap: -15%
- Mid-cap: -18%
- Opportunistic: -20%

**Automatic Stop-Loss Levels** (Short Positions):
- Index ETFs: +8% (triggers on price RISE)
- Mega-cap: +10%
- Large-cap: +12%
- Mid-cap: +15%

**Custom Lot-Level Stops**:
- Can set custom stop-loss per lot
- Stored in database (position_lots table)
- Checked before default percentage-based stops
- Allows for nuanced risk management

**Trailing Stops**:
- Automatically adjust as position appreciates
- Lock in profits on winning positions
- Prevent giving back large gains

### Correlation Risk Management

**Prevents Over-Concentration**:
- Checks correlation with existing positions before new buys
- Warns if new position highly correlated with existing holdings
- Considers both direct correlation and sector overlap

**Example**: Already own NVDA (semiconductors), warned before buying AMD (also semiconductors, high correlation)

---

## Market Scenario Playbooks

### Scenario 1: Bull Market (VIX <20, SPY above 200-day MA)

**Characteristics**:
- Low volatility, steady uptrend
- Breadth strong (most stocks participating)
- Sentiment positive but not euphoric

**Strategy**:
- Target 75-80% long exposure
- 10-15% short exposure (selective)
- 10-15% cash
- Full position sizes (VIX multiplier 1.0x or 1.1x)
- Focus on growth and momentum
- Shorts in overvalued laggards

**Sector Focus**:
- Overweight: Technology, Consumer Discretionary, Industrials
- Underweight: Utilities, Consumer Staples (defensive)

---

### Scenario 2: Bear Market (VIX >25, SPY below 200-day MA)

**Characteristics**:
- High volatility, downtrend
- Breadth weak (most stocks declining)
- Sentiment negative, fear elevated

**Strategy**:
- Target 50-60% long exposure
- 15-25% short exposure (opportunistic)
- 20-30% cash
- Smaller position sizes (VIX multiplier 0.5x-0.75x)
- Focus on quality and defense
- Shorts in broken growth stocks

**Sector Focus**:
- Overweight: Healthcare, Consumer Staples, Utilities (defensive)
- Underweight: Technology, Consumer Discretionary (cyclical)

---

### Scenario 3: Choppy/Sideways Market (VIX 18-25, SPY range-bound)

**Characteristics**:
- Moderate volatility, no clear trend
- Breadth mixed (sector rotation)
- Sentiment uncertain

**Strategy**:
- Target 65-70% long exposure
- 10-15% short exposure
- 15-20% cash
- Standard position sizes (VIX multiplier 0.75x-1.0x)
- Focus on sector rotation and mean reversion
- Shorts in relative weakness

**Sector Focus**:
- Rotate to leading sectors
- Avoid lagging sectors
- Nimble positioning

---

### Scenario 4: Market Crash (VIX >35, SPY down >10% in days)

**Characteristics**:
- Extreme volatility, panic selling
- Breadth terrible (everything down)
- Sentiment panic, capitulation

**Strategy**:
- Target 40-50% long exposure
- 0-5% short exposure (covering pressure too high)
- 30-40% cash (preserve capital)
- Tiny position sizes (VIX multiplier 0.25x)
- DEFENSIVE MODE: No new positions until stabilization
- Wait for VIX to decline before deploying

**Sector Focus**:
- Only mega-cap quality names
- Avoid everything else
- Wait for opportunity

---

### Scenario 5: Low Cash, High Conviction Setup Available

**Situation**: Portfolio at 2% cash, compelling new opportunity identified

**Decision Framework**:
1. **Evaluate rotation candidates**: Review bottom 20% of positions
2. **Compare opportunities**: Is new setup materially better than weakest position?
3. **If yes**: Sell weakest position, buy new setup (rotation)
4. **If no**: Wait for natural capital freeing (stop-loss, take-profit)
5. **Exception**: If new setup is extremely high conviction (9/10+), can deploy to 0%

**Example**:
- Cash: $2k (2%)
- Weakest position: XYZ at +2% gain, sector up +8% (underperforming)
- New opportunity: ABC breaking out, strong earnings, sector leader
- Action: Sell XYZ, buy ABC (rotation)

---

### Scenario 6: Earnings Season Positioning

**Before Earnings** (position held through earnings):
- If profitable: Tighten stop-loss to protect gains
- If unprofitable: Consider exiting before earnings (avoid binary risk)
- Reduce position size if uncertain (trim 25-50%)

**After Earnings** (evaluating new positions):
- Beat + raise guidance: Strong buy signal (if technical confirms)
- Beat + maintain guidance: Neutral (wait for pullback)
- Beat + lower guidance: Avoid (market will punish)
- Miss: Avoid or short (if technical breaks)

**Earnings Calendar Awareness**:
- Know when positions report
- Adjust stops before earnings
- Evaluate results immediately after
- Act on thesis changes

---

### Scenario 7: Sector Rotation Signal

**Detecting Rotation**:
- One sector outperforming market by >5% over 2 weeks
- Another sector underperforming by >5%
- Volume confirming the moves

**Action**:
1. Identify leading sector (relative strength)
2. Identify lagging sector (relative weakness)
3. Rotate capital: Sell laggards, buy leaders
4. Maintain sector allocation limits (30% max)

**Example**:
- Technology outperforming by +8% (leadership)
- Energy underperforming by -6% (weakness)
- Action: Trim energy positions, add technology positions

---

### Scenario 8: VIX Spike (Sudden Jump >5 Points)

**Immediate Actions**:
1. Assess regime change (NORMAL → ELEVATED or FEAR)
2. Tighten stops on profitable positions
3. Raise cash reserve to regime target
4. NO NEW SHORTS (squeeze risk)
5. Reduce new position sizes per regime multiplier

**If VIX >30**:
- DEFENSIVE MODE activated
- No new positions until VIX declines
- Protect capital, wait for opportunity

**After VIX Declines**:
- Resume normal operations
- Deploy cash into quality names
- New shorts allowed again below VIX 20

---

## Order Management Strategy

### Order Type Selection

**Market Orders**:
- Use ONLY for emergency exits (stop-loss hit, thesis breaks)
- Immediate execution, but poor price
- Acceptable slippage for risk management

**Limit Orders**:
- Default for all entries
- Better price, but may not fill
- Set limit at current ask or slightly above for higher fill probability

**Stop-Loss Orders**:
- Automatic risk management
- Triggers market order when price hits stop level
- Required for all short positions

**Stop-Limit Orders**:
- Controlled exit price
- Triggers limit order when price hits stop level
- Risk: May not fill if price gaps through limit

**OCO (One-Cancels-Other)**:
- Bracket order: Stop-loss + take-profit
- When one fills, other cancels
- Good for defined risk/reward setups

**Trailing Stops**:
- Automatically adjusts as price moves in your favor
- Locks in profits on winning positions
- Prevents giving back large gains

### Dynamic Order Modification

**When to Modify Orders**:
1. **News changes thesis**: Earnings call, product launch, macro event
2. **Technical levels change**: New support/resistance established
3. **Volatility changes**: Widen stops in high volatility, tighten in low
4. **Time decay**: Approaching earnings, tighten stops if profitable

**Modification Examples**:
- **Tighten stop before earnings**: Position at +15%, earnings tomorrow → move stop to +10%
- **Widen stop on thesis strengthening**: Strong earnings beat → widen stop to give position room
- **Emergency exit**: Thesis breaks completely → cancel all orders, market sell immediately

**Order Modification History**:
- All modifications tracked in database
- Includes reasoning for each change
- Audit trail for performance review

---

## Performance Optimization

### Performance Feedback Loop

**Analyzes Closed Trades**:
- Reviews gain/loss reports from Tradier
- Identifies winning vs losing patterns
- Tracks hold duration optimization
- Detects repeated mistakes

**Pattern Identification**:
- Which sectors performed best?
- Which stock types had highest win rate?
- Optimal hold duration by position type?
- Common mistakes (chasing, early exits, etc.)?

**Continuous Improvement**:
- Adjust strategy based on results
- Double down on what works
- Eliminate what doesn't
- Refine entry/exit criteria

### Weekly Performance Review

**Sunday Deep Analysis**:
- Review week's performance vs S&P 500
- Position-by-position thesis check
- Sector performance analysis
- Strategy adjustments for coming week

**Key Questions**:
1. Which positions are working? Why?
2. Which positions are not working? Why?
3. Any thesis changes needed?
4. Any positions to exit or trim?
5. Any new opportunities to add?

### Performance Metrics Tracked

- **Total Return**: Portfolio value change over time
- **vs S&P 500**: Benchmark comparison (goal: outperform)
- **Win Rate**: Percentage of profitable trades (target: >55%)
- **Profit Factor**: Winners vs losers ratio (target: >2.0)
- **Max Drawdown**: Largest peak-to-trough decline (limit: 20%)
- **Sharpe Ratio**: Risk-adjusted returns (target: >1.0)
- **Long/Short Exposure**: Current positioning breakdown

---

## Summary: Key Strategic Principles

1. **VIX regime drives position sizing**: Adjust all trades BEFORE sector validation
2. **Cash is context, not constraint**: Can deploy to 0% for high conviction, but evaluate rotation candidates when low
3. **Sector limits prevent concentration**: 30% max per sector (25% in high VIX)
4. **Stops are mandatory for shorts**: Unlimited loss risk requires protection
5. **Correlation matters**: Avoid over-concentration in correlated positions
6. **Quality over quantity**: 10-12 positions optimal, not 20+
7. **Let winners run**: Trim in tiers (25% at +30%, 25% at +60%, let 50% run)
8. **Cut losers quickly**: Stop-loss discipline prevents catastrophic losses
9. **Adapt to regime**: Bull/bear/choppy markets require different approaches
10. **Learn from results**: Performance feedback loop drives continuous improvement

---

**Last Updated**: April 8, 2026  
**Version**: 2.0 (includes Feature 0 - Smart Cash Management and sector allocation fix)
