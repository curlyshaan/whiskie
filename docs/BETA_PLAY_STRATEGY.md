> [!IMPORTANT]
> Historical or planning document.
> This file is retained for context, but it is **not** the source of truth for the current implementation.
> Use `README.md`, `ARCHITECTURE.md`, `FUNDAMENTAL_SCREENER_METRICS.md`, and `CLAUDE.md` for current behavior.

# Beta Play Strategy

**"The way to build superior long-term returns is through preservation of capital and home runs."**  
— Stanley Druckenmiller

## Philosophy

Whiskie implements a **Beta Play** strategy that balances capital preservation with asymmetric upside opportunities. The goal is not just to match the market, but to outperform through intelligent position sizing, dynamic risk management, and opportunistic shorting.

### Core Principles

1. **Preservation of Capital**: Hard-coded safeguards prevent catastrophic losses
2. **Home Runs**: AI identifies asymmetric opportunities with 3-5x+ potential
3. **Dynamic Positioning**: Adjust exposure based on market conditions and conviction
4. **Opportunistic Shorting**: Capture downside moves in overvalued names

## Portfolio Allocation

### Target Allocation
- **70-80% Long Exposure**: Core long positions in quality names
- **0-30% Short Exposure**: Opportunistic shorts in overvalued/deteriorating names
- **10-20% Cash**: Dry powder for opportunities and risk buffer

### Position Sizing Rules

**Long Positions:**
- Standard position: 10% of portfolio
- High conviction: up to 15% (requires strong thesis + multiple confirming signals)
- Maximum single position: 15%

**Short Positions:**
- Standard short: 5-10% of portfolio
- Maximum single short: 10%
- Maximum total shorts: 30% of portfolio

## Long Strategy: Finding Home Runs

### What Makes a Home Run Long?

1. **Structural Tailwinds**: Secular growth trends (AI, cloud, electrification, etc.)
2. **Inflection Points**: Product launches, market share gains, margin expansion
3. **Underappreciation**: Market hasn't priced in the full opportunity
4. **Catalyst Path**: Clear near-term events that can drive re-rating

### Entry Criteria for High-Conviction Longs

- **Technical**: Breaking out of consolidation, strong relative strength
- **Fundamental**: Revenue acceleration, margin expansion, market share gains
- **Sentiment**: Institutional accumulation, options activity showing bullish positioning
- **Timing**: Good entry point (pullback to support, pre-earnings setup)

### Examples of Home Run Setups

- **NVDA 2022-2023**: AI infrastructure buildout, data center dominance
- **PLTR 2023-2024**: Government AI adoption, commercial acceleration
- **SMCI 2023**: AI server demand, supply chain advantage
- **TSLA 2019-2020**: Model 3 ramp, China factory, profitability inflection

### Position Management for Longs

**Initial Entry:**
- Start with 5-10% position
- Use limit orders for better entry
- Set initial stop-loss 10-15% below entry

**Adding to Winners:**
- Add 2-5% on pullbacks if thesis strengthens
- Maximum position size: 15%
- Trail stop-loss as position appreciates

**Trimming Strategy:**
- Trim 25% at +30% gain (lock in profits)
- Trim 25% at +60% gain (reduce risk)
- Let remaining 50% run with trailing stop

## Short Strategy: Asymmetric Downside

### What Makes a Home Run Short?

1. **Overvaluation**: Priced for perfection, high multiples vs peers
2. **Deteriorating Fundamentals**: Slowing growth, margin compression, market share loss
3. **Structural Headwinds**: Secular decline, disruption, regulatory pressure
4. **Catalyst Path**: Earnings miss, guidance cut, loss of key customer

### Entry Criteria for Shorts

- **Technical**: Breaking support, weak relative strength, distribution
- **Fundamental**: Decelerating revenue, margin pressure, cash burn
- **Sentiment**: Insider selling, put activity, analyst downgrades
- **Valuation**: Trading at premium to peers despite worse fundamentals

### Sectors to Avoid Shorting

Opus decides based on market conditions, but generally avoid:
- **Strong secular tailwinds**: AI infrastructure, cloud leaders
- **Monopolies/duopolies**: Hard to disrupt, pricing power
- **Heavily shorted names**: Risk of short squeeze
- **Low float stocks**: Manipulation risk, liquidity issues

### Sectors Good for Shorting

- **Overvalued growth stocks**: High multiples, slowing growth
- **Disrupted industries**: Legacy players losing to new tech
- **Cyclical peaks**: Companies at top of cycle with nowhere to go but down
- **Frauds/accounting issues**: Red flags in financials

### Examples of Home Run Shorts

- **Regional Banks 2023**: SVB, SBNY - deposit flight, duration mismatch
- **Overvalued SaaS 2022**: High-multiple names with slowing growth
- **Retail disruption**: Legacy retailers losing to e-commerce
- **Energy transition**: Fossil fuel companies facing secular decline

### Position Management for Shorts

