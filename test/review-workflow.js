import dotenv from 'dotenv';
import { MODELS } from './src/claude.js';
import axios from 'axios';

dotenv.config();

const QUATARLY_API_KEY = process.env.QUATARLY_API_KEY;
const QUATARLY_BASE_URL = process.env.QUATARLY_BASE_URL;

/**
 * Deep review of Whiskie workflow and decision logic using Opus extended thinking
 */

async function reviewWorkflow() {
  console.log('🧠 Starting deep workflow review with Claude Opus extended thinking...\n');

  const prompt = `You are reviewing the Whiskie AI trading bot's workflow and decision logic before deployment.

**CONTEXT:**
- Paper trading bot managing $100k portfolio
- Uses Tradier sandbox API for positions and trades
- Claude Opus with extended thinking for all decisions
- Scheduled runs: Daily (10 AM, 12:30 PM, 3:30 PM, 4:30 PM) + Weekly (Sunday 9 PM)

**RECENT ISSUE IDENTIFIED:**
- Tradier API returns cost_basis as TOTAL COST (not per-share)
- Code was treating it inconsistently
- Example: GLD with cost_basis=6006, quantity=14 → should be $428.99/share
- Fix applied: Always divide cost_basis by quantity

**REVIEW QUESTIONS:**

1. **Data Flow Analysis:**
   - Is the cost_basis fix applied everywhere positions are read from Tradier?
   - Are there any other Tradier API fields that might have similar issues?
   - Does the fix handle edge cases (zero quantity, negative quantity for shorts)?

2. **Decision Logic Validation:**
   - Weekly review: Does it correctly calculate gains/losses with fixed cost_basis?
   - Stop-loss triggers: Are thresholds appropriate for each stock type?
   - Take-profit scaling: Is the 20-25% trim strategy sound?
   - Risk limits: Are the hard-coded limits (15% max position, 20% drawdown) appropriate?

3. **Workflow Completeness:**
   - Are all scheduled tasks necessary and non-redundant?
   - Is the daily analysis frequency (4x/day) appropriate for paper trading?
   - Does the weekly review overlap with daily checks unnecessarily?

4. **Extended Thinking Usage:**
   - Is Opus with 50k token budget being used appropriately?
   - Are there cases where simpler analysis would suffice?
   - Is the cost (~$4 per deep analysis) justified for each use case?

5. **Edge Cases & Error Handling:**
   - What happens if Tradier API is down?
   - What if a position has zero or negative cost_basis?
   - How does the bot handle partial fills or rejected orders?
   - What if the database connection fails during a trade?

6. **Security & Safety:**
   - Are API keys properly secured?
   - Is there protection against accidental live trading?
   - Are there safeguards against runaway trading (max 3 trades/day)?
   - Can the bot accidentally short when it shouldn't?

**INSTRUCTIONS:**
Use your extended thinking to deeply analyze these questions. Identify:
- Critical issues that must be fixed before deployment
- Medium-priority improvements for future iterations
- Low-priority nice-to-haves

Be thorough and critical. This is paper trading, but we want to build it right.`;

  try {
    const client = axios.create({
      baseURL: QUATARLY_BASE_URL,
      headers: {
        'Authorization': `Bearer ${QUATARLY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const payload = {
      model: MODELS.OPUS,
      max_tokens: 16000,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
      thinking: {
        type: 'enabled',
        budget_tokens: 50000
      }
    };

    console.log('⏳ This will take 3-7 minutes for deep analysis...\n');
    const response = await client.post('/v1/messages', payload);

    const data = response.data;
    const textBlock = data.content.find(b => b.type === 'text');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 WORKFLOW REVIEW RESULTS');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(textBlock?.text || 'No response');
    console.log('\n═══════════════════════════════════════════════════════════');

    if (data.usage) {
      console.log('\n📊 Token Usage:');
      console.log(`   Input: ${data.usage.input_tokens?.toLocaleString() || 0}`);
      console.log(`   Output: ${data.usage.output_tokens?.toLocaleString() || 0}`);
      console.log(`   Total: ${(data.usage.input_tokens + data.usage.output_tokens)?.toLocaleString() || 0}`);
    }

  } catch (error) {
    console.error('❌ Error during workflow review:', error);
    throw error;
  }
}

reviewWorkflow()
  .then(() => {
    console.log('\n✅ Workflow review complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Workflow review failed:', error);
    process.exit(1);
  });
