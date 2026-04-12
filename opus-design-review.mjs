import dotenv from 'dotenv';
import axios from 'axios';
import { readFileSync } from 'fs';

dotenv.config({ path: '/Users/sshanoor/ClaudeProjects/Whiskie/.env' });

const QUATARLY_API_KEY = process.env.QUATARLY_API_KEY;
const QUATARLY_BASE_URL = process.env.QUATARLY_BASE_URL;

const designFlow = readFileSync('/tmp/whiskie-design-flow.md', 'utf8');

const prompt = `You are reviewing the complete design of an autonomous trading bot called Whiskie.

Please provide a comprehensive assessment covering:

1. **Overall Architecture**: Is the combined long + short screening approach optimal? Any structural issues?

2. **4 Long Pathways**: Are they comprehensive? Do they cover the full opportunity set? Any gaps?
   - Deep Value (P/E <15, P/B <1.5, PEG <1, debt/equity <0.5)
   - High Growth (revenue >30%, earnings >25%)
   - Inflection Point (Q-over-Q acceleration, catches NVDA-type stocks)
   - Cash Machine (FCF yield >8%, growing FCF)

3. **Short Safety**: Are the safety checks sufficient?
   - Short float <20% at screening
   - IV <80% at execution time
   - Market cap >$2B, volume >$20M/day
   - Is this adequate meme stock protection?

4. **Stock Profile System**: Is biweekly refresh optimal? Right information captured?

5. **4-Phase Analysis**: Are thinking budgets appropriate? (50k for Phase 2/3, 20k for Phase 4)

6. **Risks and Gaps**: What could go wrong? What edge cases are missing? What would you improve?

Be thorough and critical. Point out any flaws, risks, or improvements.

---

DESIGN DOCUMENT:

${designFlow}
`;

const client = axios.create({
  baseURL: QUATARLY_BASE_URL,
  headers: {
    'Authorization': `Bearer ${QUATARLY_API_KEY}`,
    'Content-Type': 'application/json'
  },
  timeout: 300000
});

console.log('🧠 Sending design to Opus for review (30k thinking budget)...');
console.log('⏳ This may take 5-10 minutes...\n');

const response = await client.post('/v1/messages', {
  model: 'claude-opus-4-6-thinking',
  max_tokens: 16000,
  thinking: {
    type: 'enabled',
    budget_tokens: 30000
  },
  temperature: 1,
  messages: [{ role: 'user', content: prompt }]
});

const textBlocks = response.data.content.filter(b => b.type === 'text');
const result = textBlocks.map(b => b.text).join('\n');

console.log('=== OPUS DESIGN REVIEW ===\n');
console.log(result);
