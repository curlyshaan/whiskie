import * as db from './db.js';
import fmp from './fmp.js';

/**
 * FMP Data Caching System
 * Tiered caching strategy based on data volatility
 *
 * Strategy:
 * - TTM ratios (price-dependent): 1-day cache
 * - Quarterly statements: 45-day cache (updates at earnings)
 * - Annual context data: 90-day cache
 * - Reduces API calls while keeping price-sensitive data fresh
 */

class FMPCache {
  constructor() {
    // Tiered cache durations based on data volatility
    this.CACHE_TIERS = {
      TTM: 1,           // TTM ratios change with price (1 day)
      QUARTERLY: 45,    // Quarterly data updates at earnings (45 days)
      ANNUAL: 90        // Annual context rarely changes (90 days)
    };
  }

  /**
   * Initialize cache table with tiered structure
   */
  async initDatabase() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS fmp_cache (
        symbol VARCHAR(10) NOT NULL,
        data_type VARCHAR(20) NOT NULL,
        data JSONB NOT NULL,
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        PRIMARY KEY (symbol, data_type)
      )
    `);

    // Create index for expiration queries
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_fmp_cache_expires
      ON fmp_cache(expires_at)
    `);

    console.log('✅ FMP cache table initialized with tiered structure');
  }

  /**
   * Get cached data by type (TTM/QUARTERLY/ANNUAL)
   */
  async getCached(symbol, dataType = 'QUARTERLY') {
    const result = await db.query(
      `SELECT data FROM fmp_cache
       WHERE symbol = $1 AND data_type = $2 AND expires_at > NOW()`,
      [symbol, dataType]
    );

    if (result.rows.length > 0) {
      return result.rows[0].data;
    }

    return null;
  }

  /**
   * Cache data with appropriate tier
   */
  async cache(symbol, data, dataType = 'QUARTERLY') {
    const cacheDays = this.CACHE_TIERS[dataType] || this.CACHE_TIERS.QUARTERLY;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + cacheDays);

    await db.query(
      `INSERT INTO fmp_cache (symbol, data_type, data, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (symbol, data_type)
       DO UPDATE SET
         data = $3,
         cached_at = CURRENT_TIMESTAMP,
         expires_at = $4`,
      [symbol, dataType, JSON.stringify(data), expiresAt]
    );
  }

  /**
   * Get fundamentals with tiered caching
   */
  async getFundamentals(symbol) {
    try {
      // Check cache for each data type
      const cachedTTM = await this.getCached(symbol, 'TTM');
      const cachedQuarterly = await this.getCached(symbol, 'QUARTERLY');
      const cachedAnnual = await this.getCached(symbol, 'ANNUAL');

      // If all cached, return combined data
      if (cachedTTM && cachedQuarterly && cachedAnnual) {
        return { ...cachedAnnual, ...cachedQuarterly, ...cachedTTM };
      }

      // Fetch missing data from FMP
      const data = await fmp.getFundamentals(symbol);
      if (!data) return null;

      // Cache each tier separately
      // TTM data (price-dependent ratios)
      const ttmData = {
        peRatio: data.peRatio,
        pegRatio: data.pegRatio,
        priceToBook: data.priceToBook,
        priceToSales: data.priceToSales,
        evToEbitda: data.evToEbitda,
        currentPrice: data.currentPrice
      };
      await this.cache(symbol, ttmData, 'TTM');

      // Quarterly data (earnings-dependent)
      const quarterlyData = {
        revenueGrowth: data.revenueGrowth,
        earningsGrowth: data.earningsGrowth,
        operatingMargin: data.operatingMargin,
        profitMargin: data.profitMargin,
        roe: data.roe,
        roic: data.roic,
        freeCashflow: data.freeCashflow
      };
      await this.cache(symbol, quarterlyData, 'QUARTERLY');

      // Annual data (rarely changes)
      const annualData = {
        symbol: data.symbol,
        companyName: data.companyName,
        sector: data.sector,
        industry: data.industry,
        marketCap: data.marketCap,
        description: data.description
      };
      await this.cache(symbol, annualData, 'ANNUAL');

      return data;

    } catch (error) {
      console.error(`Error in tiered cache for ${symbol}:`, error.message);
      // Fallback to direct FMP call
      return await fmp.getFundamentals(symbol);
    }
  }

  /**
   * Get cache statistics with tier breakdown
   */
  async getCacheStats() {
    const stats = await db.query(`
      SELECT
        data_type,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE expires_at > NOW()) as valid,
        COUNT(*) FILTER (WHERE expires_at <= NOW()) as expired
      FROM fmp_cache
      GROUP BY data_type
    `);

    const tierStats = {
      TTM: { total: 0, valid: 0, expired: 0 },
      QUARTERLY: { total: 0, valid: 0, expired: 0 },
      ANNUAL: { total: 0, valid: 0, expired: 0 }
    };

    stats.rows.forEach(row => {
      if (tierStats[row.data_type]) {
        tierStats[row.data_type] = {
          total: parseInt(row.total),
          valid: parseInt(row.valid),
          expired: parseInt(row.expired)
        };
      }
    });

    return tierStats;
  }

  /**
   * Clear expired cache entries
   */
  async clearExpired() {
    const result = await db.query(
      `DELETE FROM fmp_cache WHERE expires_at <= NOW() RETURNING symbol`
    );

    const cleared = result.rows || [];
    if (cleared.length > 0) {
      console.log(`🗑️ Cleared ${cleared.length} expired FMP cache entries`);
    }

    return cleared.length;
  }

  /**
   * Batch fetch fundamentals with tiered caching
   * Returns { cached, fetched, failed, cacheHitRate }
   */
  async batchGetFundamentals(symbols) {
    const results = {
      cached: 0,
      fetched: 0,
      failed: 0,
      data: {},
      cacheHitRate: 0
    };

    for (const symbol of symbols) {
      try {
        // Check if all tiers are cached
        const cachedTTM = await this.getCached(symbol, 'TTM');
        const cachedQuarterly = await this.getCached(symbol, 'QUARTERLY');
        const cachedAnnual = await this.getCached(symbol, 'ANNUAL');

        const fullyCached = cachedTTM && cachedQuarterly && cachedAnnual;

        const data = await this.getFundamentals(symbol);

        if (data) {
          results.data[symbol] = data;

          if (fullyCached) {
            results.cached++;
          } else {
            results.fetched++;
          }
        } else {
          results.failed++;
        }
      } catch (error) {
        console.warn(`⚠️ Error fetching ${symbol}:`, error.message);
        results.failed++;
      }
    }

    // Calculate cache hit rate
    const total = results.cached + results.fetched;
    results.cacheHitRate = total > 0 ? (results.cached / total * 100).toFixed(1) : 0;

    return results;
  }

  /**
   * Warm cache for all stocks in universe with tiered caching
   * Run this during off-peak hours to pre-populate cache
   */
  async warmCache(symbols) {
    console.log(`🔥 Warming FMP cache for ${symbols.length} symbols...`);
    const startTime = Date.now();

    const results = await this.batchGetFundamentals(symbols);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Cache warming complete (${duration}s)`);
    console.log(`   Cached: ${results.cached}`);
    console.log(`   Fetched: ${results.fetched}`);
    console.log(`   Failed: ${results.failed}`);
    console.log(`   Cache hit rate: ${results.cacheHitRate}%`);

    return results;
  }
}

export default new FMPCache();
