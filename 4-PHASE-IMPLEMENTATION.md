# 4-Phase Analysis Implementation - Detailed Changes

## Current Status
✅ Phase 1 prompt updated to request LONG_CANDIDATES and SHORT_CANDIDATES
✅ extractLongShortCandidates() method added
✅ Candidate extraction updated to use new method
✅ Price fetching updated for both long and short candidates

## Remaining Work

### Phase 2-4 Implementation Strategy

The current code has a single large Phase 2 prompt (lines ~1302-1455) that needs to be replaced with THREE separate phases:

**Phase 2: Long Analysis (50k tokens)**
- Analyze ONLY long candidates
- Request BUY/PASS decisions
- Enforce 0-3 per sector

**Phase 3: Short Analysis (50k tokens)**  
- Analyze ONLY short candidates
- Request SHORT/PASS decisions
- Require technical confirmation

**Phase 4: Portfolio Construction (20k tokens)**
- Combine Phase 2 & 3 results
- Final sector limit enforcement
- Balance allocation

### Key Code Locations

1. **Line 1302-1455**: Current Phase 2 prompt - REPLACE with Phase 2 (long analysis)
2. **After Phase 2 call**: INSERT Phase 3 (short analysis)
3. **After Phase 3 call**: INSERT Phase 4 (portfolio construction)
4. **Line 1510**: Update reasoning text from "Two-phase" to "4-phase"
5. **Line 1540**: Update stock count from `tickersToAnalyze` to `allAnalyzedStocks`
6. **Line 1549**: Update stock analysis loop to use `allAnalyzedStocks`

### Implementation Approach

Due to file size (2417 lines), I'll use surgical edits:
1. Replace Phase 2 prompt section
2. Replace Phase 2 API call to include thinking budget
3. Insert Phase 3 implementation after Phase 2
4. Insert Phase 4 implementation after Phase 3
5. Update logging and token display
6. Fix variable references

This avoids rewriting the entire file and prevents corruption.
