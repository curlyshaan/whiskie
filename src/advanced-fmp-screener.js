import fmpCache from './fmp-cache.js';
import fmp from './fmp.js';
import * as db from './db.js';

/**
 * Advanced FMP Data Screener
 * Fetches and caches additional FMP data feeds for enhanced decision-making
 *
 * Phase 1: Insider Trading, Institutional Ownership, Analyst Estimates
 * Phase 2: Earnings Surprises, Cash Flow, Price Targets
 * Phase 3: SEC Filings, ETF Holdings, Balance Sheet
 */

class AdvancedFMPScreener {
  constructor() {
    this.CACHE_DURATION_DAYS = 30; // 30 days for most data
    this.INSIDER_CACHE_DAYS = 7;   // 7 days for insider trading (more frequent)
  }

  /**
   * Initialize advanced data tables
   */
  async initDatabase() {
    // Insider trading table
    await db.query(`
      CREATE TABLE IF NOT EXISTS fmp_insider_trading (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        filing_date DATE NOT NULL,
        transaction_date DATE,
        insider_name VARCHAR(255),
        transaction_type VARCHAR(50),
        securities_owned BIGINT,
        securities_transacted BIGINT,
        price DECIMAL(10, 2),
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(symbol, filing_date, insider_name, transaction_type)
      )
    `);

    // Institutional ownership table
    await db.query(`
      CREATE TABLE IF NOT EXISTS fmp_institutional_ownership (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        date DATE NOT NULL,
        investor_name VARCHAR(255),
        shares BIGINT,
        change_shares BIGINT,
        change_percent DECIMAL(10, 4),
        portfolio_percent DECIMAL(10, 4),
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(symbol, date, investor_name)
      )
    `);

    // Analyst estimates table
    await db.query(`
      CREATE TABLE IF NOT EXISTS fmp_analyst_estimates (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        date DATE NOT NULL,
        estimated_revenue_low BIGINT,
        estimated_revenue_high BIGINT,
        estimated_revenue_avg BIGINT,
        estimated_ebitda_low BIGINT,
        estimated_ebitda_high BIGINT,
        estimated_ebitda_avg BIGINT,
        estimated_eps_low DECIMAL(10, 4),
        estimated_eps_high DECIMAL(10, 4),
        estimated_eps_avg DECIMAL(10, 4),
        number_analyst_estimated_revenue INTEGER,
        number_analysts_estimated_eps INTEGER,
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(symbol, date)
      )
    `);

    // Earnings surprises table
    await db.query(`
      CREATE TABLE IF NOT EXISTS fmp_earnings_surprises (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        date DATE NOT NULL,
        actual_earnings_result DECIMAL(10, 4),
        estimated_earnings DECIMAL(10, 4),
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(symbol, date)
      )
    `);

    // Price targets table
    await db.query(`
      CREATE TABLE IF NOT EXISTS fmp_price_targets (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        published_date DATE NOT NULL,
        analyst_name VARCHAR(255),
        analyst_company VARCHAR(255),
        price_target DECIMAL(10, 2),
        adj_price_target DECIMAL(10, 2),
        price_when_posted DECIMAL(10, 2),
        news_url TEXT,
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(symbol, published_date, analyst_company)
      )
    `);

    console.log('✅ Advanced FMP data tables initialized');
  }

