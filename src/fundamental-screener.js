import fmpCache from './fmp-cache.js';
import tradier from './tradier.js';
import * as db from './db.js';
import assetClassData from './asset-class-data.js';
import { getSectorConfig, normalizeSectorName } from './sector-config.js';

/**
 * Fundamental Screener
 * Weekly value screening to identify undervalued stocks with strong fundamentals
 * Uses sector-specific scoring for accurate valuation assessment
 *
 * Runs: Saturday 3pm (weekly automated scan)
 * Output: Value Watchlist (top 15 stocks)
 */

class FundamentalScreener {
  constructor() {
    this.MIN_DAILY_VOLUME = 5_000_000; // $5M absolute (not surge-based)
    this.VALUE_WATCHLIST_SIZE = 15;
  }

  /**
   * Run weekly fundamental screening (split across Saturday/Sunday)
   * Saturday: First half of stocks
   * Sunday: Second half of stocks
   * Returns top 15 value candidates
   */
  async runWeeklyScreen(part = 'full') {
    console.log(`\n💎 Running weekly fundamental screening (${part})...`);
    const startTime = Date.now();

    try {
      // Get all stocks from asset classes
      let allStocks = this.getAllStocks();

      // Split stocks for Saturday/Sunday to stay under 750 API calls/day
      if (part === 'saturday') {
        allStocks = allStocks.slice(0, Math.ceil(allStocks.length / 2));
        console.log(`   Screening first half: ${allStocks.length} stocks...`);
      } else if (part === 'sunday') {
        allStocks = allStocks.slice(Math.ceil(allStocks.length / 2));
        console.log(`   Screening second half: ${allStocks.length} stocks...`);
      } else {
        console.log(`   Screening ${allStocks.length} stocks...`);
      }

      const scoredStocks = [];
      let processed = 0;
      let errors = 0;

      // Screen each stock
      for (const stock of allStocks) {
        try {
          const score = await this.scoreStock(stock);
          if (score) {
            scoredStocks.push(score);
          }
          processed++;

          // Progress update every 50 stocks
          if (processed % 50 === 0) {
            console.log(`   Progress: ${processed}/${allStocks.length} stocks screened...`);
          }

          // Rate limiting (Yahoo Finance free tier)
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error) {
          errors++;
          if (errors <= 5) {
            console.warn(`   ⚠️ Error screening ${stock.symbol}:`, error.message);
          }
        }
      }

      // Sort by score and take top 15
      const topCandidates = scoredStocks
        .sort((a, b) => b.score - a.score)
        .slice(0, this.VALUE_WATCHLIST_SIZE);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`   ✅ Screening complete (${duration}s)`);
      console.log(`   Processed: ${processed} stocks`);
      console.log(`   Errors: ${errors} stocks`);
      console.log(`   Candidates found: ${scoredStocks.length}`);
      console.log(`   Top ${this.VALUE_WATCHLIST_SIZE} selected for Value Watchlist`);

      // Show FMP API usage stats
      const fmpStats = (await import('./fmp.js')).default.getUsageStats();
      console.log(`\n   📊 FMP API Usage:`);
      console.log(`      Total calls this session: ${fmpStats.calls}`);
      console.log(`      Rate limit: 300 calls/minute (no daily limit)`);

      // Show cache statistics with tier breakdown
      const cacheStats = await fmpCache.getCacheStats();
      console.log(`\n   💾 FMP Cache Stats (Tiered):`);
      console.log(`      TTM (1-day): ${cacheStats.TTM.valid} valid, ${cacheStats.TTM.expired} expired`);
      console.log(`      Quarterly (45-day): ${cacheStats.QUARTERLY.valid} valid, ${cacheStats.QUARTERLY.expired} expired`);
      console.log(`      Annual (90-day): ${cacheStats.ANNUAL.valid} valid, ${cacheStats.ANNUAL.expired} expired`);

      const totalValid = cacheStats.TTM.valid + cacheStats.QUARTERLY.valid + cacheStats.ANNUAL.valid;
      const cacheHitRate = allStocks.length > 0 ? ((totalValid / (allStocks.length * 3)) * 100).toFixed(1) : 0;
      console.log(`      Overall cache hit rate: ${cacheHitRate}%`);

      // Update Value Watchlist in database (only on Sunday or full run)
      if (part === 'sunday' || part === 'full') {
        await this.updateValueWatchlist(topCandidates);
      }

      return topCandidates;

    } catch (error) {
      console.error('❌ Error in fundamental screening:', error);

      // Send email alert for API errors
      const emailModule = await import('./email.js');
      await emailModule.default.sendErrorAlert(error, 'Fundamental screening failed');

      throw error;
    }
  }

  /**
   * Get all stocks from asset classes
   */
  getAllStocks() {
    const stocks = [];
    for (const [assetClass, symbols] of Object.entries(assetClassData.ASSET_CLASSES)) {
      for (const symbol of symbols) {
        stocks.push({ symbol, assetClass });
      }
    }
    return stocks;
  }

  /**
   * Score individual stock based on fundamentals
   * Uses sector-specific thresholds and weights
   * Returns: { symbol, score, metrics, reasons } or null
   */
  async scoreStock(stock) {
    try {
      // Fetch quote for volume check from Tradier
      const quote = await tradier.getQuote(stock.symbol);

      if (!quote) return null;

      // Volume filter: $5M absolute minimum (not surge-based)
      const price = quote.last || quote.close || 0;
      const volume = quote.average_volume || 0;
      const dollarVolume = volume * price;

      if (dollarVolume < this.MIN_DAILY_VOLUME) {
        return null; // Filter out low-volume stocks
      }

      // Fetch fundamental data from FMP (with caching)
      const fundamentals = await fmpCache.getFundamentals(stock.symbol);

      if (!fundamentals) return null;

      // Get sector-specific configuration
      const sector = normalizeSectorName(fundamentals.sector);
      const sectorConfig = getSectorConfig(sector);

      // Extract metrics
      const revenueGrowth = fundamentals.revenueGrowth || 0;
      const earningsGrowth = fundamentals.earningsGrowth || 0;
      const peRatio = fundamentals.peRatio || 0;
      const pegRatio = fundamentals.pegRatio || 0;
      const debtToEquity = fundamentals.debtToEquity || 0;
      const freeCashflow = fundamentals.freeCashflowPerShare || 0;
      const operatingMargins = fundamentals.operatingMargin || 0;

      // Calculate score using sector-specific weights (0-100)
      let score = 0;
      const reasons = [];

      // Revenue growth (sector-weighted)
      const revenueWeight = sectorConfig.weights.revenueGrowth;
      if (revenueGrowth >= sectorConfig.revenueGrowthMin * 1.5) {
        score += revenueWeight;
        reasons.push(`${(revenueGrowth * 100).toFixed(1)}% revenue growth (strong for ${sector})`);
      } else if (revenueGrowth >= sectorConfig.revenueGrowthMin) {
        score += revenueWeight * 0.6;
        reasons.push(`${(revenueGrowth * 100).toFixed(1)}% revenue growth`);
      }

      // Earnings growth (sector-weighted)
      const earningsWeight = sectorConfig.weights.earningsGrowth;
      if (earningsGrowth >= sectorConfig.earningsGrowthMin * 1.5) {
        score += earningsWeight;
        reasons.push(`${(earningsGrowth * 100).toFixed(1)}% earnings growth`);
      } else if (earningsGrowth >= sectorConfig.earningsGrowthMin) {
        score += earningsWeight * 0.5;
      }

      // Valuation - PEG ratio (sector-weighted)
      const valuationWeight = sectorConfig.weights.valuation;
      if (pegRatio > 0 && pegRatio <= sectorConfig.pegRange.ideal) {
        score += valuationWeight;
        reasons.push(`PEG ${pegRatio.toFixed(2)} (excellent for ${sector})`);
      } else if (pegRatio > 0 && pegRatio <= sectorConfig.pegRange.high) {
        score += valuationWeight * 0.5;
      }

      // Financial health - Debt/Equity (sector-weighted)
      const healthWeight = sectorConfig.weights.financialHealth;
      if (debtToEquity <= sectorConfig.debtToEquityMax * 0.5) {
        score += healthWeight;
        reasons.push(`Low debt ${(debtToEquity * 100).toFixed(0)}%`);
      } else if (debtToEquity <= sectorConfig.debtToEquityMax) {
        score += healthWeight * 0.5;
      }

      // Cash generation (sector-weighted)
      const cashWeight = sectorConfig.weights.cashGeneration;
      if (freeCashflow > 0) {
        score += cashWeight;
        reasons.push('Positive free cash flow');
      }

      // Operating efficiency (sector-weighted)
      const efficiencyWeight = sectorConfig.weights.operatingEfficiency;
      if (operatingMargins >= sectorConfig.operatingMarginMin * 1.5) {
        score += efficiencyWeight;
        reasons.push(`${(operatingMargins * 100).toFixed(1)}% operating margin`);
      } else if (operatingMargins >= sectorConfig.operatingMarginMin) {
        score += efficiencyWeight * 0.5;
      }

      // Minimum score threshold (40% of max possible)
      if (score < 40) return null;

      return {
        symbol: stock.symbol,
        assetClass: stock.assetClass,
        sector,
        score,
        metrics: {
          revenueGrowth: (revenueGrowth * 100).toFixed(1) + '%',
          earningsGrowth: (earningsGrowth * 100).toFixed(1) + '%',
          peRatio: peRatio.toFixed(2),
          pegRatio: pegRatio.toFixed(2),
          debtToEquity: debtToEquity.toFixed(2),
          freeCashflow: freeCashflow > 0 ? 'Positive' : 'Negative',
          operatingMargins: (operatingMargins * 100).toFixed(1) + '%',
          dollarVolume: '$' + (dollarVolume / 1e6).toFixed(1) + 'M'
        },
        reasons: reasons.join(', '),
        price: price.toFixed(2)
      };

    } catch (error) {
      // Silently skip stocks with missing data
      return null;
    }
  }

  /**
   * Update Value Watchlist in database
   */
  async updateValueWatchlist(candidates) {
    try {
      // Clear existing value watchlist
      await db.query(
        `DELETE FROM value_watchlist WHERE status = 'active'`
      );

      // Insert new candidates
      for (const candidate of candidates) {
        await db.query(
          `INSERT INTO value_watchlist
           (symbol, asset_class, score, metrics, reasons, price, status, added_date)
           VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())`,
          [
            candidate.symbol,
            candidate.assetClass,
            candidate.score,
            JSON.stringify(candidate.metrics),
            candidate.reasons,
            parseFloat(candidate.price)
          ]
        );
      }

      console.log(`   ✅ Value Watchlist updated with ${candidates.length} stocks`);

    } catch (error) {
      console.error('Error updating Value Watchlist:', error);
      throw error;
    }
  }

  /**
   * Get current Value Watchlist
   */
  async getValueWatchlist() {
    const result = await db.query(
      `SELECT * FROM value_watchlist
       WHERE status = 'active'
       ORDER BY score DESC`
    );
    return result.rows || [];
  }

  /**
   * Check if value watchlist stocks show momentum
   * Called during daily 10am/2pm analysis
   */
  async checkValueMomentum(marketData) {
    try {
      const valueWatchlist = await this.getValueWatchlist();
      const momentumTriggers = [];

      for (const stock of valueWatchlist) {
        const quote = marketData[stock.symbol];
        if (!quote) continue;

        const changePercent = quote.change_percentage || 0;
        const volumeSurge = this.calculateVolumeSurge(quote);

        // Momentum trigger: >5% move + 1.5x volume
        if (Math.abs(changePercent) >= 5 && volumeSurge >= 1.5) {
          momentumTriggers.push({
            symbol: stock.symbol,
            assetClass: stock.asset_class,
            score: stock.score,
            changePercent: changePercent.toFixed(1) + '%',
            volumeSurge: volumeSurge.toFixed(1) + 'x',
            trigger: 'VALUE_MOMENTUM_CONFIRMATION'
          });

          console.log(`   🎯 Value stock ${stock.symbol} showing momentum: ${changePercent.toFixed(1)}% + ${volumeSurge.toFixed(1)}x volume`);
        }
      }

      return momentumTriggers;

    } catch (error) {
      console.error('Error checking value momentum:', error);
      return [];
    }
  }

  /**
   * Calculate volume surge ratio
   */
  calculateVolumeSurge(quote) {
    const currentVolume = quote.volume || 0;
    const avgVolume = quote.averageDailyVolume10Day || 0;
    return avgVolume > 0 ? currentVolume / avgVolume : 0;
  }
}

export default new FundamentalScreener();
