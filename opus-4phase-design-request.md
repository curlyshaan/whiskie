# Request for Opus: Design 4-Phase Analysis System

## Context
You are Opus, the AI model powering Whiskie trading bot. We need you to review and design the complete 4-phase stock analysis system.

## Current Phase 1 Prompt (for your review)

```
You are managing a $100k portfolio.

**PHASE 1: Select 25-35 stocks from pre-ranked candidates for deep analysis**

**Current Portfolio:**
- Positions: X
- Total Value: $X
- Cash Available: $X

**Market Context:**
[SPY, QQQ, VIX prices]

**Recent News:**
[Market news]

**Pre-Ranked Candidates (algorithmic filter based on volume surge, momentum, sector strength):**

**Long Candidates (X stocks):**
[List of tickers]

**Short Candidates (X stocks):**
[List of tickers]

**Value Watchlist Momentum Triggers (X stocks):**
[Stocks showing momentum]

**Quality Watchlist Dip Opportunities (X stocks):**
[Quality stocks at dips]

**Overvalued Watchlist Breakdown Opportunities (X stocks):**
[Overvalued stocks breaking down]

**Your Task for Phase 1:**
1. Review the pre-ranked candidates above
2. Split into TWO separate lists:
   - **15-20 LONG candidates** for Phase 2 deep analysis
   - **15-20 SHORT candidates** for Phase 3 deep analysis
3. Prioritize:
   - Watchlist stocks that are at or near target entry prices
   - Stocks with strong fundamental catalysts (earnings, news, sector rotation)
   - Diversification across asset classes and sectors
4. **IMPORTANT: Max 0-3 stocks per sub-sector** (e.g., 0-3 semiconductors, 0-3 software stocks, 0-3 banks)
   - Sub-sectors include: Semiconductors, Software, Cybersecurity, Cloud, Biotech, Pharma, Banks, etc.
   - Choose 0-3 based on quality and market conditions - not mandatory to pick 3
   - If market conditions are bad for a sub-sector, pick 0 (skip it entirely)
   - This prevents over-concentration in a specific sub-sector

Format your response EXACTLY like this:
LONG_CANDIDATES:
MSFT
NVDA
LLY
...
(15-20 stocks)

SHORT_CANDIDATES:
ZS
OKTA
NKE
...
(15-20 stocks)

REASONING:
[Brief explanation of your selection criteria and sector diversification]
```

## Your Task

Please provide:

1. **Phase 1 Review**: Any improvements to the current Phase 1 prompt above?

2. **Phase 2 Design**: Design the prompt for deep analysis of LONG candidates
   - Thinking budget: 50,000 tokens
   - Time: 3-5 minutes
   - Goal: Analyze each long candidate, provide BUY/PASS decisions
   - Must enforce 0-3 per sub-sector limit
   - Output format: EXECUTE_BUY lines with reasoning

3. **Phase 3 Design**: Design the prompt for deep analysis of SHORT candidates
   - Thinking budget: 50,000 tokens
   - Time: 3-5 minutes
   - Goal: Analyze each short candidate, provide SHORT/PASS decisions
   - Must require technical confirmation (declining 200MA, RSI not oversold, no earnings)
   - Must enforce 0-3 per sub-sector limit
   - Output format: EXECUTE_SHORT lines with reasoning

4. **Phase 4 Design**: Design the prompt for portfolio construction
   - Thinking budget: 20,000 tokens
   - Time: 1-2 minutes
   - Goal: Combine Phase 2 & 3 results, enforce final sector limits, balance allocation
   - Input: Full text from Phase 2 and Phase 3 analyses
   - Output format: Final EXECUTE_BUY and EXECUTE_SHORT recommendations

## Constraints

- Total portfolio: $100k
- Target positions: 10-12
- Max position size: 12% of portfolio
- Sub-sector limit: 0-3 stocks per sub-sector (across both longs and shorts)
- Market regime aware (bull/bear/neutral)

## Output Format

Please structure your response as:

### Phase 1 Improvements
[Your suggestions or "No changes needed"]

### Phase 2 Prompt (Long Analysis)
[Complete prompt text]

### Phase 3 Prompt (Short Analysis)
[Complete prompt text]

### Phase 4 Prompt (Portfolio Construction)
[Complete prompt text]

### Implementation Notes
[Any special considerations for implementing this system]