**Initial Entry:**
- Start with 5% position
- Use limit orders (don't chase)
- Set stop-loss 15-20% ABOVE entry (inverse logic)

**Adding to Winners:**
- Add 2-5% if stock bounces but thesis intact
- Maximum short position: 10%
- Trail stop-loss as stock declines

**Covering Strategy:**
- Cover 50% at -20% (stock down 20%)
- Cover 25% at -40%
- Let remaining 25% run or cover on technical bounce

## Risk Management

### Hard Limits (Code-Enforced)

- **Max trades per day**: 5
- **Max single trade value**: $15,000 (15% of $100k)
- **Max daily exposure change**: $50,000
- **Short position limits**: 10% per position, 30% total

### Dynamic Stop-Loss Management

**Long Positions:**
- Initial stop: 10-15% below entry
- Trail stop as position appreciates
- Tighten stop before earnings if position is profitable
- Widen stop if high conviction and thesis intact

**Short Positions:**
- Initial stop: 15-20% ABOVE entry (inverse logic)
- Trail stop as stock declines
- Cover immediately if thesis breaks (e.g., surprise positive news)
- Never let short loss exceed 25%

### Emergency Protocols

**Long Positions:**
- Market sell if stop-loss hit
- Market sell if thesis breaks (e.g., major negative news)
- Cancel all orders and sell if systemic risk event

**Short Positions:**
- Buy to cover immediately if stop hit
- Buy to cover if short squeeze detected (rapid price rise + volume)
- Buy to cover if borrow rate spikes (hard to borrow)

## AI Decision Framework

### When to Deploy Capital (Go Long)

Opus should recommend longs when:
1. **High conviction setup**: Multiple confirming signals align
2. **Asymmetric risk/reward**: 3:1 or better reward-to-risk ratio
3. **Catalyst path**: Clear near-term events to drive price
4. **Good entry point**: Pullback to support, not chasing

### When to Short

Opus should recommend shorts when:
1. **Overvaluation + deterioration**: Expensive AND fundamentals weakening
2. **Catalyst for decline**: Earnings miss, guidance cut, loss of key customer
3. **Technical breakdown**: Breaking support, distribution pattern
4. **ETB verified**: Stock is easy to borrow (checked via Tradier API)

### When to Hold Cash

Opus should hold cash when:
1. **No compelling setups**: Risk/reward not attractive
2. **Market uncertainty**: Elevated volatility, unclear direction
3. **Waiting for catalyst**: Known event coming (FOMC, earnings, etc.)
4. **Preservation mode**: Protecting gains after strong run

### When to Modify Orders

Opus should modify stop-loss/take-profit when:
1. **News changes thesis**: Earnings call, product launch, macro event
2. **Technical levels change**: New support/resistance established
3. **Volatility changes**: Widen stops in high volatility, tighten in low
4. **Time decay**: Approaching earnings, tighten stops if profitable

## Performance Metrics

### Success Criteria

- **Win rate**: Target 55-60% (more winners than losers)
- **Profit factor**: Target 2.0+ (winners 2x bigger than losers)
- **Max drawdown**: Keep under 15% from peak
- **Sharpe ratio**: Target 1.5+ (risk-adjusted returns)

### Learning from History

Whiskie uses Tradier gain/loss reports to learn:
- Which setups worked vs failed
- Optimal hold periods for winners
- Common mistakes (cutting winners early, holding losers too long)
- Sector/stock-specific patterns

## Execution Best Practices

### Timing

- **Avoid first 15 minutes**: High volatility, wide spreads
- **Avoid last 15 minutes**: Closing auction volatility
- **Avoid lunch hour**: Low liquidity
- **Best windows**: 9:45-11:30 AM ET, 2:00-3:45 PM ET

### Order Types

- **Limit orders**: Default for entries (better price)
- **Market orders**: Emergency exits only
- **Stop-loss orders**: Automatic risk management
- **OCO orders**: Bracket orders (stop + take-profit)
- **Trailing stops**: Lock in profits on runners

### Position Entry

- **Scale in**: Start with 5-10%, add on confirmation
- **Wait for pullback**: Don't chase breakouts
- **Use limit orders**: Get better entry price
- **Set stops immediately**: Risk management from day 1

### Position Exit

- **Trim winners**: Take profits at predetermined levels
- **Cut losers quickly**: Don't let small losses become big ones
- **Trail stops on runners**: Let winners run with protection
- **Cover shorts on bounces**: Take profits, don't get greedy

## Summary

The Beta Play strategy is about **intelligent aggression**: deploy capital when odds are favorable, protect capital when they're not, and size positions based on conviction. The goal is not to be fully invested at all times, but to be invested in the RIGHT things at the RIGHT time with the RIGHT size.

**Preservation of capital** keeps you in the game.  
**Home runs** make the returns.  
**Dynamic positioning** optimizes the balance.

This is how Whiskie aims to compound capital over time while managing risk intelligently.
