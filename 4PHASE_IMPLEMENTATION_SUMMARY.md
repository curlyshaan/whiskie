# 4-Phase Analysis System - Implementation Summary

## Status: Ready to Implement

### What's Been Done ✅
1. Created `extractLongShortCandidates()` method in index.js (line ~1678)
2. Updated Phase 1 prompt to request LONG_CANDIDATES and SHORT_CANDIDATES (line ~1199-1234)
3. Updated candidate extraction to use new method (line ~1244-1251)
4. Updated price fetching for both long and short candidates (line ~1253-1257)
5. Created Opus-designed prompts in `opus-4phase-prompts.js`
6. Had Opus design complete 4-phase system with detailed prompts

### What Needs to Be Done 🔨

#### Step 1: Replace Current Phase 2 Prompt (lines 1303-1460)
**Current:** Single large prompt asking for all trade recommendations
**Replace with:** Phase 2 Long Analysis prompt from Opus design

#### Step 2: Replace Phase 2 API Call (lines 1468-1475)
**Current:**
```javascript
const analysis = await claude.deepAnalysis(
  portfolio,
  fullMarketData,
  news,
  {},
  phase2Question
);
```

**Replace with:**
```javascript
const phase2Analysis = await claude.deepAnalysis(
  portfolio,
  fullMarketData,
  news,
  {},
  phase2Question,
  50000  // 50k token thinking budget
);
```

#### Step 3: Insert Phase 3 (Short Analysis) After Phase 2
**Location:** After line 1476 (after phase2Duration calculation)
**Add:** Complete Phase 3 implementation with 50k thinking budget

#### Step 4: Insert Phase 4 (Portfolio Construction) After Phase 3
**Location:** After Phase 3 completion
**Add:** Complete Phase 4 implementation with 20k thinking budget

#### Step 5: Update Final Analysis Variable
**Current:** Uses `analysis` from Phase 2
**Change to:** Use `analysis` from Phase 4 (final portfolio construction)

#### Step 6: Update Logging (line 1510-1520)
**Current:** "Two-phase deep analysis"
**Change to:** "4-phase deep analysis. Phase 1: X longs + Y shorts. Phase 2: Long analysis (50k). Phase 3: Short analysis (50k). Phase 4: Portfolio construction (20k)."

#### Step 7: Update Stock Analysis Loop (line 1549)
**Current:** `for (const ticker of tickersToAnalyze)`
**Change to:** `for (const ticker of allAnalyzedStocks)` where `allAnalyzedStocks = [...candidates.longs, ...candidates.shorts]`

#### Step 8: Update Console Logging
**Current:** Shows Phase 1 and Phase 2 durations
**Change to:** Show all 4 phase durations

## Implementation Approach

Given file size (2417 lines) and complexity, recommend:

**Option A: Surgical Edits (Safer)**
- Make 8 focused edits as outlined above
- Each edit is small and targeted
- Lower risk of file corruption
- Takes more steps but more reliable

**Option B: Section Replacement (Faster)**
- Replace lines 1303-1520 in one operation
- Requires careful construction of replacement text
- Higher risk but fewer steps
- Need to ensure exact line matching

## Recommendation
Use **Option A (Surgical Edits)** because:
- File is large and complex
- Multiple previous attempts had corruption issues
- Surgical edits are more reliable
- Can verify each step before proceeding

## Next Steps
1. User approves approach
2. Implement Step 1 (replace Phase 2 prompt)
3. Implement Step 2 (update Phase 2 API call)
4. Implement Steps 3-4 (add Phase 3 and 4)
5. Implement Steps 5-8 (update logging and references)
6. Test the implementation

## Estimated Time
- Implementation: 10-15 minutes (8 surgical edits)
- Testing: User will need to run the bot to verify

## Files Modified
- `/Users/sshanoor/ClaudeProjects/Whiskie/src/index.js` (main implementation)
- Created: `opus-4phase-prompts.js` (prompt templates - reference only)
