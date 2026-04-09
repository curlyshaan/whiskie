import tradier from './tradier.js';
import * as db from './db.js';
import yahooFinance from './yahoo-finance.js';

/**
 * Overvalued Watchlist Manager
 * Manages overvalued stock watchlist for short opportunities
 *
 * NOTE: Opus decides which stocks are "overvalued" during weekly review
 * This module manages the watchlist and checks for breakdown triggers
 *
 * Key differences from momentum shorts:
 * - Longer-term positions (weeks/months vs days)
 * - Fundamental overvaluation + technical breakdown
 * - More selective (avoid meme stocks, high IV, squeeze risk)
 */

class OvervaluedScreener {
  constructor() {
    // Reference thresholds - Opus decides actual spread limits per trade
    this.BREAKDOWN_THRESHOLD = 0.03; // 3% down day
    this.VOLUME_SURGE = 1.5; // 1.5x volume on breakdown
  }

  /**
   * Get market data for stock (used by Opus for overvalued analysis)
   */
  async getStockData(symbol) {
    const quote = await tradier.getQuote(symbol);
    if (!quote) return null;

    const price = quote.last || quote.close;
    const high52w = quote.week_52_high || 0;
    const change = quote.change_percentage || 0;
    const volume = quote.volume || 0;
    const avgVolume = quote.average_volume || 0;
    const bid = quote.bid || 0;
    const ask = quote.ask || 0;

    const extendedFromHigh = high52w > 0 ? (price - high52w) / high52w : 0;
    const spread = (ask && bid && price) ? (ask - bid) / price : 0;
    const volumeSurge = avgVolume > 0 ? volume / avgVolume : 0;

    // Get short squeeze risk data
    // NOTE: Yahoo Finance API currently returning 401 errors
    // Relying on ETB verification + IV filter (80% max) in short-manager.js
    // to avoid meme stocks. IV filter is effective since meme stocks typically
    // have 100%+ IV. Short interest data would be nice-to-have but not critical.
    let shortData = null;
    try {
      const shortStats = await yahooFinance.getShortInterest(symbol);
      if (shortStats) {
        shortData = {
          shortFloat: shortStats.shortPercentOfFloat || 0,
          daysToCover: shortStats.shortRatio || 0
        };
      }
    } catch (error) {
      // Non-blocking - short interest data unavailable but not critical
      // ETB + IV filters provide adequate meme stock protection
    }

    return {
      symbol,
      price,
      high52w,
      extendedFromHigh: (extendedFromHigh * 100).toFixed(1),
      change,
      volume,
      avgVolume,
      volumeSurge: volumeSurge.toFixed(1),
      spread: (spread * 100).toFixed(2),
      bid,
      ask,
      shortData
    };
  }

  /**
   * Daily breakdown check - run at 10am/2pm
   * Returns watchlist stocks with current market data for Opus analysis
   * Opus decides: spread limits, entry timing, position sizing, short eligibility
   */
  async checkOvervaluedBreakdowns() {
    console.log('\n📉 Checking overvalued watchlist for breakdown opportunities...');

    // Get active watchlist stocks
    const result = await db.query(
      `SELECT symbol, overvalued_score, metrics, reasons, target_entry_price, current_price
       FROM overvalued_watchlist
       WHERE status = 'active' AND position_entered = FALSE`
    );

    const watchlist = result.rows;
    if (watchlist.length === 0) {
      console.log('   No active overvalued stocks on watchlist');
      return [];
    }

    console.log(`   Monitoring ${watchlist.length} overvalued stocks...`);

    const opportunities = [];

    for (const stock of watchlist) {
      try {
        const marketData = await this.getStockData(stock.symbol);
        if (!marketData) continue;

        // Update current price
        await db.query(
          `UPDATE overvalued_watchlist
           SET current_price = $1, last_price_check = CURRENT_TIMESTAMP
           WHERE symbol = $2`,
          [marketData.price, stock.symbol]
        );

        // Package data for Opus analysis
        opportunities.push({
          symbol: stock.symbol,
          overvaluedScore: stock.overvalued_score,
          savedReasons: stock.reasons,
          targetEntry: stock.target_entry_price,
          ...marketData
        });

        console.log(`   📊 ${stock.symbol}: $${marketData.price} (${marketData.change}% today, spread: ${marketData.spread}%)`);

      } catch (error) {
        console.warn(`   ⚠️ Error checking ${stock.symbol}:`, error.message);
      }
    }

    console.log(`   ✅ Prepared ${opportunities.length} overvalued stocks for Opus analysis`);
    return opportunities;
  }

  /**
   * Mark position as entered (called after Opus executes short)
   */
  async markPositionEntered(symbol) {
    await db.query(
      `UPDATE overvalued_watchlist
       SET position_entered = TRUE, position_entry_date = CURRENT_TIMESTAMP
       WHERE symbol = $1`,
      [symbol]
    );
  }
}

export default new OvervaluedScreener();
