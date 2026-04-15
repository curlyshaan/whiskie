import fmp from '../src/fmp.js';
import * as db from '../src/db.js';

/**
 * Refresh earnings calendar from FMP
 * Only fetches for stocks in our universe (370 stocks)
 */

async function refreshEarningsCalendar() {
  console.log('📅 Refreshing earnings calendar from FMP...');

  try {
    // Get all symbols from our universe
    const universeResult = await db.query(
      'SELECT symbol FROM stock_universe WHERE status = $1',
      ['active']
    );

    const symbols = universeResult.rows.map(row => row.symbol);
    console.log(`   Found ${symbols.length} stocks in universe`);

    let totalInserted = 0;
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    console.log(`   Fetching earnings for ${symbols.length} stocks...`);

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

            // Include if:
            // 1. Upcoming (epsActual is null AND date is future)
            // 2. Recent past (date within last 90 days)
            const isUpcoming = earning.epsActual === null && earningDate > now;
            const isRecentPast = earningDate >= ninetyDaysAgo && earningDate <= now;

            if (isUpcoming || isRecentPast) {
              try {
                await db.query(
                  `INSERT INTO earnings_calendar (symbol, earnings_date, earnings_time, source, last_updated)
                   VALUES ($1, $2, $3, 'fmp', NOW())
                   ON CONFLICT (symbol, earnings_date) DO UPDATE SET
                     earnings_time = $3,
                     last_updated = NOW()`,
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

    console.log(`   ✅ Inserted/updated ${totalInserted} earnings events (upcoming + recent past 90 days)`);
    process.exit(0);

  } catch (error) {
    console.error('❌ Error refreshing earnings calendar:', error);
    process.exit(1);
  }
}

refreshEarningsCalendar();