  /**
   * PHASE 1: Fetch insider trading data
   * NOTE: This is one of the only endpoints that works on FMP free plan
   */
  async getInsiderTrading(symbol) {
    try {
      // Check cache first (7 days)
      const cached = await db.query(
        `SELECT * FROM fmp_insider_trading
         WHERE symbol = $1 AND cached_at > NOW() - INTERVAL '7 days'
         ORDER BY filing_date DESC
         LIMIT 50`,
        [symbol]
      );

      if (cached.rows.length > 0) {
        return cached.rows;
      }

      // Fetch from FMP stable API
      const data = await fmp.request(`/insider-trading/latest`, { symbol, page: 0, limit: 50 });

      if (!data || data.length === 0) return [];

      // Cache the data
      for (const trade of data) {
        await db.query(
          `INSERT INTO fmp_insider_trading
           (symbol, filing_date, transaction_date, insider_name, transaction_type,
            securities_owned, securities_transacted, price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (symbol, filing_date, insider_name, transaction_type) DO NOTHING`,
          [
            symbol,
            trade.filingDate,
            trade.transactionDate,
            trade.reportingName,
            trade.transactionType,
            trade.securitiesOwned,
            trade.securitiesTransacted,
            trade.price
          ]
        );
      }

      return data;
    } catch (error) {
      console.warn(`⚠️ Error fetching insider trading for ${symbol}:`, error.message);
      return [];
    }
  }

  /**
   * PHASE 1: Fetch institutional ownership
   * NOTE: Requires paid FMP subscription (returns 402 on free plan)
   */
  async getInstitutionalOwnership(symbol) {
    try {
      // Check cache (30 days)
      const cached = await db.query(
        `SELECT * FROM fmp_institutional_ownership
         WHERE symbol = $1 AND cached_at > NOW() - INTERVAL '30 days'
         ORDER BY date DESC
         LIMIT 50`,
        [symbol]
      );

      if (cached.rows.length > 0) {
        return cached.rows;
      }

      // Fetch from FMP stable API (requires paid plan)
      const data = await fmp.request(`/institutional-ownership/latest`, { symbol, page: 0, limit: 50 });

      if (!data || data.length === 0) return [];

      // Cache the data
      for (const holder of data) {
        await db.query(
          `INSERT INTO fmp_institutional_ownership
           (symbol, date, investor_name, shares, change_shares, change_percent, portfolio_percent)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (symbol, date, investor_name) DO NOTHING`,
          [
            symbol,
            holder.dateReported,
            holder.investorName,
            holder.shares,
            holder.change,
            holder.changePercent,
            holder.portfolioPercent
          ]
        );
      }

      return data;
    } catch (error) {
      console.warn(`⚠️ Error fetching institutional ownership for ${symbol}:`, error.message);
      return [];
    }
  }

  /**
   * PHASE 1: Fetch analyst estimates
   * NOTE: Requires paid FMP subscription (returns 402 on free plan)
   */
  async getAnalystEstimates(symbol) {
    try {
      // Check cache (30 days)
      const cached = await db.query(
        `SELECT * FROM fmp_analyst_estimates
         WHERE symbol = $1 AND cached_at > NOW() - INTERVAL '30 days'
         ORDER BY date DESC
         LIMIT 4`,
        [symbol]
      );

      if (cached.rows.length > 0) {
        return cached.rows;
      }

      // Fetch from FMP stable API (requires paid plan)
      const data = await fmp.request(`/analyst-estimates`, { symbol, period: 'quarter', limit: 4 });

      if (!data || data.length === 0) return [];

      // Cache the data
      for (const estimate of data) {
        await db.query(
          `INSERT INTO fmp_analyst_estimates
           (symbol, date, estimated_revenue_low, estimated_revenue_high, estimated_revenue_avg,
            estimated_ebitda_low, estimated_ebitda_high, estimated_ebitda_avg,
            estimated_eps_low, estimated_eps_high, estimated_eps_avg,
            number_analyst_estimated_revenue, number_analysts_estimated_eps)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (symbol, date) DO NOTHING`,
          [
            symbol,
            estimate.date,
            estimate.estimatedRevenueLow,
            estimate.estimatedRevenueHigh,
            estimate.estimatedRevenueAvg,
            estimate.estimatedEbitdaLow,
            estimate.estimatedEbitdaHigh,
            estimate.estimatedEbitdaAvg,
            estimate.estimatedEpsLow,
            estimate.estimatedEpsHigh,
            estimate.estimatedEpsAvg,
            estimate.numberAnalystEstimatedRevenue,
            estimate.numberAnalystsEstimatedEps
          ]
        );
      }

      return data;
    } catch (error) {
      console.warn(`⚠️ Error fetching analyst estimates for ${symbol}:`, error.message);
      return [];
    }
  }

