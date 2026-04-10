// Run this to get Opus's review of the stock profile design
import claude from './src/claude.js';

const prompt = `Review this stock profile system design and provide recommendations:

CURRENT IMPLEMENTATION:
- stock_analysis_history table stores past trade decisions (thesis, recommendation, confidence)
- Phase 2/3 fetch this history and show it to Opus
- Opus can reference previous notes and focus on what changed

PROPOSED ENHANCEMENT:

1. New stock_profiles table with comprehensive research:
   - business_model, moats, competitive_advantages, fundamentals, risks, catalysts

2. Weekend deep research job (Saturday/Sunday):
   - Targets watchlist stocks (NOW, FICO, MA, etc.)
   - 10-20k token deep research per stock
   - Updates existing profiles

3. Daily run optimization:
   - Fetch profiles in Phase 2/3
   - Prompt: "Here's the existing profile, focus on what's new/changed"
   - First-time stocks: Full deep dive (2-3 min)
   - Repeat stocks with profiles: Quick update (30-60 sec)

EXPECTED BENEFITS:
- Faster daily runs (less redundant research)
- More consistent analysis (persistent knowledge base)
- Better long-term thesis tracking
- Clear separation: deep research (weekend) vs tactical updates (daily)

QUESTIONS:
1. Will this improve analysis quality and efficiency?
2. Is current stock_analysis_history sufficient, or is this enhancement valuable?
3. Concerns about data staleness, complexity, maintenance?
4. Alternative approaches?
5. Is weekend deep research + daily incremental pattern sound?

Provide honest assessment and recommendations.`;

try {
  console.log('🤔 Asking Opus to review the design...\n');
  const result = await claude.sendMessage(prompt, 'claude-opus-4-6-thinking', 10000);
  console.log('=== OPUS REVIEW ===\n');
  console.log(result.content);
  console.log('\n=== END REVIEW ===');
} catch (error) {
  console.error('Error:', error.message);
}
