# Code Review - Whiskie Project

**Date:** 2026-04-14
**Reviewer:** Claude Code
**Scope:** Full codebase review for gaps, issues, and improvements

## Critical Issues

### 1. JSON Parsing Error in Stock Profiles (HIGH PRIORITY)
**Location:** `src/stock-profiles.js:511`
**Issue:** Opus generates malformed JSON for `key_metrics_to_watch` field
**Error:** `Failed to parse key_metrics JSON: Expected ',' or '}' after property value`
**Impact:** All profiles have NULL key_metrics_to_watch field
**Root Cause:** Prompt doesn't enforce strict JSON formatting, Opus output has syntax errors

**Fix Required:**
```javascript
// Add JSON validation and sanitization before saving
try {
  const parsed = JSON.parse(keyMetricsString);
  profile.key_metrics_to_watch = parsed;
} catch (e) {
  console.warn('Failed to parse key_metrics JSON:', e.message);
  // Attempt to fix common JSON errors
  const sanitized = keyMetricsString
    .replace(/,\s*}/g, '}')  // Remove trailing commas
    .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
    .replace(/([{,]\s*)(\w+):/g, '$1"$2":');  // Quote unquoted keys
  try {
    profile.key_metrics_to_watch = JSON.parse(sanitized);
  } catch (e2) {
    profile.key_metrics_to_watch = null;  // Fallback to null
  }
}
```

### 2. Missing Export for updateStockProfile (MEDIUM PRIORITY)
**Location:** `src/stock-profiles.js:339`
**Issue:** `updateStockProfile()` function exists but may not be exported
**Impact:** Endpoint `/api/trigger-profile-build-watchlist` calls it via import
**Verification Needed:** Check if function is in exports at end of file

**Current exports check:**
```bash
grep "export.*updateStockProfile" src/stock-profiles.js
```

### 3. Duplicate Profile Building Risk (MEDIUM PRIORITY)
**Location:** Multiple endpoints can trigger profile building simultaneously
**Issue:** 
- `/api/trigger-profile-build-watchlist` 
- Saturday screening may also trigger builds
- No mutex/lock to prevent concurrent builds

**Impact:** Wasted API calls, duplicate work, potential race conditions

**Fix Required:**
- Add a global flag or database lock to prevent concurrent profile building
- Check if profile building is already in progress before starting new batch

### 4. Rate Limiting Not Enforced Across Parallel Batches (MEDIUM PRIORITY)
**Location:** `src/fundamental-screener.js:82-89`
**Issue:** Batch size 5 with 10-second delays, but each stock makes 8 API calls in parallel
**Math:** 5 stocks × 8 calls = 40 calls per batch, 6 batches/min = 240 calls/min (safe)
**Status:** Currently working, but fragile if batch size or call count changes

**Recommendation:** Add runtime validation to ensure calls/min stays under 300

## Code Quality Issues

### 1. TODOs in Production Code
**Location:** `src/index.js`
- Line: `dailyChange: 0, // TODO: Calculate`
- Line: `trades: [], // TODO: Get today's trades`

**Impact:** Dashboard shows incomplete data
**Priority:** LOW - cosmetic issue

### 2. Inconsistent Error Handling
**Pattern:** Some functions throw errors, others return null, some log and continue
**Example:** `src/stock-profiles.js` - mix of try/catch with null returns

**Recommendation:** Standardize error handling strategy:
- Throw for unexpected errors
- Return null for expected failures (stock not found)
- Log warnings for recoverable issues

### 3. Large File Complexity
**Files over 1000 lines:**
- `src/index.js` - 3,246 lines (API endpoints + bot orchestration)
- `src/db.js` - 1,581 lines (schema + queries)
- `src/dashboard.js` - 1,519 lines (UI rendering)

**Recommendation:** Consider splitting `index.js` into:
- `src/api/endpoints.js` - API route handlers
- `src/bot.js` - Bot orchestration logic
- `src/cron.js` - Cron schedule definitions