  /**
   * PHASE 2: Fetch earnings surprises
   * NOTE: Requires paid FMP subscription (endpoint not available on free plan)
   */
  async getEarningsSurprises(symbol) {
    try {
      // Check cache (90 days - quarterly data)
      const cached = await db.query(
        `SELECT * FROM fmp_earnings_surprises
         WHERE symbol = $1 AND cached_at > NOW() - INTERVAL '90 days'
         ORDER BY date DESC
         LIMIT 8`,
        [symbol]
      );

      if (cached.rows.length > 0) {
        return cached.rows;
      }

      // Fetch from FMP stable API (requires paid plan)
      // Note: No direct earnings-surprises endpoint in stable API
      // May need to use earnings-surprises-bulk or alternative approach
      const data = await fmp.request(`/earnings-surprises-bulk`, { year: new Date().getFullYear() });

      if (!data || data.length === 0) return [];

      // Cache the data
      for (const surprise of data) {
        await db.query(
          `INSERT INTO fmp_earnings_surprises
           (symbol, date, actual_earnings_result, estimated_earnings)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (symbol, date) DO NOTHING`,
          [
            symbol,
            surprise.date,
            surprise.actualEarningResult,
            surprise.estimatedEarning
          ]
        );
      }

      return data;
    } catch (error) {
      console.warn(`⚠️ Error fetching earnings surprises for ${symbol}:`, error.message);
      return [];
    }
  }

  /**
   * PHASE 2: Fetch price targets
   * NOTE: Requires paid FMP subscription (returns 402 on free plan)
   */
  async getPriceTargets(symbol) {
    try {
      // Check cache (30 days)
      const cached = await db.query(
        `SELECT * FROM fmp_price_targets
         WHERE symbol = $1 AND cached_at > NOW() - INTERVAL '30 days'
         ORDER BY published_date DESC
         LIMIT 20`,
        [symbol]
      );

      if (cached.rows.length > 0) {
        return cached.rows;
      }

      // Fetch from FMP stable API (requires paid plan)
      const data = await fmp.request(`/price-target/latest`, { symbol, page: 0, limit: 20 });

      if (!data || data.length === 0) return [];

      // Cache the data
      for (const target of data) {
        await db.query(
          `INSERT INTO fmp_price_targets
           (symbol, published_date, analyst_name, analyst_company, price_target,
            adj_price_target, price_when_posted, news_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (symbol, published_date, analyst_company) DO NOTHING`,
          [
            symbol,
            target.publishedDate,
            target.analystName,
            target.analystCompany,
            target.priceTarget,
            target.adjPriceTarget,
            target.priceWhenPosted,
            target.newsURL
          ]
        );
      }

      return data;
    } catch (error) {
      console.warn(`⚠️ Error fetching price targets for ${symbol}:`, error.message);
      return [];
    }
  }

  /**
   * Get comprehensive advanced data for a symbol
   * Returns all Phase 1-3 data in one call
   */
  async getAdvancedData(symbol, phases = [1, 2, 3]) {
    const data = {};

    // Phase 1
    if (phases.includes(1)) {
      data.insiderTrading = await this.getInsiderTrading(symbol);
      data.institutionalOwnership = await this.getInstitutionalOwnership(symbol);
      data.analystEstimates = await this.getAnalystEstimates(symbol);
    }

    // Phase 2
    if (phases.includes(2)) {
      data.earningsSurprises = await this.getEarningsSurprises(symbol);
      data.priceTargets = await this.getPriceTargets(symbol);
    }

    // Phase 3 - placeholder for future implementation
    if (phases.includes(3)) {
      // SEC filings, ETF holdings, balance sheet
      data.phase3 = { note: 'Phase 3 data to be implemented' };
    }

    return data;
  }

