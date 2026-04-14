# Pathway-Specific Exit Strategy Analysis

## Question for Opus

User concern: "I like MSFT now, believe it's a value dip, probably think it's 2x-3x in future, plan to hold it for multiple years. Going by Whiskie's rules, it will probably set a target price which may hit in 6 months and miss out on future highs."

**Core issue**: Different pathways have different investment horizons and exit strategies:
- **Value dips**: Mean reversion plays (weeks to months)
- **Deep value**: Long-term compounding (years)
- **High growth**: Momentum rides (months)
- **Turnarounds**: Multi-year transformations
- **Cash machines**: Dividend compounders (hold indefinitely?)

Current system uses uniform exit rules regardless of pathway.

## Prompt for Opus Analysis

```
You are Whiskie, an AI portfolio manager. You need to design pathway-specific exit strategies.

**Current Problem:**
All positions use the same exit logic:
- Take-profit at +15-25% (fixed at entry)
- Stop-loss at -5-8%
- Trailing stops activate at +15%

This doesn't match investment thesis:
- A "value dip" (MSFT oversold) should exit at fair value (~15-20% gain)
- A "deep value" (undervalued compounder) should hold for years (2-3x)
- A "high growth" (momentum) should ride the trend with trailing stops
- A "turnaround" (multi-year transformation) needs patience through volatility

**Your Task:**
Design exit strategies for each pathway. Consider:

1. **Time horizon**: Days? Months? Years?
2. **Exit trigger**: Price target? Fundamental change? Technical breakdown?
3. **Profit-taking**: Trim at milestones? Hold full position? Scale out?
4. **Stop-loss**: Tight (momentum)? Wide (value)? None (long-term)?
5. **Re-evaluation**: Daily? Weekly? Quarterly?

**Pathways to analyze:**

LONG PATHWAYS:
1. **deepValue** - Undervalued quality companies (low P/E, high ROE)
2. **highGrowth** - Revenue/earnings acceleration (high growth rates)
3. **inflection** - Turnaround stories (improving fundamentals)
4. **cashMachine** - High FCF, buybacks, dividends
5. **qarp** - Quality at reasonable price (balanced metrics)
6. **turnaround** - Multi-year transformations
7. **value_dip** - Temporary weakness in quality names

SHORT PATHWAYS:
1. **overvalued** - Excessive valuations (high P/E, low growth)
2. **deteriorating** - Declining fundamentals (margin compression)
3. **overextended** - Technical exhaustion (overbought)

**Output Format:**

For each pathway, provide:

### [PATHWAY_NAME]
**Investment Thesis**: [1-2 sentences]
**Time Horizon**: [days/weeks/months/years]
**Initial Take-Profit**: [% or "none - hold for thesis"]
**Stop-Loss**: [% or "fundamental only"]
**Trailing Stop**: [when to activate, trail distance]
**Profit-Taking Strategy**: [trim at milestones? hold full? scale out?]
**Re-evaluation Frequency**: [daily/weekly/monthly/quarterly]
**Exit Conditions**: [what invalidates the thesis?]
**Example**: [MSFT as value_dip vs deepValue]

**Constraints:**
- Must be implementable in code (clear rules, not discretionary)
- Must protect capital (no "hold forever" without stops)
- Must allow multi-year holds for appropriate pathways
- Must handle partial exits (trim 50%, let rest run)

Think through each pathway carefully. What would a professional fund manager do?
```

## Expected Output

Opus should provide detailed exit strategies that we can implement in:
- `src/trade-executor.js` - Set pathway-specific targets at entry
- `src/index.js` - Daily monitoring checks pathway-specific rules
- `src/trade-approval.js` - Show pathway + exit strategy in approval UI

## Implementation Plan (After Opus Response)

1. Add `pathway` field to `positions` table
2. Create `pathway-exit-strategies.js` module with rules
3. Modify `trade-executor.js` to set pathway-specific targets
4. Update daily monitoring to check pathway-specific exit conditions
5. Add "modify target" approval flow for long-term holds
6. Update trade approval UI to show pathway + exit strategy

---

**Status**: Awaiting Opus analysis before implementation
