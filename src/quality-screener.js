import tradier from './tradier.js';
import * as db from './db.js';

/**
 * Quality Watchlist Manager
 * Manages quality stock watchlist for dip-buying opportunities
 *
 * NOTE: Opus decides which stocks are "quality" during weekly review
 * This module just manages the watchlist and checks for dip opportunities
 */

class QualityScreener {
  constructor() {
    // Opus will decide spread limits per trade (0.5% or 1.0%)
    // These are just reference thresholds for dip detection
    this.DIP_THRESHOLD = 0.07; // 7% below 52-week high
    this.CAPITULATION_THRESHOLD = 0.03; // 3% down day
    this.VOLUME_SURGE = 1.5; // 1.5x volume on capitulation
  }

  /**
   * Get market data for stock (used by Opus for quality analysis)
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

    const dipFromHigh = high52w > 0 ? (high52w - price) / high52w : 0;
    const spread = (ask && bid && price) ? (ask - bid) / price : 0;
    const volumeSurge = avgVolume > 0 ? volume / avgVolume : 0;

    return {
      symbol,
      price,
      high52w,
      dipFromHigh: (dipFromHigh * 100).toFixed(1),
      change,
      volume,
      avgVolume,
      volumeSurge: volumeSurge.toFixed(1),
      spread: (spread * 100).toFixed(2),
      bid,
      ask
    };
  }

  /**
   * Daily dip check - run at 10am/2pm
   * Returns watchlist stocks with current market data for Opus analysis
   * Opus decides: spread limits, entry timing, position sizing
   */
  async checkQualityDips() {
    console.log('\n💎 Checking quality watchlist for dip opportunities...');

    // Get active watchlist stocks
    const result = await db.query(
      `SELECT symbol, quality_score, metrics, reasons, target_entry_price, current_price
       FROM quality_watchlist
       WHERE status = 'active' AND position_entered = FALSE`
    );

    const watchlist = result.rows;
    if (watchlist.length === 0) {
      console.log('   No active quality stocks on watchlist');
      return [];
    }

    console.log(`   Monitoring ${watchlist.length} quality stocks...`);

    const opportunities = [];

    for (const stock of watchlist) {
      try {
        const marketData = await this.getStockData(stock.symbol);
        if (!marketData) continue;

        // Update current price
        await db.query(
          `UPDATE quality_watchlist
           SET current_price = $1, last_price_check = CURRENT_TIMESTAMP
           WHERE symbol = $2`,
          [marketData.price, stock.symbol]
        );

        // Package data for Opus analysis
        opportunities.push({
          symbol: stock.symbol,
          qualityScore: stock.quality_score,
          savedReasons: stock.reasons,
          targetEntry: stock.target_entry_price,
          ...marketData
        });

        console.log(`   📊 ${stock.symbol}: $${marketData.price} (${marketData.dipFromHigh}% from high, spread: ${marketData.spread}%)`);

      } catch (error) {
        console.warn(`   ⚠️ Error checking ${stock.symbol}:`, error.message);
      }
    }

    console.log(`   ✅ Prepared ${opportunities.length} quality stocks for Opus analysis`);
    return opportunities;
  }

  /**
   * Mark position as entered (called after Opus executes trade)
   */
  async markPositionEntered(symbol) {
    await db.query(
      `UPDATE quality_watchlist
       SET position_entered = TRUE, position_entry_date = CURRENT_TIMESTAMP
       WHERE symbol = $1`,
      [symbol]
    );
  }
}

export default new QualityScreener();