  /**
   * Analyze insider trading signals
   */
  analyzeInsiderTrading(insiderData) {
    if (!insiderData || insiderData.length === 0) {
      return { signal: 'neutral', score: 0, reason: 'No insider data' };
    }

    // Last 90 days
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 90);

    const recentTrades = insiderData.filter(t =>
      new Date(t.filing_date || t.filingDate) > recentDate
    );

    let buyCount = 0;
    let sellCount = 0;
    let buyValue = 0;
    let sellValue = 0;

    recentTrades.forEach(trade => {
      const type = (trade.transaction_type || trade.transactionType || '').toLowerCase();
      const value = Math.abs((trade.securities_transacted || trade.securitiesTransacted || 0) * (trade.price || 0));

      if (type.includes('buy') || type.includes('purchase')) {
        buyCount++;
        buyValue += value;
      } else if (type.includes('sell') || type.includes('sale')) {
        sellCount++;
        sellValue += value;
      }
    });

    // Calculate signal
    if (buyCount >= 3 && buyValue > sellValue * 2) {
      return { signal: 'bullish', score: 8, reason: `${buyCount} insider buys, $${(buyValue/1e6).toFixed(1)}M total` };
    } else if (sellCount >= 5 && sellValue > buyValue * 3) {
      return { signal: 'bearish', score: -6, reason: `${sellCount} insider sells, $${(sellValue/1e6).toFixed(1)}M total` };
    }

    return { signal: 'neutral', score: 0, reason: 'Mixed insider activity' };
  }

  /**
   * Analyze institutional ownership changes
   */
  analyzeInstitutionalOwnership(institutionalData) {
    if (!institutionalData || institutionalData.length === 0) {
      return { signal: 'neutral', score: 0, reason: 'No institutional data' };
    }

    // Look at top 10 holders
    const topHolders = institutionalData.slice(0, 10);

    let increasingCount = 0;
    let decreasingCount = 0;
    let totalChangePercent = 0;

    topHolders.forEach(holder => {
      const change = holder.change_percent || holder.changePercent || 0;
      totalChangePercent += change;

      if (change > 5) increasingCount++;
      else if (change < -5) decreasingCount++;
    });

    const avgChange = totalChangePercent / topHolders.length;

    if (increasingCount >= 6 && avgChange > 10) {
      return { signal: 'bullish', score: 7, reason: `${increasingCount}/10 top institutions increasing positions` };
    } else if (decreasingCount >= 6 && avgChange < -10) {
      return { signal: 'bearish', score: -7, reason: `${decreasingCount}/10 top institutions decreasing positions` };
    }

    return { signal: 'neutral', score: 0, reason: 'Mixed institutional activity' };
  }

  /**
   * Analyze analyst estimate revisions
   */
  analyzeAnalystEstimates(estimatesData) {
    if (!estimatesData || estimatesData.length < 2) {
      return { signal: 'neutral', score: 0, reason: 'Insufficient estimate data' };
    }

    // Compare latest vs previous quarter
    const latest = estimatesData[0];
    const previous = estimatesData[1];

    const latestEPS = latest.estimated_eps_avg || latest.estimatedEpsAvg || 0;
    const previousEPS = previous.estimated_eps_avg || previous.estimatedEpsAvg || 0;

    if (previousEPS === 0) {
      return { signal: 'neutral', score: 0, reason: 'No baseline for comparison' };
    }

    const epsChange = ((latestEPS - previousEPS) / Math.abs(previousEPS)) * 100;

    if (epsChange > 10) {
      return { signal: 'bullish', score: 6, reason: `EPS estimates revised up ${epsChange.toFixed(1)}%` };
    } else if (epsChange < -10) {
      return { signal: 'bearish', score: -6, reason: `EPS estimates revised down ${epsChange.toFixed(1)}%` };
    }

    return { signal: 'neutral', score: 0, reason: 'Stable estimates' };
  }
}

export default new AdvancedFMPScreener();
