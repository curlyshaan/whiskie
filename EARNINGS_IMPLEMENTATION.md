# Earnings Scraper Implementation - Complete

## What Was Implemented

### 1. Created `src/earnings.js`
- Yahoo Finance scraper using cheerio
- `scrapeEarningsDate(symbol)` - Scrapes earnings date from Yahoo Finance
- `updateAllEarnings()` - Updates all 400 stocks (rate limited to 10 req/sec)
- `getNextEarning(symbol)` - Get next earnings date for a symbol
- `getUpcomingEarnings(days)` - Get all earnings in next N days
- Automatic cleanup of old earnings dates

### 2. Updated `src/db.js`
- Added `earnings_calendar` table to schema
- Created indexes on symbol and earnings_date
- Added functions:
  - `upsertEarning(symbol, date, time)`
  - `getNextEarning(symbol)`
  - `getUpcomingEarnings(days)`
  - `cleanupOldEarnings()`

### 3. Created Migration Script
- `migrations/add_earnings_calendar.sql`
- Run this to add earnings_calendar table to existing database

### 4. Updated `src/index.js`
- Added import for `updateAllEarnings`
- Added Sunday 9:00 PM ET cron job for weekly earnings update
- Includes error handling and email alerts

### 5. Updated `src/dashboard.js`
- Added `/api/watchlist` endpoint
- Returns watchlist with earnings dates joined from earnings_calendar
- Shows next earnings date for each watched stock

## How It Works

### Weekly Update (Sunday 9:00 PM ET)
```javascript
cron.schedule('0 21 * * 0', async () => {
  await updateAllEarnings(); // Scrapes all 400 stocks
  // Takes ~40 seconds (100ms delay between requests)
});
```

### Scraping Process
1. For each of 400 stocks from SUB_INDUSTRIES
2. Fetch Yahoo Finance page
3. Parse HTML with cheerio
4. Find "Earnings Date" field
5. Parse date (handles ranges like "Jan 30 - Feb 3")
6. Detect BMO/AMC if mentioned
7. Store in database
8. Clean up old earnings (date < today)

### Database Schema
```sql
CREATE TABLE earnings_calendar (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL,
  earnings_date DATE NOT NULL,
  earnings_time VARCHAR(10),  -- 'bmo', 'amc', or 'unknown'
  source VARCHAR(20) DEFAULT 'yahoo',
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(symbol, earnings_date)
);
```

### API Endpoints
- `GET /api/watchlist` - Returns watchlist with earnings dates

## Next Steps

1. **Run migration** to add earnings_calendar table:
   ```bash
   psql $DATABASE_URL -f migrations/add_earnings_calendar.sql
   ```

2. **Test earnings scraper** with a few stocks:
   ```javascript
   import { updateAllEarnings } from './src/earnings.js';
   await updateAllEarnings();
   ```

3. **Integrate into Opus prompts** - Include earnings dates when analyzing stocks

4. **Add to UI** - Display earnings dates in watchlist view

## Files Changed
- ✅ `src/earnings.js` (created)
- ✅ `src/db.js` (updated)
- ✅ `src/index.js` (updated)
- ✅ `src/dashboard.js` (updated)
- ✅ `migrations/add_earnings_calendar.sql` (created)

## Testing
```bash
# Test scraper with one stock
node -e "import('./src/earnings.js').then(m => m.scrapeEarningsDate('AAPL').then(console.log))"

# Run full update (takes ~40 seconds)
node -e "import('./src/earnings.js').then(m => m.updateAllEarnings())"
```

Ready to deploy!
