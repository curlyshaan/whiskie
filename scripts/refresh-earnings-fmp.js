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

    // Fetch earnings calendar from FMP (next 90 days)
    const response = await fetch(
      `https://financialmodelingprep.com/stable/earnings-calendar?apikey=${process.env.FMP_API_KEY_1}`
    );
    const allEarnings = await response.json();

    console.log(`   FMP returned ${allEarnings.length} total earnings events`);

    // Filter to only our universe stocks
    const ourEarnings = allEarnings.filter(event =>
      symbols.includes(event.symbol)
    );

    console.log(`   Filtered to ${ourEarnings.length} events for our universe`);

    // Insert/update earnings calendar
    let inserted = 0;
    for (const event of ourEarnings) {
      if (!event.symbol || !event.date) continue;

      try {
        await db.query(
          `INSERT INTO earnings_calendar (symbol, earnings_date, earnings_time, source, last_updated)
           VALUES ($1, $2, $3, 'fmp', NOW())
           ON CONFLICT (symbol, earnings_date) DO UPDATE SET
             earnings_time = $3,
             last_updated = NOW()`,
          [event.symbol, event.date, event.time || null]
        );
        inserted++;
      } catch (err) {
        console.warn(`   ⚠️ Error inserting ${event.symbol}: ${err.message}`);
      }
    }

    console.log(`   ✅ Inserted/updated ${inserted} earnings events`);
    process.exit(0);

  } catch (error) {
    console.error('❌ Error refreshing earnings calendar:', error);
    process.exit(1);
  }
}

refreshEarningsCalendar();
