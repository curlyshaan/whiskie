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
   * Get income statement (revenue, earnings)
   */
  async getIncomeStatement(symbol) {
    const data = await this.request(`/income-statement`, { symbol, limit: 4 });
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

}

export default new FMPClient();
