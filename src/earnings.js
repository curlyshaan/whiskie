import axios from 'axios';
import * as cheerio from 'cheerio';
import * as db from './db.js';
import { getAllStocks } from './sub-industry-data.js';

/**
 * Yahoo Finance Earnings Scraper
 * Scrapes earnings dates for all 400 stocks
 */

/**
 * Scrape earnings date from Yahoo Finance
 */
async function scrapeEarningsDate(symbol) {
  try {
    const url = `https://finance.yahoo.com/quote/${symbol}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data);

    // Find earnings date in the page
    let earningsDate = null;
    let earningsTime = 'unknown';

    // Look for "Earnings Date" label
    $('td').each((i, elem) => {
      const text = $(elem).text().trim();
      if (text === 'Earnings Date') {
        const nextTd = $(elem).next('td');
        const dateText = nextTd.text().trim();

        if (dateText && dateText !== 'N/A') {
          // Parse date (could be range like "Jan 30 - Feb 3, 2024")
          earningsDate = parseDateText(dateText);

          // Check if BMO or AMC is mentioned
          if (dateText.toLowerCase().includes('bmo')) {
            earningsTime = 'bmo';
          } else if (dateText.toLowerCase().includes('amc')) {
            earningsTime = 'amc';
          }
        }
      }
    });

    return { symbol, earningsDate, earningsTime };
  } catch (error) {
    console.error(`Error scraping ${symbol}:`, error.message);
    return { symbol, earningsDate: null, earningsTime: 'unknown' };
  }
}

/**
 * Parse date text from Yahoo Finance
 * Handles formats like:
 * - "Jan 30, 2024"
 * - "Jan 30 - Feb 3, 2024" (takes first date)
 * - "Feb 3, 2024 BMO"
 */
function parseDateText(dateText) {
  try {
    // Remove BMO/AMC if present
    let cleanText = dateText.replace(/\s*(BMO|AMC)\s*/gi, '').trim();

    // If range, take first date
    if (cleanText.includes(' - ')) {
      cleanText = cleanText.split(' - ')[0].trim();
    }

    // Parse date
    const date = new Date(cleanText);

    // Validate date
    if (isNaN(date.getTime())) {
      return null;
    }

    // Return YYYY-MM-DD format
    return date.toISOString().split('T')[0];
  } catch (error) {
    console.error(`Error parsing date: ${dateText}`, error.message);
    return null;
  }
}

/**
 * Update earnings for all 400 stocks
 * Rate limited to 10 requests/sec
 */
export async function updateAllEarnings() {
  console.log('📅 Starting earnings update for all stocks...');

  const allStocks = getAllStocks();
  console.log(`Total stocks to update: ${allStocks.length}`);

  let successCount = 0;
  let failCount = 0;
  let foundCount = 0;

  for (let i = 0; i < allStocks.length; i++) {
    const symbol = allStocks[i];

    try {
      const result = await scrapeEarningsDate(symbol);

      if (result.earningsDate) {
        await db.upsertEarning(symbol, result.earningsDate, result.earningsTime);
        foundCount++;
        console.log(`✅ ${symbol}: ${result.earningsDate} (${result.earningsTime})`);
      } else {
        console.log(`⚠️ ${symbol}: No earnings date found`);
      }

      successCount++;

      // Rate limit: 10 requests/sec = 100ms delay
      await new Promise(resolve => setTimeout(resolve, 100));

      // Progress update every 50 stocks
      if ((i + 1) % 50 === 0) {
        console.log(`Progress: ${i + 1}/${allStocks.length} (${foundCount} earnings dates found)`);
      }

    } catch (error) {
      console.error(`❌ ${symbol}: ${error.message}`);
      failCount++;
    }
  }

  // Cleanup old earnings
  console.log('🧹 Cleaning up old earnings...');
  await db.cleanupOldEarnings();

  console.log('\n📊 Earnings Update Summary:');
  console.log(`Total stocks: ${allStocks.length}`);
  console.log(`Success: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Earnings dates found: ${foundCount}`);
  console.log(`✅ Earnings update complete!`);
}

/**
 * Get next earnings date for a symbol
 */
export async function getNextEarning(symbol) {
  return await db.getNextEarning(symbol);
}

/**
 * Get all upcoming earnings (next 30 days)
 */
export async function getUpcomingEarnings(days = 30) {
  return await db.getUpcomingEarnings(days);
}

export default {
  updateAllEarnings,
  getNextEarning,
  getUpcomingEarnings
};
