import axios from 'axios';

/**
 * Financial Modeling Prep (FMP) API Integration
 * Updated to use /stable/ API (v3 deprecated as of Aug 2025)
 *
 * Free tier limits:
 * - 250 API calls per day per key
 * - Resets at midnight UTC
 * - Only Profile and Insider Trading endpoints work on free plan
 * - All other endpoints (quotes, financials, institutional, analyst data) require paid subscription
 *
 * Strategy:
 * - Rotate through 3 keys to get 750 calls/day
 * - Cache data aggressively since free tier is limited
 * - Most endpoints return 402 (payment required) on free plan
 */

class FMPClient {
  constructor() {
    this.BASE_URL = 'https://financialmodelingprep.com/stable';

    // Load API keys from environment
    this.apiKeys = [
      process.env.FMP_API_KEY_1 || '4WeyS0aP8qcZE7MncNLbUfUYeP3d3Y6z',
      process.env.FMP_API_KEY_2 || 'PH18udQcNJBriR8PSStFP88SRrJfR2Is',
      process.env.FMP_API_KEY_3 || 'DEMO_KEY_PLACEHOLDER_SUPPLY_LATER'
    ];

    // Track usage per key (resets daily)
    this.keyUsage = [0, 0, 0];
    this.currentKeyIndex = 0;
    this.MAX_CALLS_PER_KEY = 250;
    this.lastResetDate = new Date().toDateString();
  }

  /**
   * Get current API key with rotation
   */
  getCurrentKey() {
    // Reset counters if new day
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.keyUsage = [0, 0, 0];
      this.currentKeyIndex = 0;
      this.lastResetDate = today;
      console.log('🔄 FMP API key usage counters reset for new day');
    }

    // Check if current key is near limit
    if (this.keyUsage[this.currentKeyIndex] >= this.MAX_CALLS_PER_KEY - 10) {
      // Rotate to next key
      this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
      console.log(`🔄 Rotating to FMP API key ${this.currentKeyIndex + 1}`);
    }

    return this.apiKeys[this.currentKeyIndex];
  }

  /**
   * Make API request with automatic key rotation
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
      this.keyUsage[this.currentKeyIndex]++;

      return response.data;
    } catch (error) {
      // Check if rate limit error
      if (error.response?.status === 429) {
        console.warn(`⚠️ Rate limit hit on key ${this.currentKeyIndex + 1}, rotating...`);

        // Force rotation to next key
        this.keyUsage[this.currentKeyIndex] = this.MAX_CALLS_PER_KEY;
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;

        // Retry with new key
        return this.request(endpoint, params);
      }

      // Check if authentication error
      if (error.response?.status === 403 || error.response?.status === 401) {
        throw new Error(`FMP API authentication failed (key ${this.currentKeyIndex + 1}). Please verify API keys are set in Railway environment variables: FMP_API_KEY_1, FMP_API_KEY_2, FMP_API_KEY_3`);
      }

      throw error;
    }
  }

  /**
   * Get company profile (market cap, sector, industry)
   */
  async getProfile(symbol) {
    const data = await this.request(`/profile/${symbol}`);
    return data[0] || null;
  }

  /**
   * Get key metrics (P/E, PEG, debt/equity, etc.)
   */
  async getKeyMetrics(symbol) {
    const data = await this.request(`/key-metrics/${symbol}`, { limit: 1 });
    return data[0] || null;
  }

  /**
   * Get financial ratios (margins, ROE, etc.)
   */
  async getFinancialRatios(symbol) {
    const data = await this.request(`/ratios/${symbol}`, { limit: 1 });
    return data[0] || null;
  }

  /**
   * Get income statement (revenue, earnings)
   */
  async getIncomeStatement(symbol) {
    const data = await this.request(`/income-statement/${symbol}`, { limit: 4 });
    return data || [];
  }

  /**
   * Get comprehensive fundamental data for screening
   * Returns all data needed for fundamental analysis
   */
  async getFundamentals(symbol) {
    try {
      // Fetch all data in parallel
      const [profile, keyMetrics, ratios, incomeStatements] = await Promise.all([
        this.getProfile(symbol),
        this.getKeyMetrics(symbol),
        this.getFinancialRatios(symbol),
        this.getIncomeStatement(symbol)
      ]);

      if (!profile || !keyMetrics) {
        return null;
      }

      // Calculate growth rates from income statements
      let revenueGrowth = 0;
      let earningsGrowth = 0;

      if (incomeStatements.length >= 2) {
        const latest = incomeStatements[0];
        const previous = incomeStatements[1];

        if (latest.revenue && previous.revenue && previous.revenue > 0) {
          revenueGrowth = (latest.revenue - previous.revenue) / previous.revenue;
        }

        if (latest.netIncome && previous.netIncome && previous.netIncome > 0) {
          earningsGrowth = (latest.netIncome - previous.netIncome) / previous.netIncome;
        }
      }

      return {
        symbol,
        marketCap: profile.mktCap || 0,
        sector: profile.sector || 'Unknown',
        industry: profile.industry || 'Unknown',

        // Valuation metrics
        peRatio: keyMetrics.peRatio || 0,
        pegRatio: keyMetrics.pegRatio || 0,
        priceToBook: keyMetrics.pbRatio || 0,

        // Growth metrics
        revenueGrowth,
        earningsGrowth,

        // Financial health
        debtToEquity: keyMetrics.debtToEquity || 0,
        currentRatio: keyMetrics.currentRatio || 0,

        // Profitability
        operatingMargin: ratios?.operatingProfitMargin || 0,
        netMargin: ratios?.netProfitMargin || 0,
        roe: ratios?.returnOnEquity || 0,

        // Cash flow
        freeCashflowPerShare: keyMetrics.freeCashFlowPerShare || 0,

        // Price data
        price: profile.price || 0,
        beta: profile.beta || 0
      };

    } catch (error) {
      console.error(`Error fetching fundamentals for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get usage statistics
   */
  getUsageStats() {
    return {
      currentKey: this.currentKeyIndex + 1,
      usage: this.keyUsage.map((count, i) => ({
        key: i + 1,
        calls: count,
        remaining: this.MAX_CALLS_PER_KEY - count,
        percentage: ((count / this.MAX_CALLS_PER_KEY) * 100).toFixed(1) + '%'
      })),
      totalCalls: this.keyUsage.reduce((sum, count) => sum + count, 0),
      totalRemaining: (this.MAX_CALLS_PER_KEY * 3) - this.keyUsage.reduce((sum, count) => sum + count, 0)
    };
  }
}

export default new FMPClient();
