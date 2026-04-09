import yahooFinance from 'yahoo-finance2';
import * as db from './db.js';
import assetClassData from './asset-class-data.js';

/**
 * Fundamental Screener
 * Weekly value screening to identify undervalued stocks with strong fundamentals
 *
 * Runs: Sunday 9pm (weekly automated scan)
 * Output: Value Watchlist (top 15 stocks)
 * Deep-dive: Bi-weekly Opus analysis (1st and 3rd Sunday)
 */

class FundamentalScreener {
  constructor() {
    this.MIN_DAILY_VOLUME = 5_000_000; // $5M absolute (not surge-based)
    this.MIN_REVENUE_GROWTH = 0.15;    // 15% YoY
    this.MIN_EARNINGS_GROWTH = 0.10;   // 10% YoY
    this.MAX_PEG_RATIO = 1.5;
    this.MAX_DEBT_TO_EQUITY = 0.6;
    this.VALUE_WATCHLIST_SIZE = 15;
  }

  /**
   * Run weekly fundamental screening
   * Returns top 15 value candidates
   */
  async runWeeklyScreen() {
    console.log('\n💎 Running weekly fundamental screening...');
    const startTime = Date.now();

    try {
      // Get all stocks from asset classes
      const allStocks = this.getAllStocks();
      console.log(`   Screening ${allStocks.length} stocks...`);

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

      // Update Value Watchlist in database
      await this.updateValueWatchlist(topCandidates);

      return topCandidates;

    } catch (error) {
      console.error('❌ Error in fundamental screening:', error);
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
   * Returns: { symbol, score, metrics, reasons } or null
   */
  async scoreStock(stock) {
    try {
      // Fetch quote for volume check
      const quote = await yahooFinance.quote(stock.symbol);

      if (!quote) return null;

      // Volume filter: $5M absolute minimum (not surge-based)
      const price = quote.regularMarketPrice || 0;
      const volume = quote.averageDailyVolume10Day || 0;
      const dollarVolume = volume * price;

      if (dollarVolume < this.MIN_DAILY_VOLUME) {
        return null; // Filter out low-volume stocks
      }

      // Fetch fundamental data
      const quoteSummary = await yahooFinance.quoteSummary(stock.symbol, {
        modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail']
      });

      if (!quoteSummary) return null;

      const financials = quoteSummary.financialData || {};
      const keyStats = quoteSummary.defaultKeyStatistics || {};
      const summary = quoteSummary.summaryDetail || {};

      // Extract metrics
      const revenueGrowth = financials.revenueGrowth || 0;
      const earningsGrowth = financials.earningsGrowth || 0;
      const peRatio = summary.trailingPE || keyStats.trailingPE || 0;
      const pegRatio = keyStats.pegRatio || 0;
      const debtToEquity = financials.debtToEquity ? financials.debtToEquity / 100 : 0;
      const freeCashflow = financials.freeCashflow || 0;
      const operatingMargins = financials.operatingMargins || 0;

      // Calculate score (0-100)
      let score = 0;
      const reasons = [];

      // Revenue growth (0-25 points)
      if (revenueGrowth >= 0.20) {
        score += 25;
        reasons.push(`${(revenueGrowth * 100).toFixed(1)}% revenue growth`);
      } else if (revenueGrowth >= this.MIN_REVENUE_GROWTH) {
        score += 15;
        reasons.push(`${(revenueGrowth * 100).toFixed(1)}% revenue growth`);
      }

      // Earnings growth (0-20 points)
      if (earningsGrowth >= 0.15) {
        score += 20;
        reasons.push(`${(earningsGrowth * 100).toFixed(1)}% earnings growth`);
      } else if (earningsGrowth >= this.MIN_EARNINGS_GROWTH) {
        score += 10;
      }

      // Valuation - PEG ratio (0-20 points)
      if (pegRatio > 0 && pegRatio <= 1.0) {
        score += 20;
        reasons.push(`PEG ${pegRatio.toFixed(2)} (growth at reasonable price)`);
      } else if (pegRatio > 0 && pegRatio <= this.MAX_PEG_RATIO) {
        score += 10;
      }

      // Financial health - Debt/Equity (0-15 points)
      if (debtToEquity <= 0.3) {
        score += 15;
        reasons.push(`Low debt ${(debtToEquity * 100).toFixed(0)}%`);
      } else if (debtToEquity <= this.MAX_DEBT_TO_EQUITY) {
        score += 8;
      }

      // Cash generation (0-10 points)
      if (freeCashflow > 0) {
        score += 10;
        reasons.push('Positive free cash flow');
      }

      // Operating efficiency (0-10 points)
      if (operatingMargins >= 0.20) {
        score += 10;
        reasons.push(`${(operatingMargins * 100).toFixed(1)}% operating margin`);
      } else if (operatingMargins >= 0.10) {
        score += 5;
      }

      // Minimum score threshold
      if (score < 40) return null;

      return {
        symbol: stock.symbol,
        assetClass: stock.assetClass,
        score,
        metrics: {
          revenueGrowth: (revenueGrowth * 100).toFixed(1) + '%',
          earningsGrowth: (earningsGrowth * 100).toFixed(1) + '%',
          peRatio: peRatio.toFixed(2),
          pegRatio: pegRatio.toFixed(2),
          debtToEquity: (debtToEquity * 100).toFixed(0) + '%',
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
