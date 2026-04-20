import axios from 'axios';

/**
 * Financial Modeling Prep (FMP) API Integration
 * Uses the current paid single-key setup.
 *
 * Current assumptions:
 * - one paid FMP key
 * - Starter-tier 300 calls/minute ceiling
 * - `/stable` endpoints as the canonical FMP surface
 *
 * Notes:
 * - some endpoints are still plan-restricted, so code should not assume
 *   every documented endpoint is available
 * - quote fan-out should prefer controlled parallel single-symbol requests
 *   over restricted batch endpoints
 */

class FMPClient {
  constructor() {
    this.BASE_URL = 'https://financialmodelingprep.com/stable';

    // Single paid API key (Starter plan in current deployment)
    this.apiKey = process.env.FMP_API_KEY_1 || '4WeyS0aP8qcZE7MncNLbUfUYeP3d3Y6z';

    // Track usage for monitoring
    this.callCount = 0;
    this.RATE_LIMIT_PER_MINUTE = 300;
    this.lastResetDate = new Date().toDateString();
    this.DEFAULT_QUOTE_CONCURRENCY = 12;
    this.requestTimestamps = [];
    this.minRequestSpacingMs = 225;
    this.maxRetries = 3;
    this.rateLimitBackoffMs = [1500, 3000, 6000];

    // Short-term cache for Saturday screening (30 minutes)
    // Prevents re-fetching same data when Opus screening runs after fundamental screening
    this.cache = new Map();
    this.CACHE_TTL = 30 * 60 * 1000; // 30 minutes
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
      limit: '300 calls/minute',
      remaining: Math.max(0, this.RATE_LIMIT_PER_MINUTE - this.getRecentRequestCount()),
      percentage: `${((this.getRecentRequestCount() / this.RATE_LIMIT_PER_MINUTE) * 100).toFixed(1)}% (rolling 60s)`,
      recentCallsLast60s: this.getRecentRequestCount()
    };
  }

  pruneRequestTimestamps(now = Date.now()) {
    const cutoff = now - 60000;
    while (this.requestTimestamps.length && this.requestTimestamps[0] < cutoff) {
      this.requestTimestamps.shift();
    }
  }

  getRecentRequestCount() {
    this.pruneRequestTimestamps();
    return this.requestTimestamps.length;
  }

  async throttleRequest() {
    const now = Date.now();
    this.pruneRequestTimestamps(now);

    const lastRequestAt = this.requestTimestamps[this.requestTimestamps.length - 1];
    if (lastRequestAt) {
      const sinceLast = now - lastRequestAt;
      if (sinceLast < this.minRequestSpacingMs) {
        await new Promise(resolve => setTimeout(resolve, this.minRequestSpacingMs - sinceLast));
      }
    }

    this.pruneRequestTimestamps();
    if (this.requestTimestamps.length >= this.RATE_LIMIT_PER_MINUTE - 5) {
      const oldest = this.requestTimestamps[0];
      const waitMs = Math.max(250, 60000 - (Date.now() - oldest));
      console.warn(`⚠️ FMP throttle engaged: ${this.requestTimestamps.length} requests in rolling 60s, waiting ${waitMs}ms`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
      this.pruneRequestTimestamps();
    }
  }

  /**
   * Make API request with 30-minute cache for repeated reads
   */
  async request(endpoint, params = {}) {
    // Check cache first (30-minute TTL for Saturday screening)
    const cacheKey = `${endpoint}:${JSON.stringify(params)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    const apiKey = this.getCurrentKey();

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      await this.throttleRequest();

      try {
        this.requestTimestamps.push(Date.now());

        const response = await axios.get(`${this.BASE_URL}${endpoint}`, {
          params: {
            ...params,
            apikey: apiKey
          },
          timeout: 10000
        });

        this.callCount++;

        this.cache.set(cacheKey, {
          data: response.data,
          timestamp: Date.now()
        });

        return response.data;
      } catch (error) {
        if (error.response?.status === 429) {
          const retryDelay = this.rateLimitBackoffMs[Math.min(attempt, this.rateLimitBackoffMs.length - 1)];
          if (attempt < this.maxRetries - 1) {
            console.warn(`⚠️ FMP 429 on ${endpoint}; backing off ${retryDelay}ms before retry ${attempt + 2}/${this.maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            continue;
          }
          throw new Error(`FMP API rate limit exceeded after retries for ${endpoint}.`);
        }

        if (error.response?.status === 403 || error.response?.status === 401) {
          throw new Error(`FMP API authentication failed. Please verify API key is set correctly.`);
        }

        throw error;
      }
    }
  }

  /**
   * Get real-time quote (price, volume, change)
   */
  async getQuote(symbol) {
    const data = await this.request(`/quote`, { symbol });
    return data[0] || null;
  }

  /**
   * Get multiple real-time quotes with controlled parallel single-symbol requests.
   * `batch-quote` is currently restricted on the active plan.
   */
  async getQuotes(symbols, options = {}) {
    const symbolList = Array.isArray(symbols)
      ? symbols
      : String(symbols || '').split(',').map(s => s.trim()).filter(Boolean);

    if (!symbolList.length) return [];

    const concurrency = Math.max(1, Math.min(options.concurrency || this.DEFAULT_QUOTE_CONCURRENCY, 8));
    const results = [];

    for (let i = 0; i < symbolList.length; i += concurrency) {
      const chunk = symbolList.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map(async (symbol) => {
          try {
            return await this.getQuote(symbol);
          } catch (error) {
            console.warn(`⚠️ Quote fetch failed for ${symbol}: ${error.message}`);
            return null;
          }
        })
      );
      results.push(...chunkResults.filter(Boolean));
    }

    return results;
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
   * Get cash flow statement (operating cash flow, FCF)
   * Use period=quarter for quarterly data
   */
  async getCashFlowStatement(symbol, limit = 4) {
    const data = await this.request(`/cash-flow-statement`, {
      symbol,
      period: 'quarter',
      limit
    });
    return data || [];
  }

  /**
   * Get balance sheet (assets, liabilities, equity)
   * Use period=quarter for quarterly data
   */
  async getBalanceSheet(symbol, limit = 4) {
    const data = await this.request(`/balance-sheet-statement`, {
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
   * Compares recent 5-day average vs older period
   *
   * @param {Array} historicalData - Array of daily price/volume data
   * @param {number} lookbackDays - How far back to compare (20, 50, 90, 200)
   * @returns {Object} Volume trend analysis
   */
  analyzeVolumeTrend(historicalData, lookbackDays = 15) {
    if (!historicalData || historicalData.length < lookbackDays + 5) {
      return {
        trend: 'unknown',
        change: 0,
        recentAvg: 0,
        olderAvg: 0,
        lookbackDays,
        dataPoints: historicalData?.length || 0
      };
    }

    // Recent 5 days (indices 0-4)
    const recent5 = historicalData.slice(0, 5);
    const recentAvg = recent5.reduce((sum, d) => sum + (d.volume || 0), 0) / 5;

    // Older 5 days (starting at lookbackDays offset)
    const older5 = historicalData.slice(lookbackDays, lookbackDays + 5);
    const olderAvg = older5.reduce((sum, d) => sum + (d.volume || 0), 0) / 5;

    const change = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg * 100) : 0;

    let trend = 'stable';
    if (change > 20) trend = 'increasing';      // 20%+ increase
    else if (change < -20) trend = 'declining'; // 20%+ decline

    return {
      trend,
      change: parseFloat(change.toFixed(1)),
      recentAvg: Math.round(recentAvg),
      olderAvg: Math.round(olderAvg),
      lookbackDays,
      dataPoints: historicalData.length
    };
  }

  /**
   * Get volume trend with custom lookback period
   * Allows Opus to request different timeframes for analysis
   */
  async getVolumeTrend(symbol, lookbackDays = 15) {
    try {
      // Fetch enough historical data for the requested lookback
      const requiredDays = lookbackDays + 10; // +10 for the comparison window
      const emaData = await this.request(`/technical-indicators/ema`, {
        symbol,
        periodLength: Math.max(50, requiredDays), // Ensure we get enough data
        timeframe: '1day'
      });

      return this.analyzeVolumeTrend(emaData, lookbackDays);
    } catch (error) {
      console.error(`Error fetching volume trend for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get any technical indicator with custom parameters
   * Allows Opus to request specific indicators during analysis
   *
   * Available indicators:
   * - sma, ema, wma, dema, tema (moving averages)
   * - rsi, williams, adx (oscillators)
   * - standardDeviation
   *
   * @param {string} symbol - Stock symbol
   * @param {string} indicator - Indicator type (sma, ema, rsi, williams, adx, etc.)
   * @param {number} period - Period length (e.g., 14 for RSI, 50 for SMA)
   * @param {string} timeframe - Timeframe (1day, 4hour, 1hour, etc.)
   */
  async getTechnicalIndicator(symbol, indicator, period = 14, timeframe = '1day') {
    try {
      const data = await this.request(`/technical-indicators/${indicator}`, {
        symbol,
        periodLength: period,
        timeframe
      });
      return data || null;
    } catch (error) {
      console.error(`Error fetching ${indicator}(${period}) for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get SMA (Simple Moving Average) for a symbol
   * @param {string} symbol - Stock symbol
   * @param {number} period - Period length (e.g., 50, 200)
   * @param {string} timeframe - Timeframe (1day, 4hour, etc.)
   * @returns {Array} Array of {date, open, high, low, close, volume, sma}
   */
  async getSMA(symbol, period = 200, timeframe = '1day') {
    return this.getTechnicalIndicator(symbol, 'sma', period, timeframe);
  }

  /**
   * Get EMA (Exponential Moving Average) for a symbol
   * @param {string} symbol - Stock symbol
   * @param {number} period - Period length (e.g., 50, 200)
   * @param {string} timeframe - Timeframe (1day, 4hour, etc.)
   * @returns {Array} Array of {date, open, high, low, close, volume, ema}
   */
  async getEMA(symbol, period = 200, timeframe = '1day') {
    return this.getTechnicalIndicator(symbol, 'ema', period, timeframe);
  }

  /**
   * Get RSI (Relative Strength Index) for a symbol
   * @param {string} symbol - Stock symbol
   * @param {number} period - Period length (typically 14)
   * @param {string} timeframe - Timeframe (1day, 4hour, etc.)
   * @returns {Array} Array of {date, open, high, low, close, volume, rsi}
   */
  async getRSI(symbol, period = 14, timeframe = '1day') {
    return this.getTechnicalIndicator(symbol, 'rsi', period, timeframe);
  }

  /**
   * Get MACD (Moving Average Convergence Divergence) for a symbol
   * @param {string} symbol - Stock symbol
   * @param {string} timeframe - Timeframe (1day, 4hour, etc.)
   * @returns {Array} Array of {date, open, high, low, close, volume, macd}
   */
  async getMACD(symbol, timeframe = '1day') {
    return this.getTechnicalIndicator(symbol, 'macd', 12, timeframe);
  }

  /**
   * Get ADX (Average Directional Index) for a symbol
   * @param {string} symbol - Stock symbol
   * @param {number} period - Period length (typically 14)
   * @param {string} timeframe - Timeframe (1day, 4hour, etc.)
   * @returns {Array} Array of {date, open, high, low, close, volume, adx}
   */
  async getADX(symbol, period = 14, timeframe = '1day') {
    return this.getTechnicalIndicator(symbol, 'adx', period, timeframe);
  }

  /**
   * Get Williams %R for a symbol
   * @param {string} symbol - Stock symbol
   * @param {number} period - Period length (typically 14)
   * @param {string} timeframe - Timeframe (1day, 4hour, etc.)
   * @returns {Array} Array of {date, open, high, low, close, volume, williams}
   */
  async getWilliams(symbol, period = 14, timeframe = '1day') {
    return this.getTechnicalIndicator(symbol, 'williams', period, timeframe);
  }

  /**
   * Get Standard Deviation for a symbol
   * @param {string} symbol - Stock symbol
   * @param {number} period - Period length
   * @param {string} timeframe - Timeframe (1day, 4hour, etc.)
   * @returns {Array} Array of {date, open, high, low, close, volume, standardDeviation}
   */
  async getStandardDeviation(symbol, period = 20, timeframe = '1day') {
    return this.getTechnicalIndicator(symbol, 'standardDeviation', period, timeframe);
  }

  /**
   * Get earnings calendar (upcoming earnings dates)
   * Returns all upcoming earnings by default
   */
  async getEarningsCalendar(params = {}) {
    const data = await this.request(`/earnings-calendar`, params);
    return data || [];
  }

  /**
   * Get end-of-day historical price data for a symbol.
   * Returns ascending date order to match existing profile builder expectations.
   */
  async getHistoricalPriceEodFull(symbol, from, to) {
    const data = await this.request(`/historical-price-eod/full`, { symbol, from, to });
    if (!Array.isArray(data)) return [];
    return data
      .map(row => ({
        date: row.date,
        open: Number(row.open) || 0,
        high: Number(row.high) || 0,
        low: Number(row.low) || 0,
        close: Number(row.close) || 0,
        volume: Number(row.volume) || 0
      }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  /**
   * Get earnings surprises (beat/miss history)
   */
  async getEarningsSurprises(symbol, limit = 8) {
    const data = await this.request(`/earnings-surprises`, { symbol, limit });
    return data || [];
  }

  /**
   * Get insider trading activity for a symbol
   * Returns corporate insider trades (executives, directors, 10% owners)
   */
  async getInsiderTrading(symbol) {
    try {
      const trades = await this.request(`/insider-trading/search`, { symbol });
      return trades || [];
    } catch (error) {
      console.error(`Error fetching insider trades for ${symbol}:`, error.message);
      return [];
    }
  }

  /**
   * Analyze insider trading patterns
   * Returns summary of recent activity (last 30 days)
   */
  analyzeInsiderActivity(trades) {
    if (!trades || trades.length === 0) {
      return { signal: 'none', summary: 'No insider trades in last 30 days' };
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentTrades = trades.filter(t => new Date(t.transactionDate) >= thirtyDaysAgo);

    if (recentTrades.length === 0) {
      return { signal: 'none', summary: 'No recent insider trades' };
    }

    // Filter for actual buy/sell transactions (exclude option exercises, gifts, etc)
    const buys = recentTrades.filter(t =>
      t.acquisitionOrDisposition === 'A' &&
      (t.transactionType === 'P-Purchase' || t.transactionType === 'M-Exempt')
    );
    const sells = recentTrades.filter(t =>
      t.acquisitionOrDisposition === 'D' &&
      (t.transactionType === 'S-Sale' || t.transactionType === 'F-InKind')
    );

    const uniqueInsiders = new Set(recentTrades.map(t => t.reportingName)).size;
    const totalValue = recentTrades.reduce((sum, t) => sum + (t.securitiesTransacted * t.price), 0);

    let signal = 'neutral';
    let summary = '';

    if (buys.length >= 3 && sells.length === 0) {
      signal = 'bullish_cluster';
      summary = `${uniqueInsiders} insiders buying (${buys.length} buys, 0 sells) - strong conviction`;
    } else if (sells.length >= 5 && buys.length === 0) {
      signal = 'bearish_cluster';
      summary = `${uniqueInsiders} insiders selling (${sells.length} sells, 0 buys) - distribution`;
    } else if (buys.length > sells.length * 2) {
      signal = 'bullish';
      summary = `Net buying: ${buys.length} buys vs ${sells.length} sells`;
    } else if (sells.length > buys.length * 2) {
      signal = 'bearish';
      summary = `Net selling: ${sells.length} sells vs ${buys.length} buys`;
    } else {
      summary = `${recentTrades.length} trades (${buys.length} buys, ${sells.length} sells)`;
    }

    return {
      signal,
      summary,
      recentTrades: recentTrades.length,
      buys: buys.length,
      sells: sells.length,
      uniqueInsiders,
      totalValue: Math.round(totalValue),
      trades: recentTrades.slice(0, 5) // Return top 5 most recent
    };
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
   * Returns summary of recent activity (last 30 days)
   */
  analyzeCongressionalActivity(trades) {
    if (!trades || trades.length === 0) {
      return { signal: 'none', summary: 'No congressional trades in last 30 days' };
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentTrades = trades.filter(t => new Date(t.transactionDate) >= thirtyDaysAgo);

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
      exchange: 'nasdaq,nyse,amex'
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
      // Keep fundamentals fetches mostly sequential per symbol to avoid accidental fan-out bursts during large scans
      const profile = await this.getProfile(symbol);
      const ratiosTTM = await this.getRatiosTTM(symbol);
      const keyMetricsTTM = await this.getKeyMetricsTTM(symbol);

      if (!ratiosTTM) {
        // Silently return null - likely an ETF or non-equity security
        return null;
      }

      if (!keyMetricsTTM) {
        // Silently return null - likely an ETF or non-equity security
        return null;
      }

      if (!profile) {
        console.warn(`⚠️ ${symbol}: profile returned null (non-critical, using defaults)`);
      }

      // Sequential calls for quarterly data (no parallel calls)
      const financialGrowth = await this.getFinancialGrowth(symbol, 5);
      const incomeStatements = await this.getIncomeStatement(symbol, 8);
      const cashFlowStatements = await this.getCashFlowStatement(symbol, 4);
      const balanceSheets = await this.getBalanceSheet(symbol, 4);

      if (!financialGrowth || financialGrowth.length === 0) {
        console.warn(`⚠️ ${symbol}: financial-growth returned empty (quarterly growth metrics unavailable)`);
      }

      if (!incomeStatements || incomeStatements.length === 0) {
        console.warn(`⚠️ ${symbol}: income-statement returned empty (quarterly metrics unavailable)`);
      }

      if (!cashFlowStatements || cashFlowStatements.length === 0) {
        console.warn(`⚠️ ${symbol}: cash-flow-statement returned empty (cash flow metrics unavailable)`);
      }

      if (!balanceSheets || balanceSheets.length === 0) {
        console.warn(`⚠️ ${symbol}: balance-sheet returned empty (balance sheet metrics unavailable)`);
      }

      // Extract growth rates from financial-growth endpoint (true YoY)
      const latestGrowth = financialGrowth[0] || {};
      const prevGrowth = financialGrowth[1] || {};

      // Calculate quarterly metrics from income statements
      const latestQ = incomeStatements[0] || {};
      const prevQ = incomeStatements[1] || {};

      // Get cash flow and balance sheet data for accrual ratio
      const latestCF = cashFlowStatements[0] || {};
      const latestBS = balanceSheets[0] || {};

      const revenueGrowthQ = latestGrowth.revenueGrowth || 0;
      const revenueGrowthPrevQ = prevGrowth.revenueGrowth || 0;

      const operatingMarginQ = latestQ.revenue ? (latestQ.operatingIncome / latestQ.revenue) : 0;
      const operatingMarginPrevQ = prevQ.revenue ? (prevQ.operatingIncome / prevQ.revenue) : 0;

      // Calculate TTM free cash flow from shares outstanding and FCF per share
      const sharesOutstanding = latestQ.weightedAverageShsOutDil || 0;
      const fcfPerShare = ratiosTTM.freeCashFlowPerShareTTM || 0;
      const freeCashflow = sharesOutstanding * fcfPerShare;

      return {
        symbol,
        marketCap: keyMetricsTTM?.marketCap || 0,
        sector: profile?.sector || 'Unknown',
        industry: profile?.industry || 'Unknown',

        // TTM Valuation (current price × TTM earnings)
        peRatio: ratiosTTM.priceToEarningsRatioTTM || 0,
        pegRatio: ratiosTTM.priceToEarningsGrowthRatioTTM || 0,
        forwardPegRatio: ratiosTTM.forwardPriceToEarningsGrowthRatioTTM || 0,
        priceToBook: ratiosTTM.priceToBookRatioTTM || 0,
        priceToSales: ratiosTTM.priceToSalesRatioTTM || 0,
        evToEbitda: keyMetricsTTM?.evToEBITDATTM || 0,
        grahamNumber: keyMetricsTTM?.grahamNumberTTM || 0,
        earningsYield: keyMetricsTTM?.earningsYieldTTM || 0,

        // Growth rates (true YoY from financial-growth)
        revenueGrowth: latestGrowth.revenueGrowth || 0,
        earningsGrowth: latestGrowth.netIncomeGrowth || 0,
        epsGrowth: latestGrowth.epsgrowth || 0,
        grossProfitGrowth: latestGrowth.grossProfitGrowth || 0,
        fcfGrowth: latestGrowth.freeCashFlowGrowth || 0,

        // Growth trend (last 3 quarters for acceleration/deceleration)
        revenueGrowthTrend: financialGrowth.slice(0, 3).map(q => q.revenueGrowth).filter(Boolean),

        // TTM Financial Health
        debtToEquity: ratiosTTM.debtToEquityRatioTTM || 0,
        currentRatio: ratiosTTM.currentRatioTTM || 0,
        quickRatio: ratiosTTM.quickRatioTTM || 0,
        cashRatio: ratiosTTM.cashRatioTTM || 0,
        interestCoverage: ratiosTTM.interestCoverageRatioTTM || 0,

        // TTM Profitability
        operatingMargin: ratiosTTM.operatingProfitMarginTTM || 0,
        netMargin: ratiosTTM.netProfitMarginTTM || 0,
        profitMargin: ratiosTTM.netProfitMarginTTM || 0, // Alias for screener compatibility
        grossMargin: ratiosTTM.grossProfitMarginTTM || 0,
        roe: keyMetricsTTM?.returnOnEquityTTM || 0,
        roic: keyMetricsTTM?.returnOnInvestedCapitalTTM || 0,

        // TTM Cash Flow
        freeCashflowPerShare: ratiosTTM.freeCashFlowPerShareTTM || 0,
        freeCashflow: freeCashflow,
        freeCashFlowYield: keyMetricsTTM?.freeCashFlowYieldTTM || 0,
        operatingCashFlowPerShare: ratiosTTM.operatingCashFlowPerShareTTM || 0,

        // Accrual ratio components (for earnings quality check)
        netIncome: latestQ.netIncome || 0,
        operatingCashFlow: latestCF.operatingCashFlow || 0,
        totalAssets: latestBS.totalAssets || 0,

        // Quality metrics
        incomeQuality: keyMetricsTTM?.incomeQualityTTM || 0,
        cashConversionCycle: keyMetricsTTM?.cashConversionCycleTTM || 0,

        // Efficiency metrics
        assetTurnover: ratiosTTM.assetTurnoverTTM || 0,
        inventoryTurnover: ratiosTTM.inventoryTurnoverTTM || 0,
        receivablesTurnover: ratiosTTM.receivablesTurnoverTTM || 0,

        // Working capital metrics
        daysOfSalesOutstanding: keyMetricsTTM?.daysOfSalesOutstandingTTM || 0,
        daysOfInventoryOutstanding: keyMetricsTTM?.daysOfInventoryOutstandingTTM || 0,
        daysOfPayablesOutstanding: keyMetricsTTM?.daysOfPayablesOutstandingTTM || 0,

        // Cash flow efficiency
        priceToOperatingCashFlow: ratiosTTM.priceToOperatingCashFlowRatioTTM || 0,
        capexToOperatingCashFlow: keyMetricsTTM?.capexToOperatingCashFlowTTM || 0,
        capexToRevenue: keyMetricsTTM?.capexToRevenueTTM || 0,

        // Shareholder returns
        dividendYield: ratiosTTM.dividendYieldTTM || 0,
        dividendPayoutRatio: ratiosTTM.dividendPayoutRatioTTM || 0,

        // Short interest not fetched here to keep FMP/profile flows Yahoo-free
        shortFloat: 0,

        // Quarterly metrics for inflection detection
        revenueGrowthQ: revenueGrowthQ,
        revenueGrowthPrevQ: revenueGrowthPrevQ,
        operatingMarginQ: operatingMarginQ,  // Current quarter margin (for inflection/deterioration)
        operatingMarginPrevQ: operatingMarginPrevQ,  // Previous quarter margin

        // Price data
        price: profile?.price || 0,
        beta: profile?.beta || 0,
        avgVolume: profile?.averageVolume || 0,

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

      const quote = await this.getQuote(symbol).catch(() => null);
      const fundamentals = await this.getFundamentals(symbol);

      return {
        symbol,
        profile,
        quote,
        ratiosTTM,
        keyMetricsTTM,
        financialGrowth,
        incomeStatements,
        technicals,
        fundamentals,

        // Pre-computed signals for Opus
        signals: {
          isAbove200MA: technicals?.aboveSMA200 || technicals?.aboveMa200 || false,
          isAbove50MA: technicals?.aboveSMA50 || technicals?.aboveMa50 || false,
          ma200Distance: technicals?.distanceFrom200MA || technicals?.ma200Distance || 0,
          revenueAccel,
          latestQuarterRevenue: incomeStatements[0]?.revenue || 0,
          latestQuarterEarnings: incomeStatements[0]?.netIncome || 0,
          latestQuarterDate: incomeStatements[0]?.date || 'N/A',
          currentPrice: quote?.price || profile?.price || technicals?.currentPrice || 0,
          marketCap: fundamentals?.marketCap || profile?.marketCap || 0,
          sector: fundamentals?.sector || profile?.sector || 'Unknown',
          industry: fundamentals?.industry || profile?.industry || 'Unknown',
          revenueGrowth: fundamentals?.revenueGrowth || financialGrowth?.[0]?.revenueGrowth || 0,
          epsGrowth: fundamentals?.epsGrowth || financialGrowth?.[0]?.epsgrowth || 0,
          operatingMargin: fundamentals?.operatingMargin || ratiosTTM?.operatingProfitMarginTTM || 0,
          roe: fundamentals?.roe || keyMetricsTTM?.returnOnEquityTTM || 0,
          roic: fundamentals?.roic || keyMetricsTTM?.returnOnInvestedCapitalTTM || 0
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
