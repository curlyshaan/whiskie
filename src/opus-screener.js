import fmp from './fmp.js';
import tradier from './tradier.js';
import claude from './claude.js';
import * as db from './db.js';

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
    this.QUALITY_WATCHLIST_SIZE = 7;
    this.OVERVALUED_WATCHLIST_SIZE = 7;
  }

  /**
   * Run weekly Opus screening for quality and overvalued stocks
   * Called during Sunday weekly review
   *
   * NEW APPROACH: Analyzes fundamental screening results instead of raw universe
   * This leverages Saturday's fundamental screening work and provides better candidates
   */
  async runWeeklyOpusScreening() {
    console.log('\n🧠 Running Opus-driven quality and overvalued screening...');
    const startTime = Date.now();

    try {
      // Get top candidates from Saturday's fundamental screening
      const fundamentalCandidates = await this.getFundamentalCandidates();
      console.log(`   Analyzing ${fundamentalCandidates.length} pre-screened candidates with Opus...`);
      console.log(`   (${fundamentalCandidates.filter(c => c.intent === 'LONG').length} longs, ${fundamentalCandidates.filter(c => c.intent === 'SHORT').length} shorts)`);

      // Fetch fundamental data using FMP paid API
      console.log('   📊 Fetching fundamental data from FMP...');
      const fundamentalsData = {};
      let fmpCount = 0;
      const totalStocks = fundamentalCandidates.length;

      for (const stock of fundamentalCandidates) {
        // Fetch from FMP directly (no cache)
        const data = await fmp.getFundamentals(stock.symbol);

        if (data) {
          fmpCount++;
          fundamentalsData[stock.symbol] = data;
        }

        // Progress logging every 20 stocks
        if (fmpCount % 20 === 0) {
          console.log(`   Progress: ${fmpCount}/${totalStocks} stocks loaded`);
        }

        // 500ms delay to stay under 300 calls/minute (120 calls/min with 500ms delay)
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log(`   ✅ Loaded ${Object.keys(fundamentalsData).length} stocks (${fmpCount} from FMP)`);

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
      for (const candidate of fundamentalCandidates) {
        const symbol = candidate.symbol;
        if (fundamentalsData[symbol] && marketData[symbol]) {
          stocksForAnalysis.push({
            symbol,
            fundamentals: fundamentalsData[symbol],
            market: marketData[symbol],
            pathway: candidate.pathway,
            fundamentalScore: candidate.score,
            fundamentalReasons: candidate.reasons,
            intent: candidate.intent
          });
        }
      }

      console.log(`   📊 Prepared ${stocksForAnalysis.length} stocks for Opus analysis`);

      // Ask Opus to identify quality and overvalued stocks
      const analysis = await this.askOpusToScreen(stocksForAnalysis);

      // Parse Opus recommendations
      const { qualityStocks, overvaluedStocks } = this.parseOpusRecommendations(analysis);

      console.log(`   ✅ Opus identified ${qualityStocks.length} quality stocks and ${overvaluedStocks.length} overvalued stocks`);

      // Update saturday watchlist with both long and short candidates
      await this.updateSaturdayWatchlist(qualityStocks, overvaluedStocks);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`   ✅ Opus screening complete (${duration}s)`);

      return { qualityStocks, overvaluedStocks };

    } catch (error) {
      console.error('❌ Error in Opus screening:', error);
      throw error;
    }
  }

  /**
   * Get fundamental candidates from Saturday's screening
   * Returns top 50 longs + top 50 shorts from saturday_watchlist
   */
  async getFundamentalCandidates() {
    const result = await db.query(
      `SELECT symbol, intent, pathway, sector, industry, score, reasons
       FROM saturday_watchlist
       WHERE status = 'pending'
       ORDER BY score DESC
       LIMIT 100`,
      []
    );

    return result.rows.map(row => ({
      symbol: row.symbol,
      intent: row.intent,
      pathway: row.pathway,
      sector: row.sector,
      industry: row.industry,
      score: row.score,
      reasons: row.reasons
    }));
  }

  /**
   * Get all stocks from FMP-based universe (DEPRECATED - use getFundamentalCandidates instead)
   */
  async getAllStocks() {
    const result = await db.query(
      'SELECT symbol, sector, industry FROM stock_universe WHERE status = $1 ORDER BY market_cap DESC',
      ['active']
    );

    return result.rows.map(row => ({
      symbol: row.symbol,
      sector: row.sector,
      industry: row.industry
    }));
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

    const prompt = `You are analyzing ${sortedStocks.length} pre-screened stocks from Saturday's fundamental screening to refine and rank them.

**Context:** These stocks were already identified by fundamental metrics screening with specific pathways (deepValue, highGrowth, overvalued, etc.). Your job is to:
1. Use current news/catalysts (via Tavily) to validate or invalidate the fundamental thesis
2. Reference stock profiles to understand business context and recent changes
3. Rank and refine the list to identify the TOP 15 quality longs and TOP 15 overvalued shorts

**QUALITY STOCKS** (15 max) - High-quality companies for dip-buying opportunities
   - Strong fundamentals: High ROE (>15%), low debt/equity (<0.5), positive FCF
   - Consistent growth: Revenue growth >10%, earnings growth >10%
   - Market leaders: High operating margins (>15%), strong competitive moats
   - Currently trading below intrinsic value or near support levels
   - **Recent catalyst or news that validates the opportunity**

**OVERVALUED/BROKEN STOCKS** (15 max) - Short candidates with deteriorating fundamentals
   - Overvaluation: High P/E (>30), high PEG (>2), extended from fundamentals
   - Deteriorating metrics: Declining margins, rising debt, negative FCF
   - Broken growth: Negative revenue/earnings growth, contracting business
   - Technical weakness: Extended from highs, showing distribution
   - **Recent news showing deterioration or negative catalyst**

**Stock Data (with fundamental screening context):**

${sortedStocks.map(s => {
  const pathwayTag = s.pathway ? ` [${s.pathway}]` : '';
  const scoreTag = s.fundamentalScore ? ` (fundamental score: ${s.fundamentalScore})` : '';
  const reasonsTag = s.fundamentalReasons ? `\n  Fundamental screening reasons: ${s.fundamentalReasons}` : '';
  return `
${s.symbol}${pathwayTag}${scoreTag} (${s.fundamentals.sector || 'Unknown'})
  Market Cap: $${((s.fundamentals.marketCap || 0) / 1e9).toFixed(1)}B
  Price: $${s.market.price || 0} (52w high: $${s.market.high52w || 0}, ${(((s.market.price || 0) - (s.market.high52w || 1)) / (s.market.high52w || 1) * 100).toFixed(1)}% from high)
  P/E: ${(s.fundamentals.peRatio || 0).toFixed(1)}, PEG (TTM): ${(s.fundamentals.pegRatio || 0).toFixed(2)}, PEG (Forward): ${(s.fundamentals.forwardPegRatio || 0).toFixed(2)}
  Revenue Growth: ${((s.fundamentals.revenueGrowth || 0) * 100).toFixed(1)}%, Earnings Growth: ${((s.fundamentals.earningsGrowth || 0) * 100).toFixed(1)}%
  Debt/Equity: ${(s.fundamentals.debtToEquity || 0).toFixed(2)}, ROE: ${((s.fundamentals.roe || 0) * 100).toFixed(1)}%
  Operating Margin: ${((s.fundamentals.operatingMargin || 0) * 100).toFixed(1)}%, Net Margin: ${((s.fundamentals.profitMargin || 0) * 100).toFixed(1)}%
  FCF: $${((s.fundamentals.freeCashflow || 0) / 1e9).toFixed(2)}B
  Target Price: $${(s.fundamentals.targetMeanPrice || 0).toFixed(2)} (${s.fundamentals.numberOfAnalysts || 0} analysts)${reasonsTag}
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
   * Update saturday watchlist with both quality and overvalued stocks
   */
  async updateSaturdayWatchlist(qualityStocks, overvaluedStocks) {
    try {
      // Expire old entries
      await db.query(`UPDATE saturday_watchlist SET status = 'expired' WHERE status = 'active'`);

      // Insert quality stocks (long candidates)
      for (const stock of qualityStocks) {
        await db.query(
          `INSERT INTO saturday_watchlist
           (symbol, intent, pathway, sector, industry, score, metrics, reasons, price, status, added_date)
           VALUES ($1, 'LONG', 'quality', $2, $3, $4, $5, $6, $7, 'active', NOW())
           ON CONFLICT (symbol, pathway) DO UPDATE SET
             intent = 'LONG', score = $4, metrics = $5, reasons = $6,
             price = $7, status = 'active', added_date = NOW()`,
          [
            stock.symbol,
            stock.sector || null,
            stock.industry || null,
            stock.score,
            JSON.stringify(stock.keyMetrics),
            stock.reasons,
            stock.targetEntry
          ]
        );
      }

      // Insert overvalued stocks (short candidates)
      for (const stock of overvaluedStocks) {
        await db.query(
          `INSERT INTO saturday_watchlist
           (symbol, intent, pathway, sector, industry, score, metrics, reasons, price, status, added_date)
           VALUES ($1, 'SHORT', 'overvalued', $2, $3, $4, $5, $6, $7, 'active', NOW())
           ON CONFLICT (symbol, pathway) DO UPDATE SET
             intent = 'SHORT', score = $4, metrics = $5, reasons = $6,
             price = $7, status = 'active', added_date = NOW()`,
          [
            stock.symbol,
            stock.sector || null,
            stock.industry || null,
            stock.score,
            JSON.stringify(stock.keyMetrics),
            stock.reasons,
            stock.targetEntry
          ]
        );
      }

      console.log(`   ✅ Saturday watchlist updated: ${qualityStocks.length} quality stocks, ${overvaluedStocks.length} overvalued stocks`);
    } catch (error) {
      console.error('Error updating saturday watchlist:', error);
      throw error;
    }
  }
}

export default new OpusScreener();