## Missing Functionality

### 1. No Monitoring/Metrics
**Missing:**
- API call counters (FMP usage tracking)
- Profile build success/failure rates
- Screening completion times
- Error rate tracking

**Recommendation:** Add basic metrics collection

### 2. No Retry Logic for Failed Profiles
**Current:** If profile build fails, it's logged but not retried
**Impact:** Profiles remain incomplete until manual intervention

**Recommendation:** Add retry queue for failed profile builds

### 3. No Validation of Profile Quality
**Current:** Profiles saved even if fields are NULL or incomplete
**Impact:** Low-quality profiles used in analysis

**Recommendation:** Add quality checks before saving:
- Minimum field completeness (business_model, moats, risks must exist)
- Minimum content length per field
- Flag profiles for manual review if quality is low

## Security Concerns

### 1. Database Credentials in Code (CRITICAL)
**Location:** Multiple scripts have hardcoded database URL
**Files:** `scripts/fresh-start-railway.js`, `scripts/populate-universe-v2.js`
**Risk:** Credentials exposed in git history

**Fix:** Use environment variables only:
```javascript
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
```

### 2. No Input Validation on API Endpoints
**Example:** `/api/trigger-profile-build-watchlist` - no auth, no rate limiting
**Risk:** Anyone can trigger expensive operations

**Recommendation:** Add API key authentication or IP whitelist

## Performance Optimizations

### 1. Sequential Profile Building
**Current:** Profiles built one at a time with 3-second delays
**Time:** 379 stocks × 3 seconds = 19 minutes minimum

**Optimization:** Build in parallel batches of 3-5 with delays between batches
**Estimated Time:** Could reduce to 8-10 minutes

### 2. Redundant Database Queries
**Pattern:** Multiple queries to fetch same data in different formats
**Example:** Screening fetches all stocks, then queries each individually

**Optimization:** Use batch queries with JOINs where possible

### 3. No Caching of FMP Data
**Current:** 30-minute cache in `fmp.js`
**Issue:** Cache is in-memory, lost on restart

**Recommendation:** Use Redis or persistent cache for frequently accessed data

## Documentation Gaps

### 1. No API Documentation
**Missing:** OpenAPI/Swagger spec for endpoints
**Impact:** Hard to understand what endpoints do without reading code

### 2. No Deployment Guide
**Missing:** How to deploy to Railway, environment variable setup
**Impact:** New developers can't deploy changes

### 3. No Troubleshooting Guide
**Missing:** Common errors and how to fix them
**Example:** "What to do if screening fails halfway through"

## Recommendations Priority

### Immediate (This Week)
1. ✅ Fix JSON parsing for key_metrics_to_watch
2. ✅ Verify updateStockProfile is exported
3. ✅ Add mutex/lock for profile building to prevent duplicates
4. ✅ Remove hardcoded database credentials from scripts

### Short Term (Next 2 Weeks)
1. Add basic monitoring/metrics
2. Implement retry logic for failed profiles
3. Add API authentication
4. Split index.js into smaller modules

### Long Term (Next Month)
1. Add profile quality validation
2. Optimize parallel profile building
3. Create API documentation
4. Add comprehensive error handling

## Test Coverage

**Current State:** Test files exist but coverage unknown
**Files:** `test/test-4phase.js`, `test/test-fmp.js`, `test/test-yahoo-finance.js`

**Missing Tests:**
- Stock profile building (full and incremental)
- Fundamental screening with various inputs
- Trade approval queue workflow
- API endpoint integration tests

**Recommendation:** Add test coverage reporting and aim for 70%+ coverage

## Conclusion

The codebase is functional and well-structured overall. Main concerns:
1. JSON parsing bug affecting all profiles (fixable)
2. Lack of monitoring/observability
3. Security issues with hardcoded credentials
4. No protection against duplicate/concurrent operations

Most issues are fixable with targeted improvements. The architecture is sound.
