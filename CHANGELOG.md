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
