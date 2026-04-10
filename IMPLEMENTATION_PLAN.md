# 4-Phase Analysis System Implementation Plan

## Overview
Replace the current 2-phase analysis system with a 4-phase system that provides separate deep thinking for long and short candidates.

## Current State
- Phase 1: Pre-ranking (no thinking) - selects 25-35 stocks
- Phase 2: Deep analysis (50k tokens) - analyzes all stocks together

## Target State
- Phase 1: Pre-ranking (no thinking) - selects 15-20 longs + 15-20 shorts
- Phase 2: Long Analysis (50k tokens) - deep analysis of long candidates only
- Phase 3: Short Analysis (50k tokens) - deep analysis of short candidates only  
- Phase 4: Portfolio Construction (20k tokens) - combines insights from phases 2 & 3

## Implementation Steps

### Step 1: Update Phase 1 prompt ✅ DONE
- Changed from "25-35 stocks total" to "15-20 longs + 15-20 shorts"
- Updated sector constraint from "3-4 per sub-sector" to "0-3 per sector"
- Changed output format to LONG_CANDIDATES and SHORT_CANDIDATES sections

### Step 2: Add extraction method ✅ DONE
- Created `extractLongShortCandidates()` method
- Parses LONG_CANDIDATES and SHORT_CANDIDATES sections separately
- Returns {longs: [], shorts: []} object

### Step 3: Update candidate extraction ✅ DONE
- Changed from `extractTickers()` to `extractLongShortCandidates()`
- Updated logging to show separate long/short counts

### Step 4: Update price fetching ✅ DONE
- Changed to fetch prices for both long and short candidates
- Combined into single `allCandidates` array

### Step 5: Implement Phase 2 (Long Analysis) - IN PROGRESS
- Create dedicated prompt for long candidates only
- Include all context (cash, VIX, macro, etc.)
- Request BUY/PASS decisions with detailed reasoning
- Enforce 0-3 stocks per sector limit
- Call with 50k thinking budget

### Step 6: Implement Phase 3 (Short Analysis) - TODO
- Create dedicated prompt for short candidates only
- Include all context
- Request SHORT/PASS decisions with detailed reasoning
- Require technical confirmation (declining 200MA, RSI, no earnings)
- Enforce 0-3 stocks per sector limit
- Call with 50k thinking budget

### Step 7: Implement Phase 4 (Portfolio Construction) - TODO
- Create prompt that combines Phase 2 & 3 results
- Review all recommendations and enforce final sector limits
- Balance portfolio allocation based on market regime
- Select final trades that maximize risk-adjusted returns
- Call with 20k thinking budget

### Step 8: Update analysis logging - TODO
- Change reasoning from "Two-phase" to "4-phase"
- Update stock count references from `tickersToAnalyze` to `allAnalyzedStocks`
- Log all 4 phase durations

### Step 9: Update token usage display - TODO
- Show separate token usage for each phase
- Display total thinking budget used (120k max)

## Key Changes Summary
- Total thinking budget: 120k tokens (50k + 50k + 20k)
- Total time: 8-12 minutes (3-5min + 3-5min + 1-2min)
- Ensures equal depth for both longs and shorts
- Sector diversification enforced across all phases
