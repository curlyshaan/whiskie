/**
 * Earnings Guard
 * Blocks trades 3 days before earnings to avoid event risk
 */

import * as db from './db.js';

class EarningsGuard {
  constructor() {
    this.BLOCK_DAYS_BEFORE = 3;
  }

  /**
   * Check if stock is within earnings blackout period
   */
  async isEarningsBlackout(symbol) {
    try {
      const result = await db.query(
        `SELECT earnings_date
         FROM earnings_calendar
         WHERE symbol = $1
         AND earnings_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${this.BLOCK_DAYS_BEFORE} days'
         ORDER BY earnings_date ASC
         LIMIT 1`,
        [symbol]
      );

      if (result.rows.length > 0) {
        const earningsDate = result.rows[0].earnings_date;
        const daysUntil = Math.ceil((new Date(earningsDate) - new Date()) / (1000 * 60 * 60 * 24));
        return {
          blocked: true,
          earningsDate,
          daysUntil,
          reason: `${symbol} earnings in ${daysUntil} day(s) on ${earningsDate} — too close to earnings, skip`
        };
      }

      return { blocked: false };
    } catch (error) {
      // Non-blocking - if earnings table doesn't exist, skip check
      console.warn(`⚠️ Could not check earnings for ${symbol}: ${error.message}`);
      return { blocked: false };
    }
  }

  /**
   * Check multiple symbols at once
   */
  async checkMultiple(symbols) {
    const results = {};
    for (const symbol of symbols) {
      results[symbol] = await this.isEarningsBlackout(symbol);
    }
    return results;
  }
}

export default new EarningsGuard();
