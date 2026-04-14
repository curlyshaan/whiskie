import claude, { MODELS } from './src/claude.js';

const prompt = `You are Whiskie, an AI portfolio manager. Design pathway-specific exit strategies.

**Current Problem:**
All positions use uniform exit logic regardless of investment thesis:
- Take-profit at +15-25% (fixed at entry)
- Stop-loss at -5-8%
- Trailing stops activate at +15%

This doesn't match reality:
- 'value_dip' (MSFT oversold) should exit at fair value (~15-20%)
- 'deepValue' (undervalued compounder) should hold for years (2-3x)
- 'highGrowth' (momentum) should ride trend with trailing stops
- 'turnaround' (multi-year transformation) needs patience through volatility

**User's concern:**
"I like MSFT, believe it's a value dip, probably 2x-3x in future, plan to hold multiple years. Whiskie will set a target that hits in 6 months and miss future highs. Some stocks I want to hold long-term (with stop loss if fundamentals change), not all stocks are meant like that. NVDA 2x-3x and now is like a blue chip hold-it stock."

**Your Task:**
Design exit strategies for each pathway that are:
1. Implementable in code (clear rules, not discretionary)
2. Protect capital (no 'hold forever' without stops)
3. Allow multi-year holds for appropriate pathways
4. Handle partial exits (trim 50%, let rest run)

**Pathways:**

LONG:
1. deepValue - Undervalued quality (low P/E, high ROE)
2. highGrowth - Revenue/earnings acceleration
3. inflection - Turnaround stories (improving fundamentals)
4. cashMachine - High FCF, buybacks, dividends
5. qarp - Quality at reasonable price
6. turnaround - Multi-year transformations
7. value_dip - Temporary weakness in quality names

SHORT:
1. overvalued - Excessive valuations
2. deteriorating - Declining fundamentals
3. overextended - Technical exhaustion

**For each pathway provide:**
- Investment Thesis (1-2 sentences)
- Time Horizon (days/weeks/months/years)
- Initial Take-Profit (% or 'none - hold for thesis')
- Stop-Loss (% or 'fundamental only')
- Trailing Stop (when to activate, trail distance)
- Profit-Taking Strategy (trim at milestones? hold full? scale out?)
- Re-evaluation Frequency (daily/weekly/monthly/quarterly)
- Exit Conditions (what invalidates the thesis?)
- Example (MSFT as value_dip vs deepValue, NVDA as blue chip)

Think like a professional fund manager. What would they do?`;

const messages = [{ role: 'user', content: prompt }];

console.log('🧠 Calling Opus with extended thinking (30k token budget)...');
console.log('⏳ This will take 3-5 minutes...\n');

claude.sendMessage(messages, MODELS.OPUS, null, true, 30000)
  .then(response => {
    const parsed = claude.parseAnalysisResponse(response);
    console.log('\n' + '='.repeat(80));
    console.log('OPUS RECOMMENDATIONS ON PATHWAY-SPECIFIC EXIT STRATEGIES');
    console.log('='.repeat(80) + '\n');
    console.log(parsed.analysis);
    console.log('\n' + '='.repeat(80));
    console.log(`Model: ${parsed.model}`);
    console.log(`Tokens: ${JSON.stringify(parsed.usage)}`);
    console.log('='.repeat(80));
  })
  .catch(error => {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  });
