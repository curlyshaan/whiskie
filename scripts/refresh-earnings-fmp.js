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
      'SELECT symbol FROM stock_universe WHERE status = $1 AND COALESCE(earnings_tracking_eligible, TRUE) = TRUE',
      ['active']
    );

    const symbols = universeResult.rows.map(row => row.symbol);
    console.log(`   Found ${symbols.length} stocks in universe`);

    let totalInserted = 0;
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const fourteenDaysAhead = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    console.log(`   Fetching earnings for ${symbols.length} stocks...`);
    console.log(`   Window: 3 days ago to 14 days ahead`);

    for (const symbol of symbols) {
      try {
        const response = await fetch(
          `https://financialmodelingprep.com/stable/earnings?symbol=${symbol}&apikey=${process.env.FMP_API_KEY_1}`
        );
        const earnings = await response.json();

        if (Array.isArray(earnings) && earnings.length > 0) {
          for (const earning of earnings) {
            if (!earning.date) continue;

            const earningDate = new Date(earning.date);

            // Include earnings within 3 days ago to 14 days ahead window
            const isInWindow = earningDate >= threeDaysAgo && earningDate <= fourteenDaysAhead;

            if (isInWindow) {
              try {
                await db.query(
                  `INSERT INTO earnings_calendar (
                     symbol, earnings_date, earnings_time, source, source_primary,
                     timing_raw, timing_source, session_normalized, source_priority,
                     last_updated, last_verified_at, manual_override
                   )
                   VALUES (
                     $1, $2, $3, 'fmp', 'fmp',
                     $3, 'fmp',
                     CASE
                       WHEN LOWER(COALESCE($3, '')) = 'bmo' THEN 'pre_market'
                       WHEN LOWER(COALESCE($3, '')) = 'amc' THEN 'post_market'
                       ELSE 'unknown'
                     END,
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
                       ELSE $3
                     END,
                     timing_source = CASE
                       WHEN earnings_calendar.manual_override THEN earnings_calendar.timing_source
                       ELSE 'fmp'
                     END,
                     session_normalized = CASE
                       WHEN earnings_calendar.manual_override THEN earnings_calendar.session_normalized
                       WHEN LOWER(COALESCE($3, '')) = 'bmo' THEN 'pre_market'
                       WHEN LOWER(COALESCE($3, '')) = 'amc' THEN 'post_market'
                       ELSE 'unknown'
                     END,
                     source_priority = CASE
                       WHEN earnings_calendar.manual_override THEN earnings_calendar.source_priority
                       ELSE 100
                     END,
                     last_updated = NOW(),
                     last_verified_at = NOW()`,
                  [symbol, earning.date, earning.time || null]
                );
                totalInserted++;
              } catch (err) {
                // Skip duplicates
              }
            }
          }
        }

        // Rate limit: 500ms delay between calls
        await new Promise(resolve => setTimeout(resolve, 500));

        if ((symbols.indexOf(symbol) + 1) % 50 === 0) {
          console.log(`   Progress: ${symbols.indexOf(symbol) + 1}/${symbols.length} stocks`);
        }
      } catch (err) {
        console.warn(`   ⚠️ Error fetching ${symbol}: ${err.message}`);
      }
    }

    await db.query(
      `DELETE FROM earnings_calendar
       WHERE earnings_date < CURRENT_DATE - INTERVAL '3 days'
          OR earnings_date > CURRENT_DATE + INTERVAL '14 days'`
    );

    console.log(`   ✅ Inserted/updated ${totalInserted} earnings events (durable window: -3d to +14d)`);
    process.exit(0);

  } catch (error) {
    console.error('❌ Error refreshing earnings calendar:', error);
    process.exit(1);
  }
}

refreshEarningsCalendar();
