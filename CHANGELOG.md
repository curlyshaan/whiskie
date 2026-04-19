# Whiskie Changelog

All notable changes to this project will be documented in this file.

## [2026-04-11] - Trade Reasoning & Cron Job Status

### Added
- **Trade Reasoning Enhancement**
  - Phase 2 (Long Analysis) and Phase 3 (Short Analysis) now stored in database
  - Per-stock reasoning extraction from Phase 2/3 analyses
  - Stock reasoning map links detailed thesis to each trade approval
  - Dashboard now displays all 3 phases with proper labels:
    - 📈 Phase 2: Long Analysis
    - 📉 Phase 3: Short Analysis
    - 🎯 Phase 4: Portfolio Construction
  - New function `extractStockReasoningFromPhases()` in `src/index.js:1983-2028`

- **Cron Job Status Dashboard**
  - New `/cron-status` route to view scheduled job execution history
  - Database table `cron_job_executions` tracks all cron job runs
  - Tracks 7 scheduled jobs:
    - Daily: Pre-Market Scan, Morning Analysis, Afternoon Analysis, Daily Summary
    - Weekly: FMP Screening Part 1, FMP Screening Part 2, Weekly Review
  - Shows job status (completed/failed/running/pending), duration, and error messages
  - Manual refresh only (no auto-refresh to save resources)
  - Accessible via "⏰ Cron Jobs" button on main dashboard

### Changed
- Trade approvals now show full reasoning from Phase 2/3 instead of generic "Long position in SYMBOL"
- All cron jobs wrapped with execution logging (`logCronJobStart`, `logCronJobComplete`)
- Dashboard analyses section now distinguishes between analysis phases with emojis and labels

### Fixed
- Trade reasoning extraction that was defaulting to fallback text
- Missing visibility into Phase 2 and Phase 3 analysis outputs

### Technical Details
- **Files Modified:**
  - `src/index.js` (+168 lines): Added reasoning extraction, Phase 2/3 storage, cron job logging
  - `src/db.js` (+84 lines): Added cron job tracking table and helper functions
  - `src/dashboard.js` (+242 lines): Added cron status route and HTML generation
- **New Database Table:** `cron_job_executions` with indexes on job_name, scheduled_time, status
- **New Database Functions:** `logCronJobStart()`, `logCronJobComplete()`, `getCronJobExecutions()`

### Notes
- Next analysis run will populate Phase 2/3 data and show detailed reasoning in trade approvals
- Cron job execution history will start accumulating from next scheduled run
- CLAUDE.md created for project documentation

## [2026-04-18] - FMP Stability, Adhoc Analyzer Alignment, and Runtime Cleanup

### Added
- Rolling FMP client throttling and 429 retry/backoff in `src/fmp.js`
- Richer adhoc analyzer context using:
  - `getDeepAnalysisBundle()`
  - structured catalyst research
  - watchlist pathway and weekly Opus conviction
  - existing position-management context
- Mounted adhoc analyzer process is now documented in the operator docs

### Changed
- Adhoc analyzer now follows a Whiskie-consistent single-stock analysis framework instead of a separate simplified review path
- Non-thinking Claude/Quatarly calls now use deterministic `temperature = 0`
- Friday earnings refresh moved from **3:00 PM ET** to **8:00 PM ET** to separate it from daytime trading load
- Daily analysis now reuses already-fetched quote data inside pre-ranking and reuses existing SPY market context for snapshot calculations
- Validation scripts in `test/` were updated to match the current module layout and FMP client stats output

### Fixed
- `/adhoc-analyzer` runtime failure caused by querying nonexistent `active_positions`
- Missing `trade_approvals` migration coverage for:
  - `override_phase2_decision`
  - `override_symbol`
  - `override_reason`
- Redundant same-run quote fetches inside pre-ranking
- Broken local test imports and outdated test assumptions

### Notes
- The growth expansion universe is still populated into `stock_universe`, but active screening/pre-ranking still excludes it because `EXCLUDE_GROWTH_UNIVERSE = true` remains intentionally enabled
- This release reduces FMP request duplication in the live daily path, but broader multi-phase quote/technical reuse is still a good next optimization target
