import fmpCache from './fmp-cache.js';
import tradier from './tradier.js';
import claude from './claude.js';
import * as db from './db.js';
import assetClassData from './asset-class-data.js';
import yahooPython from './yahoo-python-client.js';
import advancedFMPScreener from './advanced-fmp-screener.js';

/**
 * Opus-Driven Screener for Quality and Overvalued Stocks
 *
 * Runs weekly (Sunday) to identify:
 * 1. Quality stocks - High-quality companies for dip-buying
 * 2. Overvalued/Broken stocks - Short candidates with deteriorating fundamentals
 *
 * Uses FMP fundamental data + Opus analysis to populate watchlists
 */

class OpusScreener {
  constructor() {
    this.QUALITY_WATCHLIST_SIZE = 15;
    this.OVERVALUED_WATCHLIST_SIZE = 15;
  }

  /**
   * Run weekly Opus screening for quality and overvalued stocks
   * Called during Sunday weekly review
   */
  async runWeeklyOpusScreening() {
    console.log('\n🧠 Running Opus-driven quality and overvalued screening...');
    const startTime = Date.now();

    try {
      // Get all stocks from asset classes
      const allStocks = this.getAllStocks();
      console.log(`   Analyzing ${allStocks.length} stocks with Opus...`);

      // Fetch fundamental data using FMP paid API
      console.log('   📊 Fetching fundamental data from FMP...');
      const fundamentalsData = {};
      let fmpCount = 0;
      let cachedCount = 0;

      for (const stock of allStocks) {
        // Try cache first
        let data = await fmpCache.getCached(stock.symbol);

        if (data) {
          cachedCount++;
        } else {
          // Fetch from FMP paid API
          data = await fmpCache.getFundamentals(stock.symbol);
          if (data) {
            fmpCount++;
          }
        }

        if (data) {
          fundamentalsData[stock.symbol] = data;
        }
      }

      console.log(`   ✅ Loaded ${Object.keys(fundamentalsData).length} stocks (${cachedCount} cached, ${fmpCount} from FMP)`);

      // Get current market prices
      console.log('   📈 Fetching current market prices...');
      const symbols = Object.keys(fundamentalsData);
      const quotes = await tradier.getQuotes(symbols);
      const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

      const marketData = {};
      quotesArray.forEach(q => {
        if (q && q.symbol) {
          marketData[q.symbol] = {
            price: q.last || q.close,
            high52w: q.week_52_high,
            change: q.change_percentage || 0,
            volume: q.volume,
            avgVolume: q.average_volume
          };
        }
      });

      console.log(`   ✅ Loaded ${Object.keys(marketData).length} market quotes`);

      // Build comprehensive dataset for Opus
      const stocksForAnalysis = [];
      for (const symbol of symbols) {
        if (fundamentalsData[symbol] && marketData[symbol]) {
          stocksForAnalysis.push({
            symbol,
            fundamentals: fundamentalsData[symbol],
            market: marketData[symbol],
            insiderTrading: insiderData[symbol] || null
          });
        }
      }

      console.log(`   📊 Prepared ${stocksForAnalysis.length} stocks for Opus analysis`);

      // Ask Opus to identify quality and overvalued stocks
      const analysis = await this.askOpusToScreen(stocksForAnalysis);

      // Parse Opus recommendations
      const { qualityStocks, overvaluedStocks } = this.parseOpusRecommendations(analysis);

      console.log(`   ✅ Opus identified ${qualityStocks.length} quality stocks and ${overvaluedStocks.length} overvalued stocks`);

      // Update watchlists
      await this.updateQualityWatchlist(qualityStocks);
      await this.updateOvervaluedWatchlist(overvaluedStocks);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`   ✅ Opus screening complete (${duration}s)`);

      return { qualityStocks, overvaluedStocks };

    } catch (error) {
      console.error('❌ Error in Opus screening:', error);
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
   * Ask Opus to screen stocks for quality and overvalued candidates
   */
  async askOpusToScreen(stocks) {
    // Sample stocks for Opus (analyze top 100 by market cap to keep prompt manageable)
    const sortedStocks = stocks
      .filter(s => s.fundamentals.marketCap > 0)
      .sort((a, b) => b.fundamentals.marketCap - a.fundamentals.marketCap)
      .slice(0, 100);

    const prompt = `You are analyzing ${sortedStocks.length} stocks to identify:

1. **QUALITY STOCKS** (15 max) - High-quality companies for dip-buying opportunities
   - Strong fundamentals: High ROE (>15%), low debt/equity (<0.5), positive FCF
   - Consistent growth: Revenue growth >10%, earnings growth >10%
   - Market leaders: High operating margins (>15%), strong competitive moats
   - Currently trading below intrinsic value or near support levels

2. **OVERVALUED/BROKEN STOCKS** (15 max) - Short candidates with deteriorating fundamentals
   - Overvaluation: High P/E (>30), high PEG (>2), extended from fundamentals
   - Deteriorating metrics: Declining margins, rising debt, negative FCF
   - Broken growth: Negative revenue/earnings growth, contracting business
   - Technical weakness: Extended from highs, showing distribution

**Stock Data:**

${sortedStocks.map(s => {
  const insiderSignal = s.insiderTrading ? advancedFMPScreener.analyzeInsiderTrading(s.insiderTrading) : null;
  return `
${s.symbol} (${s.fundamentals.sector})
  Market Cap: $${(s.fundamentals.marketCap / 1e9).toFixed(1)}B
  Price: $${s.market.price} (52w high: $${s.market.high52w}, ${((s.market.price - s.market.high52w) / s.market.high52w * 100).toFixed(1)}% from high)
  P/E: ${s.fundamentals.peRatio.toFixed(1)}, PEG: ${s.fundamentals.pegRatio.toFixed(2)}
  Revenue Growth: ${(s.fundamentals.revenueGrowth * 100).toFixed(1)}%, Earnings Growth: ${(s.fundamentals.earningsGrowth * 100).toFixed(1)}%
  Debt/Equity: ${s.fundamentals.debtToEquity.toFixed(2)}, ROE: ${(s.fundamentals.roe * 100).toFixed(1)}%
  Operating Margin: ${(s.fundamentals.operatingMargin * 100).toFixed(1)}%, Net Margin: ${(s.fundamentals.profitMargin * 100).toFixed(1)}%
  FCF: $${(s.fundamentals.freeCashflow / 1e9).toFixed(2)}B
  Target Price: $${s.fundamentals.targetMeanPrice.toFixed(2)} (${s.fundamentals.numberOfAnalysts} analysts)${insiderSignal ? `\n  Insider Trading: ${insiderSignal.signal} - ${insiderSignal.reason}` : ''}
`;
}).join('\n')}

**Output Format (JSON):**

\`\`\`json
{
  "quality": [
    {
      "symbol": "AAPL",
      "score": 85,
      "reasons": "Market leader with 30% operating margin, 25% ROE, consistent 15% revenue growth, strong FCF generation",
      "targetEntry": 150.00,
      "keyMetrics": {
        "roe": 0.25,
        "operatingMargin": 0.30,
        "debtToEquity": 0.15,
        "revenueGrowth": 0.15
      }
    }
  ],
  "overvalued": [
    {
      "symbol": "XYZ",
      "score": 75,
      "reasons": "P/E 45x with declining margins (20% → 15%), negative FCF, debt rising 50% YoY, revenue growth slowing",
      "targetEntry": 80.00,
      "keyMetrics": {
        "peRatio": 45,
        "marginDecline": -0.05,
        "debtGrowth": 0.50,
        "fcf": -100000000
      }
    }
  ]
}
\`\`\`

Analyze the data and return your recommendations in the JSON format above.`;

    const response = await claude.analyze(prompt, {
      model: 'opus',
      extendedThinking: true,
      thinkingBudget: 10000
    });

    return response.analysis;
  }

  /**
   * Parse Opus recommendations from JSON
   */
  parseOpusRecommendations(analysis) {
    try {
      // Extract JSON from response
      const jsonMatch = analysis.match(/```json\n([\s\S]*?)\n```/);
      if (!jsonMatch) {
        console.warn('⚠️ No JSON found in Opus response');
        return { qualityStocks: [], overvaluedStocks: [] };
      }

      const data = JSON.parse(jsonMatch[1]);

      return {
        qualityStocks: data.quality || [],
        overvaluedStocks: data.overvalued || []
      };
    } catch (error) {
      console.error('❌ Error parsing Opus recommendations:', error);
      return { qualityStocks: [], overvaluedStocks: [] };
    }
  }

  /**
   * Update quality watchlist in database
   */
  async updateQualityWatchlist(stocks) {
    try {
      // Clear existing quality watchlist
      await db.query(`DELETE FROM quality_watchlist WHERE status = 'active'`);

      // Insert new quality stocks
      for (const stock of stocks) {
        await db.query(
          `INSERT INTO quality_watchlist
           (symbol, quality_score, metrics, reasons, target_entry_price, status, added_date)
           VALUES ($1, $2, $3, $4, $5, 'active', NOW())`,
          [
            stock.symbol,
            stock.score,
            JSON.stringify(stock.keyMetrics),
            stock.reasons,
            stock.targetEntry
          ]
        );
      }

      console.log(`   ✅ Quality watchlist updated with ${stocks.length} stocks`);
    } catch (error) {
      console.error('Error updating quality watchlist:', error);
      throw error;
    }
  }

  /**
   * Update overvalued watchlist in database
   */
  async updateOvervaluedWatchlist(stocks) {
    try {
      // Clear existing overvalued watchlist
      await db.query(`DELETE FROM overvalued_watchlist WHERE status = 'active'`);

      // Insert new overvalued stocks
      for (const stock of stocks) {
        await db.query(
          `INSERT INTO overvalued_watchlist
           (symbol, overvalued_score, metrics, reasons, target_entry_price, status, added_date)
           VALUES ($1, $2, $3, $4, $5, 'active', NOW())`,
          [
            stock.symbol,
            stock.score,
            JSON.stringify(stock.keyMetrics),
            stock.reasons,
            stock.targetEntry
          ]
        );
      }

      console.log(`   ✅ Overvalued watchlist updated with ${stocks.length} stocks`);
    } catch (error) {
      console.error('Error updating overvalued watchlist:', error);
      throw error;
    }
  }
}

export default new OpusScreener();
