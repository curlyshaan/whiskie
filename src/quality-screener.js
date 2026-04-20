import fmp from './fmp.js';
import * as db from './db.js';
import email from './email.js';
import tradier from './tradier.js';
import { resolveMarketPrice } from './utils.js';

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
    const quote = await fmp.getQuote(symbol);
    if (!quote) return null;

    const marketOpen = await tradier.isMarketOpen().catch(() => false);
    const price = resolveMarketPrice(quote, { marketOpen, fallback: 0 });
    const high52w = quote.yearHigh || 0;
    const change = quote.changePercentage || 0;
    const volume = quote.volume || 0;
    const avgVolume = quote.averageVolume || 0;
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
    console.log('\n💎 Checking saturday watchlist for dip opportunities...');

    // Get active long candidates from saturday watchlist
    const result = await db.query(
      `SELECT DISTINCT ON (symbol) symbol, intent,
              COALESCE(primary_pathway, pathway) AS pathway,
              secondary_pathways,
              score, metrics, reasons, price
       FROM saturday_watchlist
       WHERE status = 'active' AND intent = 'LONG' AND position_entered = FALSE`
    );

    const watchlist = result.rows;
    if (watchlist.length === 0) {
      console.log('   No active long candidates on saturday watchlist');
      return [];
    }

    console.log(`   Monitoring ${watchlist.length} long candidates...`);

    const opportunities = [];
    let errors = 0;

    for (const stock of watchlist) {
      try {
        const marketData = await this.getStockData(stock.symbol);
        if (!marketData) continue;

        // Update current price
        await db.query(
          `UPDATE saturday_watchlist
           SET price = $1, last_reviewed = CURRENT_TIMESTAMP
           WHERE symbol = $2`,
          [marketData.price, stock.symbol]
        );

        // Package data for Opus analysis
        opportunities.push({
          symbol: stock.symbol,
          pathway: stock.pathway,
          secondaryPathways: stock.secondary_pathways || [],
          score: stock.score,
          savedReasons: stock.reasons,
          targetEntry: stock.price,
          ...marketData
        });

        console.log(`   📊 ${stock.symbol} (${stock.pathway}${stock.secondary_pathways?.length ? ` | secondary: ${stock.secondary_pathways.join(',')}` : ''}): $${marketData.price} (${marketData.dipFromHigh}% from high, spread: ${marketData.spread}%)`);

      } catch (error) {
        console.warn(`   ⚠️ Error checking ${stock.symbol}:`, error.message);
        errors++;
      }
    }

    console.log(`   ✅ Prepared ${opportunities.length} long candidates for Opus analysis`);

    // Alert if high error rate (>10%)
    const errorRate = errors / watchlist.length;
    if (errorRate > 0.10) {
      console.error(`   ⚠️ HIGH ERROR RATE: ${(errorRate * 100).toFixed(1)}% of watchlist stocks failed`);
      await email.sendEmail(
        email.alertEmail,
        'Whiskie Alert: High Error Rate in Quality Screening',
        `Quality screening completed with ${errors} errors out of ${watchlist.length} stocks (${(errorRate * 100).toFixed(1)}%).\n\nThis may indicate API issues or data quality problems.`
      );
    }

    return opportunities;
  }

  /**
   * Mark position as entered (called after Opus executes trade)
   */
  async markPositionEntered(symbol, pathway) {
    await db.query(
      `UPDATE saturday_watchlist
       SET position_entered = TRUE, position_entry_date = CURRENT_TIMESTAMP
       WHERE symbol = $1`,
      [symbol]
    );
  }
}

export default new QualityScreener();
