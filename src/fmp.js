import axios from 'axios';

/**
 * Financial Modeling Prep (FMP) API Integration
 * Using paid plan with single API key
 *
 * Paid plan benefits:
 * - 300 API calls per MINUTE (essentially unlimited for our use)
 * - Access to all endpoints (quotes, financials, ratios, income statements)
 * - Real-time data
 *
 * Strategy:
 * - Single paid key with 300 calls/minute rate limit
 * - 90-day cache to optimize performance
 * - No daily limit concerns
 */

class FMPClient {
  constructor() {
    this.BASE_URL = 'https://financialmodelingprep.com/stable';

    // Single paid API key
    this.apiKey = process.env.FMP_API_KEY_1 || '4WeyS0aP8qcZE7MncNLbUfUYeP3d3Y6z';

    // Track usage for monitoring
    this.callCount = 0;
    this.RATE_LIMIT_PER_MINUTE = 300;
    this.lastResetDate = new Date().toDateString();
  }

  /**
   * Get current API key
   */
  getCurrentKey() {
    // Reset counter if new day
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.callCount = 0;
      this.lastResetDate = today;
      console.log('🔄 FMP API usage counter reset for new day');
    }

    return this.apiKey;
  }

  /**
   * Get current usage stats
   */
  getUsageStats() {
    return {
      calls: this.callCount,
      limit: 'No daily limit (300 calls/minute)',
      remaining: 'Unlimited',
      percentage: 'N/A'
    };
  }

  /**
   * Make API request
   */
  async request(endpoint, params = {}) {
    const apiKey = this.getCurrentKey();

    try {
      const response = await axios.get(`${this.BASE_URL}${endpoint}`, {
        params: {
          ...params,
          apikey: apiKey
        },
        timeout: 10000
      });

      // Increment usage counter
      this.callCount++;

      return response.data;
    } catch (error) {
      // Check if rate limit error (429)
      if (error.response?.status === 429) {
        console.warn(`⚠️ Rate limit hit (300 calls/minute exceeded)`);
        throw new Error(`FMP API rate limit exceeded. Slow down requests.`);
      }

      // Check if authentication error
      if (error.response?.status === 403 || error.response?.status === 401) {
        throw new Error(`FMP API authentication failed. Please verify API key is set correctly.`);
      }

      throw error;
    }
  }

  /**
   * Get company profile (market cap, sector, industry)
   */
  async getProfile(symbol) {
    const data = await this.request(`/profile`, { symbol });
    return data[0] || null;
  }

  /**
   * Get key metrics (P/E, PEG, debt/equity, etc.)
   */
  async getKeyMetrics(symbol) {
    const data = await this.request(`/key-metrics`, { symbol, limit: 1 });
    return data[0] || null;
  }

  /**
   * Get financial ratios (margins, ROE, etc.)
   */
  async getFinancialRatios(symbol) {
    const data = await this.request(`/ratios`, { symbol, limit: 1 });
    return data[0] || null;
  }

  /**
   * Get TTM (Trailing Twelve Months) ratios - current valuation metrics
   * Includes real-time P/E, PEG, P/B based on current price
   */
  async getRatiosTTM(symbol) {
    const data = await this.request(`/ratios-ttm`, { symbol });
    return data[0] || null;
  }

  /**
   * Get TTM key metrics - ROIC, Graham number, EV ratios
   */
  async getKeyMetricsTTM(symbol) {
    const data = await this.request(`/key-metrics-ttm`, { symbol });
    return data[0] || null;
  }

  /**
   * Get income statement (revenue, earnings)
   * Use period=quarter for quarterly data
   */
  async getIncomeStatement(symbol, limit = 8) {
    const data = await this.request(`/income-statement`, {
      symbol,
      period: 'quarter',
      limit
    });
    return data || [];
  }

  /**
   * Get financial growth rates (true YoY growth)
   * Returns revenueGrowth, netIncomeGrowth, epsGrowth, etc.
   */
  async getFinancialGrowth(symbol, limit = 5) {
    const data = await this.request(`/financial-growth`, {
      symbol,
      period: 'quarter',
      limit
    });
    return data || [];
  }

  /**
   * Get technical indicators using dedicated technical-indicators endpoint
   * Includes: 200 EMA, 50 EMA, RSI(14), volume trend analysis
   */
  async getTechnicalIndicators(symbol) {
    try {
      const [ema200Data, ema50Data, rsiData] = await Promise.all([
        this.request(`/technical-indicators/ema`, {
          symbol, periodLength: 200, timeframe: '1day'
        }),
        this.request(`/technical-indicators/ema`, {
          symbol, periodLength: 50, timeframe: '1day'
        }),
        this.request(`/technical-indicators/rsi`, {
          symbol, periodLength: 14, timeframe: '1day'
        })
      ]);

      const currentPrice = ema200Data?.[0]?.close || 0;
      const ema200 = ema200Data?.[0]?.ema || 0;
      const ema50 = ema50Data?.[0]?.ema || 0;
      const rsi = rsiData?.[0]?.rsi || 0;

      // Volume trend analysis (recent 5 days vs 10-15 days ago)
      const volumeTrend = this.analyzeVolumeTrend(ema200Data);

      return {
        price: currentPrice,
        ema50,
        ema200,
        rsi,
        aboveEma50: currentPrice > ema50,
        aboveEma200: currentPrice > ema200,
        ema50Distance: ema50 > 0 ? ((currentPrice - ema50) / ema50 * 100) : 0,
        ema200Distance: ema200 > 0 ? ((currentPrice - ema200) / ema200 * 100) : 0,
        // RSI interpretation
        rsiBand: rsi > 70 ? 'overbought' : rsi < 30 ? 'oversold' : 'neutral',
        // Volume trend
        volumeTrend: volumeTrend.trend,
        volumeChange: volumeTrend.change,
        recentAvgVolume: volumeTrend.recentAvg,
        olderAvgVolume: volumeTrend.olderAvg
      };
    } catch (error) {
      console.error(`Error fetching technical indicators for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Analyze volume trend from historical data
   * Compares recent 5-day average vs 10-15 days ago average
   */
  analyzeVolumeTrend(historicalData) {
    if (!historicalData || historicalData.length < 15) {
      return { trend: 'unknown', change: 0, recentAvg: 0, olderAvg: 0 };
    }

    // Recent 5 days (indices 0-4)
    const recent5 = historicalData.slice(0, 5);
    const recentAvg = recent5.reduce((sum, d) => sum + (d.volume || 0), 0) / 5;

    // Older 5 days (indices 10-14, skipping 5-9 for cleaner comparison)
    const older5 = historicalData.slice(10, 15);
    const olderAvg = older5.reduce((sum, d) => sum + (d.volume || 0), 0) / 5;

    const change = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg * 100) : 0;

    let trend = 'stable';
    if (change > 20) trend = 'increasing';      // 20%+ increase
    else if (change < -20) trend = 'declining'; // 20%+ decline

    return {
      trend,
      change: parseFloat(change.toFixed(1)),
      recentAvg: Math.round(recentAvg),
      olderAvg: Math.round(olderAvg)
    };
  }

  /**
   * Get earnings calendar (upcoming earnings dates)
   * Returns all upcoming earnings by default
   */
  async getEarningsCalendar() {
    const data = await this.request(`/earnings-calendar`, {});
    return data || [];
  }

  /**
   * Get earnings surprises (beat/miss history)
   */
  async getEarningsSurprises(symbol, limit = 8) {
    const data = await this.request(`/earnings-surprises`, { symbol, limit });
    return data || [];
  }

  /**
   * Get congressional trading activity for a symbol
   * Returns both Senate and House trades
   */
  async getCongressionalTrading(symbol) {
    try {
      const [senateTrades, houseTrades] = await Promise.all([
        this.request(`/senate-trades`, { symbol }),
        this.request(`/house-trades`, { symbol })
      ]);

      const allTrades = [
        ...(senateTrades || []).map(t => ({ ...t, chamber: 'Senate' })),
        ...(houseTrades || []).map(t => ({ ...t, chamber: 'House' }))
      ];

      // Sort by transaction date (most recent first)
      allTrades.sort((a, b) => new Date(b.transactionDate) - new Date(a.transactionDate));

      return allTrades;
    } catch (error) {
      console.error(`Error fetching congressional trades for ${symbol}:`, error.message);
      return [];
    }
  }

  /**
   * Analyze congressional trading patterns
   * Returns summary of recent activity (last 90 days)
   */
  analyzeCongressionalActivity(trades) {
    if (!trades || trades.length === 0) {
      return { signal: 'none', summary: 'No congressional trades in last 90 days' };
    }

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const recentTrades = trades.filter(t => new Date(t.transactionDate) >= ninetyDaysAgo);

    if (recentTrades.length === 0) {
      return { signal: 'none', summary: 'No recent congressional trades' };
    }

    const buys = recentTrades.filter(t => t.type === 'Purchase').length;
    const sells = recentTrades.filter(t => t.type === 'Sale').length;
    const uniqueMembers = new Set(recentTrades.map(t => `${t.firstName} ${t.lastName}`)).size;

    let signal = 'neutral';
    let summary = '';

    if (buys > sells * 2 && uniqueMembers >= 3) {
      signal = 'bullish_cluster';
      summary = `${uniqueMembers} members bought (${buys} buys vs ${sells} sells) - unusual cluster`;
    } else if (sells > buys * 2 && uniqueMembers >= 3) {
      signal = 'bearish_cluster';
      summary = `${uniqueMembers} members sold (${sells} sells vs ${buys} buys) - distribution signal`;
    } else if (recentTrades.length >= 5) {
      signal = 'high_activity';
      summary = `${recentTrades.length} trades by ${uniqueMembers} members (${buys} buys, ${sells} sells)`;
    } else {
      summary = `${recentTrades.length} trades (${buys} buys, ${sells} sells)`;
    }

    return {
      signal,
      summary,
      recentTrades: recentTrades.length,
      buys,
      sells,
      uniqueMembers,
      trades: recentTrades.slice(0, 5) // Return top 5 most recent
    };
  }

  /**
   * Company Screener - pre-filter stocks by fundamental criteria
   * Much more efficient than fetching individual stock profiles
   * Docs: /stable/company-screener
   *
   * Long pathways params:
   *   Deep Value:   priceToEarningsRatioLowerThan, priceToBookRatioLowerThan
   *   High Growth:  revenueGrowthQuarterlyYoyMoreThan
   *   Inflection:   operatingIncomeGrowthQuarterlyYoyMoreThan
   *   Cash Machine: freeCashFlowYieldMoreThan
   *
   * Short pathway params:
   *   priceToEarningsRatioMoreThan, priceToBookRatioMoreThan
   */
  async screenCompanies(params = {}) {
    const defaults = {
      exchange: 'nasdaq,nyse,amex',
      limit: 200
    };
    const data = await this.request(`/company-screener`, { ...defaults, ...params });
    return data || [];
  }

  /**
   * Get comprehensive fundamental data for screening
   * Uses TTM ratios (current valuation) + quarterly growth rates
   */
  async getFundamentals(symbol) {
    try {
      // BATCH 1: Real-time valuation (1-day cache)
      const [profile, ratiosTTM, keyMetricsTTM] = await Promise.all([
        this.getProfile(symbol),
        this.getRatiosTTM(symbol),
        this.getKeyMetricsTTM(symbol)
      ]);

      if (!profile || !ratiosTTM) {
        return null;
      }

      // BATCH 2: Quarterly data (45-day cache)
      const [financialGrowth, incomeStatements] = await Promise.all([
        this.getFinancialGrowth(symbol, 5),
        this.getIncomeStatement(symbol, 8)
      ]);

      // Extract growth rates from financial-growth endpoint (true YoY)
      const latestGrowth = financialGrowth[0] || {};

      return {
        symbol,
        marketCap: profile.mktCap || 0,
        sector: profile.sector || 'Unknown',
        industry: profile.industry || 'Unknown',

        // TTM Valuation (current price × TTM earnings)
        peRatio: ratiosTTM.priceToEarningsRatioTTM || 0,
        pegRatio: ratiosTTM.priceToEarningsGrowthRatioTTM || 0,
        priceToBook: ratiosTTM.priceToBookRatioTTM || 0,
        priceToSales: ratiosTTM.priceToSalesRatioTTM || 0,
        evToEbitda: keyMetricsTTM?.enterpriseValueOverEBITDATTM || 0,
        grahamNumber: keyMetricsTTM?.grahamNumberTTM || 0,
        earningsYield: keyMetricsTTM?.earningsYieldTTM || 0,

        // Growth rates (true YoY from financial-growth)
        revenueGrowth: latestGrowth.revenueGrowth || 0,
        earningsGrowth: latestGrowth.netIncomeGrowth || 0,
        epsGrowth: latestGrowth.epsGrowth || 0,
        grossProfitGrowth: latestGrowth.grossProfitGrowth || 0,
        fcfGrowth: latestGrowth.freeCashFlowGrowth || 0,

        // Growth trend (last 3 quarters for acceleration/deceleration)
        revenueGrowthTrend: financialGrowth.slice(0, 3).map(q => q.revenueGrowth).filter(Boolean),

        // TTM Financial Health
        debtToEquity: ratiosTTM.debtToEquityRatioTTM || 0,
        currentRatio: ratiosTTM.currentRatioTTM || 0,
        interestCoverage: ratiosTTM.interestCoverageTTM || 0,

        // TTM Profitability
        operatingMargin: ratiosTTM.operatingProfitMarginTTM || 0,
        netMargin: ratiosTTM.netProfitMarginTTM || 0,
        grossMargin: ratiosTTM.grossProfitMarginTTM || 0,
        roe: ratiosTTM.returnOnEquityTTM || 0,
        roic: keyMetricsTTM?.roicTTM || 0,

        // TTM Cash Flow
        freeCashflowPerShare: ratiosTTM.freeCashFlowPerShareTTM || 0,

        // Price data
        price: profile.price || 0,
        beta: profile.beta || 0,

        // Quarterly statements for trend analysis
        incomeStatements: incomeStatements.slice(0, 4) // Last 4 quarters
      };

    } catch (error) {
      console.error(`Error fetching fundamentals for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get deep analysis bundle for Opus screening (Phases 2-3)
   * Fetches comprehensive data for 15-20 finalists
   */
  async getDeepAnalysisBundle(symbol) {
    try {
      // BATCH 1: Valuation and quality
      const [ratiosTTM, keyMetricsTTM, financialGrowth, profile] = await Promise.all([
        this.getRatiosTTM(symbol),
        this.getKeyMetricsTTM(symbol),
        this.getFinancialGrowth(symbol, 5),
        this.getProfile(symbol)
      ]);

      // BATCH 2: Context and signals
      const [incomeStatements, technicals] = await Promise.all([
        this.getIncomeStatement(symbol, 8),
        this.getTechnicalIndicators(symbol)
      ]);

      if (!ratiosTTM || !profile) {
        return null;
      }

      // Calculate pre-computed signals
      const revenueAccel = this.calcGrowthAcceleration(financialGrowth);

      return {
        symbol,
        profile,
        ratiosTTM,
        keyMetricsTTM,
        financialGrowth,
        incomeStatements,
        technicals,

        // Pre-computed signals for Opus
        signals: {
          isAbove200MA: technicals?.aboveMa200 || false,
          isAbove50MA: technicals?.aboveMa50 || false,
          ma200Distance: technicals?.ma200Distance || 0,
          revenueAccel,
          latestQuarterRevenue: incomeStatements[0]?.revenue || 0,
          latestQuarterEarnings: incomeStatements[0]?.netIncome || 0,
          latestQuarterDate: incomeStatements[0]?.date || 'N/A'
        }
      };
    } catch (error) {
      console.error(`Error fetching deep analysis bundle for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Calculate growth acceleration/deceleration
   */
  calcGrowthAcceleration(financialGrowth) {
    if (!financialGrowth || financialGrowth.length < 2) return 'unknown';

    const latest = financialGrowth[0]?.revenueGrowth || 0;
    const previous = financialGrowth[1]?.revenueGrowth || 0;

    if (latest > previous) return 'accelerating';
    if (latest < previous) return 'decelerating';
    return 'stable';
  }

}

export default new FMPClient();
