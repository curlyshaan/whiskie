import fmp from '../src/fmp.js';
import * as db from '../src/db.js';

/**
 * Refresh earnings calendar from FMP
 * Only fetches for stocks in our universe and persists a durable window
 */

async function refreshEarningsCalendar() {
  console.log('📅 Refreshing earnings calendar from FMP...');

  try {
    // Get all symbols from our universe
    const universeResult = await db.query(
      `SELECT symbol
       FROM stock_universe
       WHERE status = $1
         AND COALESCE(earnings_tracking_eligible, TRUE) = TRUE
         AND COALESCE(market_cap, 0) >= $2`,
      ['active', 10000000000]
    );

    const eligibleSymbols = new Set(universeResult.rows.map(row => row.symbol));
    console.log(`   Found ${eligibleSymbols.size} stocks in universe`);

    let totalInserted = 0;
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const fourteenDaysAhead = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const fromDate = threeDaysAgo.toISOString().split('T')[0];
    const toDate = fourteenDaysAhead.toISOString().split('T')[0];

    console.log('   Fetching earnings calendar window from FMP...');
    console.log(`   Window: 3 days ago to 14 days ahead`);
    console.log(`   Range: ${fromDate} -> ${toDate}`);

    console.log('   Fetching symbol-specific earnings from FMP...');
    let processedSymbols = 0;

    for (const symbol of eligibleSymbols) {
      try {
        const earnings = await fmp.getEarningsBySymbol(symbol);
        if (!Array.isArray(earnings) || earnings.length === 0) {
          processedSymbols++;
          continue;
        }

        const relevantRows = earnings.filter(earning => {
          if (!earning?.date) return false;
          return earning.date >= fromDate && earning.date <= toDate;
        });

        for (const earning of relevantRows) {
          const earningsTime = typeof earning.time === 'string' && earning.time.trim()
            ? earning.time.trim().toLowerCase()
            : 'unknown';
          const timingRaw = earningsTime === 'unknown' ? null : earningsTime;
          const sessionNormalized = earningsTime === 'bmo'
            ? 'pre_market'
            : earningsTime === 'amc'
              ? 'post_market'
              : 'unknown';
          await db.query(
            `INSERT INTO earnings_calendar (
               symbol, earnings_date, earnings_time, source, source_primary,
               timing_raw, timing_source, session_normalized, source_priority,
               last_updated, last_verified_at, manual_override
             )
             VALUES (
               $1, $2, $3, 'fmp', 'fmp',
               $4, 'fmp', $5,
               100,
               NOW(),
               NOW(),
               FALSE
             )
             ON CONFLICT (symbol, earnings_date) DO UPDATE SET
               earnings_time = CASE
                 WHEN earnings_calendar.manual_override THEN earnings_calendar.earnings_time
                 ELSE $3
               END,
               source = CASE
                 WHEN earnings_calendar.manual_override THEN earnings_calendar.source
                 ELSE 'fmp'
               END,
               source_primary = 'fmp',
               timing_raw = CASE
                 WHEN earnings_calendar.manual_override THEN earnings_calendar.timing_raw
                 ELSE $4
               END,
               timing_source = CASE
                 WHEN earnings_calendar.manual_override THEN earnings_calendar.timing_source
                 ELSE 'fmp'
               END,
               session_normalized = CASE
                 WHEN earnings_calendar.manual_override THEN earnings_calendar.session_normalized
                 ELSE $5
               END,
               source_priority = CASE
                 WHEN earnings_calendar.manual_override THEN earnings_calendar.source_priority
                 ELSE 100
               END,
               last_updated = NOW(),
               last_verified_at = NOW()`,
            [symbol, earning.date, earningsTime, timingRaw, sessionNormalized]
          );
          totalInserted++;
        }

        processedSymbols++;
        if (processedSymbols % 25 === 0) {
          console.log(`   Processed ${processedSymbols}/${eligibleSymbols.size} symbols...`);
        }
      } catch (err) {
        console.warn(`   ⚠️ Error fetching/persisting earnings for ${symbol}: ${err.message}`);
      }
    }

    console.log(`   ✅ Processed ${processedSymbols} symbols and inserted/updated ${totalInserted} earnings events`);
    process.exit(0);

  } catch (error) {
    console.error('❌ Error refreshing earnings calendar:', error);
    process.exit(1);
  }
}

refreshEarningsCalendar();
