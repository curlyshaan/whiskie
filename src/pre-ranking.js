import tradier from './tradier.js';
import * as db from './db.js';
import assetClassData from './asset-class-data.js';
import sectorRotation from './sector-rotation.js';

/**
 * Pre-Ranking Algorithm
 * Filters 425+ stocks down to 100-150 candidates before Opus Phase 1
 *
 * Scoring criteria:
 * - Volume surge (2x+ average)
 * - Price momentum (intraday change)
 * - Sector strength (relative to SPY)
 * - Technical signals (breakouts, breakdowns)
 */

class PreRanking {
  constructor() {
    this.MIN_VOLUME_SURGE = 1.5;  // 1.5x average volume
    this.TARGET_CANDIDATES = 120;  // Target 100-150 stocks
  }

  /**
   * Pre-rank all stocks and return top candidates
   * Returns: { longs: [], shorts: [], filtered: [] }
   */
  async rankStocks() {
    console.log('\n📊 Pre-ranking stock universe...');
    const startTime = Date.now();

    // Get active stocks from database (filtered by volume/spread/price)
    const activeStocks = await this.getActiveStocks();
    console.log(`   Active stocks: ${activeStocks.length}`);

    // Get sector rotation data
    const sectorStrength = await sectorRotation.analyzeSectorStrength();
    const sectorMap = this.buildSectorMap(sectorStrength);

    // Score all stocks
    const scoredStocks = [];
    for (const stock of activeStocks) {
      try {
        const score = await this.scoreStock(stock, sectorMap);
        if (score) {
          scoredStocks.push(score);
        }
      } catch (error) {
        console.warn(`   ⚠️ Error scoring ${stock.symbol}:`, error.message);
      }
    }

    // Sort by score and split into longs/shorts
    const longCandidates = scoredStocks
      .filter(s => s.direction === 'long')
      .sort((a, b) => b.score - a.score)
      .slice(0, 80);  // Top 80 long candidates

    const shortCandidates = scoredStocks
      .filter(s => s.direction === 'short')
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);  // Top 40 short candidates

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   ✅ Pre-ranking complete (${duration}s)`);
    console.log(`   Long candidates: ${longCandidates.length}`);
    console.log(`   Short candidates: ${shortCandidates.length}`);

    return {
      longs: longCandidates.map(s => s.symbol),
      shorts: shortCandidates.map(s => s.symbol),
      scored: scoredStocks.length
    };
  }

  /**
   * Get active stocks from database (passed volume/spread/price filters)
   */
  async getActiveStocks() {
    const result = await db.query(
      `SELECT symbol, sector, avg_daily_volume, last_price
       FROM stock_universe
       WHERE status = 'active'
       ORDER BY symbol`
    );
    return result.rows || [];
  }

  /**
   * Build sector strength map from sector rotation data
   */
  buildSectorMap(sectorStrength) {
    const map = {};
    if (sectorStrength && Array.isArray(sectorStrength)) {
      for (const sector of sectorStrength) {
        map[sector.sector] = {
          strength: sector.relativeStrength4w || 0,
          status: sector.status || 'NEUTRAL'
        };
      }
    }
    return map;
  }

  /**
   * Score individual stock
   * Returns: { symbol, score, direction, reasons }
   */
  async scoreStock(stock, sectorMap) {
    // Get real-time quote
    const quote = await tradier.getQuote(stock.symbol);
    if (!quote) return null;

    const price = quote.last || quote.close;
    const volume = quote.volume || 0;
    const change = quote.change_percentage || 0;
    const avgVolume = stock.avg_daily_volume / price; // Convert dollar volume to share volume

    // Calculate volume surge
    const volumeSurge = avgVolume > 0 ? volume / avgVolume : 0;

    // Get sector strength
    const sectorData = sectorMap[stock.sector] || { strength: 0, status: 'NEUTRAL' };

    // Calculate momentum score
    let score = 0;
    let direction = null;
    const reasons = [];

    // LONG SCORING
    if (change > 0) {
      // Positive momentum
      if (change >= 3) {
        score += 30;
        reasons.push(`+${change.toFixed(1)}% intraday`);
      } else if (change >= 1.5) {
        score += 20;
        reasons.push(`+${change.toFixed(1)}% momentum`);
      } else if (change >= 0.5) {
        score += 10;
      }

      // Volume surge
      if (volumeSurge >= 2.0) {
        score += 25;
        reasons.push(`${volumeSurge.toFixed(1)}x volume`);
      } else if (volumeSurge >= 1.5) {
        score += 15;
        reasons.push(`${volumeSurge.toFixed(1)}x volume`);
      }

      // Sector strength
      if (sectorData.status === 'LEADING') {
        score += 20;
        reasons.push('leading sector');
      } else if (sectorData.strength > 0) {
        score += 10;
      }

      direction = 'long';
    }

    // SHORT SCORING
    if (change < 0) {
      // Negative momentum
      if (change <= -3) {
        score += 30;
        reasons.push(`${change.toFixed(1)}% breakdown`);
      } else if (change <= -1.5) {
        score += 20;
        reasons.push(`${change.toFixed(1)}% weakness`);
      } else if (change <= -0.5) {
        score += 10;
      }

      // Volume on down days (selling pressure)
      if (volumeSurge >= 2.0) {
        score += 25;
        reasons.push(`${volumeSurge.toFixed(1)}x volume on decline`);
      } else if (volumeSurge >= 1.5) {
        score += 15;
      }

      // Sector weakness
      if (sectorData.status === 'LAGGING') {
        score += 20;
        reasons.push('lagging sector');
      } else if (sectorData.strength < 0) {
        score += 10;
      }

      direction = 'short';
    }

    // Minimum score threshold
    if (score < 15) return null;

    return {
      symbol: stock.symbol,
      score,
      direction,
      reasons: reasons.join(', '),
      price,
      change,
      volumeSurge: volumeSurge.toFixed(1)
    };
  }
}

export default new PreRanking();
