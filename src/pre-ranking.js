import fmp from './fmp.js';
import * as db from './db.js';
import sectorRotation from './sector-rotation.js';
import { getSectorConfig } from './sector-config.js';

/**
 * Pre-Ranking Algorithm
 * Filters FMP-based universe down to 100-150 candidates before Opus Phase 1
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
    this.MOMENTUM_BYPASS_PATHWAYS = new Set([
      'deepValue',
      'cashMachine',
      'qarp',
      'qualityCompounder'
    ]);
    this.SHORT_MOMENTUM_CONFIG = {
      deteriorating: {
        direction: 'negative',
        minMove: 0.02,
        minVolumeSurge: 1.5
      },
      overvalued: {
        direction: 'either',
        minMove: 0.02,
        minVolumeSurge: 1.5
      },
      overextended: {
        direction: 'positive',
        minMove: 0.03,
        minVolumeSurge: 2.0
      }
    };
  }

  /**
   * Pre-rank all stocks and return top candidates
   * Returns: { longs: [], shorts: [], filtered: [] }
   */
  async rankStocks() {
    console.log('\n📊 Pre-ranking stock universe...');
    const startTime = Date.now();

    // Get saturday_watchlist stocks (with pathway tags)
    const watchlistStocks = await this.getWatchlistStocks();
    console.log(`   Saturday watchlist: ${watchlistStocks.length} stocks`);

    // Get all stocks from FMP-based universe
    const allStocks = await this.getAllStocks();
    console.log(`   Total stocks: ${allStocks.length}`);

    // Merge watchlist stocks with universe stocks (watchlist takes priority)
    const watchlistSymbols = new Set(watchlistStocks.map(s => s.symbol));
    const mergedStocks = [
      ...watchlistStocks,
      ...allStocks.filter(s => !watchlistSymbols.has(s.symbol))
    ];
    console.log(`   Merged candidates: ${mergedStocks.length} (${watchlistStocks.length} from watchlist, ${mergedStocks.length - watchlistStocks.length} from universe)`);

    // Filter stocks with live spread/volume/price checks using batch quote fetching
    console.log(`   🔍 Starting live filtering with spread/volume/price checks...`);
    const filteredStocks = [];
    const failedStocks = { volume: [], spread: [], price: [], noQuote: [] };

    // Batch fetch all quotes at once (much faster than one-by-one)
    const symbols = mergedStocks.map(s => s.symbol);
    console.log(`   📡 Fetching ${symbols.length} quotes in batch...`);

    let quotes;
    try {
      quotes = await fmp.getQuotes(symbols);
      // Normalize to array if single quote returned
      if (!Array.isArray(quotes)) {
        quotes = [quotes];
      }
    } catch (error) {
      console.error(`   ❌ Batch quote fetch failed: ${error.message}`);
      return { longs: [], shorts: [], scored: 0 };
    }

    // Create quote lookup map
    const quoteMap = new Map();
    for (const quote of quotes) {
      if (quote && quote.symbol) {
        quoteMap.set(quote.symbol, quote);
      }
    }

    console.log(`   ✅ Fetched ${quoteMap.size} quotes`);

    // Filter stocks using batch-fetched quotes
    for (const stock of mergedStocks) {
      try {
        const quote = quoteMap.get(stock.symbol);
        if (!quote) {
          failedStocks.noQuote.push(stock.symbol);
          continue;
        }

        const price = quote.price || quote.previousClose || quote.close;
        const avgVolume = Math.round(quote.averageVolume || 0);
        const bid = quote.bid || 0;
        const ask = quote.ask || 0;
        const spread = (ask && bid && price) ? (ask - bid) / price : 0;
        const dollarVolume = Math.round(avgVolume * price);

        // Live filters
        const MIN_VOLUME = 50_000_000; // $50M
        const MAX_SPREAD = 0.005; // 0.5%
        const MIN_PRICE = 5.00;

        // Check each filter and log failures
        let passed = true;
        if (dollarVolume < MIN_VOLUME) {
          failedStocks.volume.push(`${stock.symbol} ($${(dollarVolume/1e6).toFixed(1)}M)`);
          passed = false;
        }
        if (spread > MAX_SPREAD) {
          failedStocks.spread.push(`${stock.symbol} (${(spread*100).toFixed(2)}%)`);
          passed = false;
        }
        if (price < MIN_PRICE) {
          failedStocks.price.push(`${stock.symbol} ($${price.toFixed(2)})`);
          passed = false;
        }

        if (passed) {
          filteredStocks.push({
            symbol: stock.symbol,
            sector: stock.sector,
            industry: stock.industry,
            price,
            avgVolume,
            spread,
            pathway: stock.pathway || null,  // Preserve pathway from watchlist
            watchlistScore: stock.score || null,
            source: stock.source
          });
        }
      } catch (error) {
        console.warn(`   ⚠️ Error filtering ${stock.symbol}:`, error.message);
      }
    }

    console.log(`\n   ✅ Live filtering complete: ${filteredStocks.length}/${allStocks.length} stocks passed`);
    console.log(`   📉 Filter breakdown:`);
    console.log(`      • Failed volume check: ${failedStocks.volume.length} stocks`);
    console.log(`      • Failed spread check: ${failedStocks.spread.length} stocks`);
    console.log(`      • Failed price check: ${failedStocks.price.length} stocks`);
    console.log(`      • No quote data: ${failedStocks.noQuote.length} stocks`);

    // Get earnings calendar and filter candidates
    console.log(`\n   📅 Fetching earnings calendar...`);
    const earningsCalendar = await fmp.getEarningsCalendar();
    const earningsMap = new Map();
    const today = new Date();

    for (const earning of earningsCalendar) {
      const earningDate = new Date(earning.date);
      const daysUntilEarnings = Math.floor((earningDate - today) / (1000 * 60 * 60 * 24));

      // Track earnings from -3 days (just reported) to +7 days (upcoming)
      if (daysUntilEarnings >= -3 && daysUntilEarnings <= 7) {
        earningsMap.set(earning.symbol, { date: earning.date, daysUntil: daysUntilEarnings });
      }
    }

    console.log(`   ✅ Found ${earningsMap.size} stocks with earnings in range (-3 to +7 days)`);
    console.log(`   💡 Stocks with earnings -1 to -3 days (just reported) are ALLOWED for post-earnings dip opportunities`);

    // Get sector rotation data
    const sectorStrength = await sectorRotation.analyzeSectorStrength();
    const sectorMap = this.buildSectorMap(sectorStrength);

    // Score all filtered stocks
    const scoredStocks = [];
    for (const stock of filteredStocks) {
      try {
        const score = await this.scoreStock(stock, sectorMap, earningsMap);
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
      longs: longCandidates.map(s => ({
        symbol: s.symbol,
        pathway: s.pathway || null,
        score: s.score,
        source: s.pathway ? 'watchlist' : 'momentum',
        sourceReasons: s.reasons,
        timestamp: new Date().toISOString()
      })),
      shorts: shortCandidates.map(s => ({
        symbol: s.symbol,
        pathway: s.pathway || null,
        score: s.score,
        source: s.pathway ? 'watchlist' : 'momentum',
        sourceReasons: s.reasons,
        timestamp: new Date().toISOString()
      })),
      scored: scoredStocks.length
    };
  }

  /**
   * Get saturday_watchlist stocks with pathway tags
   */
  async getWatchlistStocks() {
    const result = await db.query(
      `SELECT symbol, intent, pathway, sector, industry, score, price
       FROM saturday_watchlist
       WHERE status = $1
       ORDER BY score DESC`,
      ['active']
    );
    return result.rows.map(row => ({
      symbol: row.symbol,
      intent: row.intent,
      pathway: row.pathway,
      sector: row.sector,
      industry: row.industry,
      score: row.score,
      price: parseFloat(row.price),
      source: 'watchlist'
    }));
  }

  /**
   * Get all stocks from FMP-based universe
   */
  async getAllStocks() {
    const result = await db.query(
      'SELECT symbol, sector, industry FROM stock_universe WHERE status = $1 ORDER BY market_cap DESC',
      ['active']
    );
    return result.rows.map(row => ({
      symbol: row.symbol,
      sector: row.sector,
      industry: row.industry,
      source: 'universe'
    }));
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
   * Returns: { symbol, score, direction, reasons, earningsDate }
   */
  async scoreStock(stock, sectorMap, earningsMap) {
    // Get real-time quote
    const quote = await fmp.getQuote(stock.symbol);
    if (!quote) return null;

    const price = quote.price || quote.previousClose || quote.close;
    const volume = quote.volume || 0;
    const change = quote.changePercentage || 0;
    const avgVolume = stock.avgVolume; // Already calculated in filter step

    // Calculate volume surge
    const volumeSurge = avgVolume > 0 ? volume / avgVolume : 0;

    // Get sector strength
    const sectorData = sectorMap[stock.sector] || { strength: 0, status: 'NEUTRAL' };

    // Get sector-specific momentum thresholds
    const sectorConfig = getSectorConfig(stock.sector);
    const momentumThresholds = sectorConfig.momentum;
    const bypassMomentum = stock.source === 'watchlist' && this.MOMENTUM_BYPASS_PATHWAYS.has(stock.pathway);
    const shortMomentumConfig = this.SHORT_MOMENTUM_CONFIG[stock.pathway] || this.SHORT_MOMENTUM_CONFIG.overvalued;

    // Check earnings calendar
    const earningsInfo = earningsMap.get(stock.symbol);

    // Calculate momentum score
    let score = 0;
    let direction = null;
    const reasons = [];

    // LONG SCORING
    if (change > 0) {
      // Earnings filter for longs: exclude if earnings in next 3 days (imminent risk)
      // BUT allow stocks that reported 1-3 days ago (post-earnings dip opportunity)
      if (earningsInfo && earningsInfo.daysUntil >= 0 && earningsInfo.daysUntil <= 3) {
        console.log(`   ⚠️ ${stock.symbol} has earnings in ${earningsInfo.daysUntil} days - excluding from longs (imminent risk)`);
        return null;
      }
      // Note: Stocks with earnings -1 to -3 days (just reported) are ALLOWED
      // Tavily news in daily analysis will catch "good earnings but stock down" opportunities

      // Check if meets sector-adjusted momentum threshold
      const meetsThreshold = bypassMomentum || (
        Math.abs(change / 100) >= momentumThresholds.minMove &&
        volumeSurge >= momentumThresholds.minVolumeSurge
      );

      if (!meetsThreshold) {
        // Doesn't meet sector-specific momentum threshold
        return null;
      }

      if (bypassMomentum) {
        score += 12;
        reasons.push(`momentum bypass for ${stock.pathway}`);
      }

      // Positive momentum (sector-adjusted scoring)
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
      let meetsThreshold;
      if (shortMomentumConfig.direction === 'negative') {
        meetsThreshold = (change / 100) <= -shortMomentumConfig.minMove &&
          volumeSurge >= shortMomentumConfig.minVolumeSurge;
      } else if (shortMomentumConfig.direction === 'positive') {
        meetsThreshold = (change / 100) >= shortMomentumConfig.minMove &&
          volumeSurge >= shortMomentumConfig.minVolumeSurge;
      } else {
        meetsThreshold = Math.abs(change / 100) >= shortMomentumConfig.minMove &&
          volumeSurge >= shortMomentumConfig.minVolumeSurge;
      }

      if (!meetsThreshold) {
        // Doesn't meet sector-specific momentum threshold
        return null;
      }

      // Earnings boost for shorts: if earnings in next 3 days, boost score (IV spike opportunity)
      if (earningsInfo && earningsInfo.daysUntil <= 3) {
        score += 15;
        reasons.push(`earnings in ${earningsInfo.daysUntil} days (IV spike)`);
      }

      // Negative momentum (sector-adjusted scoring)
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

      reasons.push(`${stock.pathway || 'short'} momentum rule: ${shortMomentumConfig.direction}`);

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
      volumeSurge: volumeSurge.toFixed(1),
      pathway: stock.pathway || null,
      watchlistScore: stock.watchlistScore || null,
      earningsDate: earningsInfo ? earningsInfo.date : null,
      daysUntilEarnings: earningsInfo ? earningsInfo.daysUntil : null
    };
  }
}

export default new PreRanking();
