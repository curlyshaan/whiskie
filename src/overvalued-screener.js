import fmp from './fmp.js';
import * as db from './db.js';

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
    const quote = await fmp.getQuote(symbol);
    if (!quote) return null;

    const price = quote.price || quote.previousClose || quote.close;
    const high52w = quote.yearHigh || 0;
    const change = quote.changePercentage || 0;
    const volume = quote.volume || 0;
    const avgVolume = quote.averageVolume || 0;
    const bid = quote.bid || 0;
    const ask = quote.ask || 0;

    const extendedFromHigh = high52w > 0 ? (price - high52w) / high52w : 0;
    const spread = (ask && bid && price) ? (ask - bid) / price : 0;
    const volumeSurge = avgVolume > 0 ? volume / avgVolume : 0;

    // Get short squeeze risk data
    // Short interest data not available from FMP
    // Relying on ETB verification + IV filter (80% max) in short-manager.js
    // to avoid meme stocks. IV filter is effective since meme stocks typically
    // have 100%+ IV.
    const shortData = null;

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
    console.log('\n📉 Checking saturday watchlist for breakdown opportunities...');

    // Get active short candidates from saturday watchlist
    const result = await db.query(
      `SELECT symbol, intent, pathway, score, metrics, reasons, price
       FROM saturday_watchlist
       WHERE status = 'active' AND intent = 'SHORT' AND position_entered = FALSE`
    );

    const watchlist = result.rows;
    if (watchlist.length === 0) {
      console.log('   No active short candidates on saturday watchlist');
      return [];
    }

    console.log(`   Monitoring ${watchlist.length} short candidates...`);

    const opportunities = [];

    for (const stock of watchlist) {
      try {
        const marketData = await this.getStockData(stock.symbol);
        if (!marketData) continue;

        // Update current price
        await db.query(
          `UPDATE saturday_watchlist
           SET price = $1, last_reviewed = CURRENT_TIMESTAMP
           WHERE symbol = $2 AND pathway = $3`,
          [marketData.price, stock.symbol, stock.pathway]
        );

        // Package data for Opus analysis
        opportunities.push({
          symbol: stock.symbol,
          pathway: stock.pathway,
          score: stock.score,
          savedReasons: stock.reasons,
          targetEntry: stock.price,
          ...marketData
        });

        console.log(`   📊 ${stock.symbol} (${stock.pathway}): $${marketData.price} (${marketData.change}% today, spread: ${marketData.spread}%)`);

      } catch (error) {
        console.warn(`   ⚠️ Error checking ${stock.symbol}:`, error.message);
      }
    }

    console.log(`   ✅ Prepared ${opportunities.length} short candidates for Opus analysis`);
    return opportunities;
  }

  /**
   * Mark position as entered (called after Opus executes short)
   */
  async markPositionEntered(symbol, pathway) {
    await db.query(
      `UPDATE saturday_watchlist
       SET position_entered = TRUE, position_entry_date = CURRENT_TIMESTAMP
       WHERE symbol = $1 AND pathway = $2`,
      [symbol, pathway]
    );
  }
}

export default new OvervaluedScreener();
