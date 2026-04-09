# Whiskie Trading Strategy - Complete Documentation

**Asset class-based allocation with dynamic risk management**

---

## Table of Contents

1. [Core Philosophy](#core-philosophy)
2. [Asset Class Allocation Framework](#asset-class-allocation-framework)
3. [Dynamic Allocation Limits](#dynamic-allocation-limits)
4. [VIX Regime Adaptation](#vix-regime-adaptation)
5. [Cash Management](#cash-management)
6. [Position Sizing](#position-sizing)
7. [Risk Management](#risk-management)
8. [Sector Rotation](#sector-rotation)

---

## Core Philosophy

**"The way to build superior long-term returns is through preservation of capital and home runs."** — Stanley Druckenmiller

### Beta Play Strategy
- **70-80% Long Exposure**: Quality stocks with asymmetric upside
- **0-25% Short Exposure**: Opportunistic shorts in overvalued names
- **10-20% Cash**: Dry powder for opportunities and risk buffer

### Three Pillars
1. **Long-term Anchors (35-40%)**: Mega-cap secular growth (NVDA, MSFT, META)
2. **Swing/Momentum (30-35%)**: Medium-term tactical positions (2-8 weeks)
3. **Short Positions (15-20%)**: Hedges and overvalued shorts

---

## Asset Class Allocation Framework

### GICS 11 Sectors (350+ Stocks)

**Replaces 41 sub-industries to prevent concentration risk**

Example: Old system allowed 30% semiconductors + 30% software = 60% tech. New system: All tech grouped under "Technology" with single 30% limit.

| Asset Class | Base Limit | Example Stocks |
|------------|-----------|----------------|
| **Technology** | 30% | NVDA, TSM, MSFT, ORCL, PANW, CRWD, AAPL |
| **Healthcare** | 25% | LLY, ABBV, UNH, TMO, VRTX, REGN |
| **Financials** | 25% | JPM, BAC, V, MA, BLK, GS |
| **Communication Services** | 20% | META, GOOGL, NFLX, DIS |
| **Industrials** | 20% | RTX, BA, CAT, UNP, GE |
| **Consumer Discretionary** | 20% | AMZN, TSLA, HD, MCD, SBUX |
| **Consumer Staples** | 20% | WMT, COST, PG, KO |
| **Energy** | 20% | XOM, CVX, COP, SLB |
| **Utilities** | 15% | NEE, DUK, SO |
| **Real Estate** | 15% | PLD, AMT, EQIX |
| **Materials** | 20% | LIN, APD, NUE |

### Hard Limits (Cannot Be Exceeded)
- **40% max per asset class** (emergency brake)
- **4 stocks max per asset class** (prevents 48% concentration via 4x12% positions)
- **3 asset classes minimum** (forces diversification)

---

## Dynamic Allocation Limits

**Formula**: `Adjusted Limit = Base Limit × Rate Multiplier × VIX Multiplier`

### Rate Environment Multipliers

**Set via**: `RATE_ENVIRONMENT` env variable (LOW_RATES, NEUTRAL_RATES, HIGH_RATES)

#### LOW_RATES (<3% Fed Funds)
- Technology: 30% → **36%** (+20%)
- Communication Services: 20% → **23%** (+15%)
- Consumer Discretionary: 20% → **23%** (+15%)
- Financials: 25% → **21%** (-15%)
- Real Estate: 15% → **15%** (0%)

**Rationale**: Growth stocks benefit from low discount rates

#### NEUTRAL_RATES (3-5% Fed Funds)
- All sectors: **1.0x** (no adjustment)

#### HIGH_RATES (>5% Fed Funds)
- Technology: 30% → **24%** (-20%)
- Communication Services: 20% → **18%** (-10%)
- Consumer Discretionary: 20% → **17%** (-15%)
- Financials: 25% → **31%** (+25%)
- Energy: 20% → **25%** (+25%)
- Consumer Staples: 20% → **23%** (+15%)
- Real Estate: 15% → **10%** (-30%)

**Rationale**: Value/cyclicals outperform in high-rate environments

### VIX Regime Multipliers

**Automatic**: Fetched from VIX API, applied on top of rate multipliers

#### CALM (VIX <15)
- All sectors: **1.0x** (no adjustment)
- Position sizes: **110%** (can oversize high-conviction)

#### NORMAL (VIX 15-20)
- All sectors: **1.0x**
- Position sizes: **100%** (standard)

#### ELEVATED (VIX 20-28)
- Technology: **0.90x** (30% → 27%)
- Healthcare: **1.10x** (25% → 27.5%)
- Consumer Staples: **1.10x** (20% → 22%)
- Utilities: **1.10x** (15% → 16.5%)
- Position sizes: **75%** (reduce exposure)

#### FEAR (VIX 28-35)
- Technology: **0.85x** (30% → 25.5%)
- Healthcare: **1.0x** (defensive, no cut)
- Consumer Staples: **1.0x** (defensive)
- Utilities: **1.0x** (defensive)
- Position sizes: **50%** (defensive mode)

#### PANIC (VIX >35)
- Technology: **0.85x** (30% → 25.5%)
- All cyclicals: **0.85x** (reduce risk)
- Defensives: **1.0x** (maintain)
- Position sizes: **25%** (extreme caution)
- **No new positions allowed**

---

## Cash Management

**Philosophy**: Cash is a tool, not a constraint. Informs Claude's judgment, doesn't mechanically block trades.

### Cash States

#### FLUSH (>12% cash)
- **Context**: Full deployment flexibility
- **Action**: Deploy normally on high and medium conviction setups
- **No restrictions**

#### NORMAL (5-12% cash)
- **Context**: 10% is resting target
- **Action**: Prefer not to drop below 5% without strong conviction
- **Guidance**: Prioritize best setups only if cash would drop under 5%

#### DEPLOYED (<5% cash)
- **Context**: Nearly fully deployed
- **Action**: Evaluate rotation candidates before new buys
- **Process**:
  1. Review existing positions for weak thesis
  2. Identify underperformers vs sector
  3. Look for better opportunities
  4. If no clear rotation → wait for stop-loss/take-profit to free capital
  5. Only bypass for extremely high conviction setups

#### ZERO (0% cash)
- **Context**: Fully deployed
- **Action**: Rotate only, no new positions
- **Mandate**: Must simultaneously exit weaker position when buying new
- **Exception**: None (hard rule)

### Rotation Candidates (Auto-Surfaced at <5% Cash)
- Positions with weakened thesis
- Underperformers vs sector benchmark
- Stocks with better alternatives available
- Sorted by gain % (lowest first)

---

## Position Sizing

### Long Positions

**Base sizes** (before VIX adjustment):
- Index ETF: **15%** max
- Mega-cap: **12%** max
- Large-cap: **10%** max
- Mid-cap: **8%** max
- Opportunistic: **5%** max

**VIX-adjusted** (automatic):
- CALM: Base × 1.10
- NORMAL: Base × 1.00
- ELEVATED: Base × 0.75
- FEAR: Base × 0.50
- PANIC: Base × 0.25

### Short Positions

**Tighter limits** (unlimited loss risk):
- Index ETF: **12%** max
- Mega-cap: **10%** max
- Large-cap: **8%** max
- Mid-cap: **6%** max
- Opportunistic: **3%** max (avoid)

**Total short exposure**: 25% max (up from 20% after 60 days)

---

## Risk Management

### Stop-Losses (Long Positions)

**Percentage-based** (triggers on price fall):
- Index ETF: **-12%**
- Blue-chip: **-12%**
- Large-cap: **-15%**
- Mid-cap: **-18%**
- Opportunistic: **-20%**

### Stop-Losses (Short Positions)

**Inverted** (triggers on price rise):
- Index ETF: **+8%**
- Mega-cap: **+10%**
- Large-cap: **+12%**
- Mid-cap: **+15%**
- Opportunistic: **+18%**

### Take-Profit Strategy

**No automatic trimming** - Opus manages all exits via `analyzeAndModifyOrders()`:
- Thesis changes (earnings miss, guidance down)
- News events (partnership, product launch)
- Technical signals (parabolic moves, support breaks)
- Dynamic trailing stops adjusted based on volatility

**Rationale**: Allows home run positions to compound without being trimmed to death

### Correlation Limits

- **0.7+ correlation**: Warning issued
- **Multiple high correlations**: Blocks trade
- **Purpose**: Prevents pseudo-diversification (e.g., 5 semiconductor stocks)

---

## Sector Rotation

**Integrated into weekly synthesis** - Opus receives sector momentum data:

### Relative Strength Calculation
- 4-week performance vs SPY
- 12-week performance vs SPY
- Status: LEADING (rotate INTO) or LAGGING (rotate OUT)

### Rotation Signals
- **Leading sectors** (>SPY): Increase allocation
- **Lagging sectors** (<SPY): Reduce allocation
- **Crossovers**: Early rotation signals

### Application
- Informs new position selection
- Triggers rotation reviews for existing positions
- Guides conviction ranking in weekly playbook

---

## Summary: What's Hardcoded vs Flexible

### Hardcoded (Cannot Override)
- ✅ 40% max per asset class
- ✅ 4 stocks max per asset class
- ✅ 3 asset classes minimum
- ✅ 12% max per long position
- ✅ 10% max per short position
- ✅ 25% max total short exposure
- ✅ Stop-loss percentages by stock type
- ✅ VIX regime position size multipliers

### Flexible (Claude Judgment)
- 🔄 Asset class target allocations (within limits)
- 🔄 Cash deployment timing
- 🔄 Rotation decisions
- 🔄 Take-profit timing
- 🔄 Position entry/exit based on thesis
- 🔄 Sector rotation implementation

### Dynamic (Auto-Adjusts)
- 📊 Asset class limits (rate × VIX multipliers)
- 📊 Position sizes (VIX regime)
- 📊 New position allowance (VIX PANIC = blocked)
- 📊 Sector rotation signals (weekly calculation)

---

**Last Updated**: 2026-04-09 (GICS asset class implementation)
