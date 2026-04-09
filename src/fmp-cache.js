import * as db from './db.js';
import fmp from './fmp.js';

/**
 * FMP Data Caching System
 * Caches fundamental data quarterly to reduce API calls
 *
 * Strategy:
 * - Fundamental metrics change quarterly (earnings reports)
 * - Cache data for 90 days, refresh on next screening
 * - Reduces weekly API calls from 814 to ~50 (only new/stale data)
 */

class FMPCache {
  constructor() {
    this.CACHE_DURATION_DAYS = 90; // 3 months
  }

  /**
   * Initialize cache table
   */
  async initDatabase() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS fmp_cache (
        symbol VARCHAR(10) PRIMARY KEY,
        data JSONB NOT NULL,
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL
      )
    `);

    // Create index for expiration queries
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_fmp_cache_expires
      ON fmp_cache(expires_at)
    `);

    console.log('✅ FMP cache table initialized');
  }

  /**
   * Get cached fundamentals or fetch fresh data
   */
  async getFundamentals(symbol) {
    // Check cache first
    const cached = await this.getCached(symbol);
    if (cached) {
      return cached;
    }

    // Cache miss - fetch from FMP
    const data = await fmp.getFundamentals(symbol);
    if (data) {
      await this.cache(symbol, data);
    }

    return data;
  }

  /**
   * Get cached data if not expired
   */
  async getCached(symbol) {
    const result = await db.query(
      `SELECT data FROM fmp_cache
       WHERE symbol = $1 AND expires_at > NOW()`,
      [symbol]
    );

    if (result.rows.length > 0) {
      return result.rows[0].data;
    }

    return null;
  }

  /**
   * Cache fundamental data
   */
  async cache(symbol, data) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.CACHE_DURATION_DAYS);

    await db.query(
      `INSERT INTO fmp_cache (symbol, data, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (symbol)
       DO UPDATE SET
         data = $2,
         cached_at = CURRENT_TIMESTAMP,
         expires_at = $3`,
      [symbol, JSON.stringify(data), expiresAt]
    );
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    const stats = await db.query(`
      SELECT
        COUNT(*) as total_cached,
        COUNT(*) FILTER (WHERE expires_at > NOW()) as valid,
        COUNT(*) FILTER (WHERE expires_at <= NOW()) as expired
      FROM fmp_cache
    `);

    return stats.rows[0] || { total_cached: 0, valid: 0, expired: 0 };
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
   * Batch fetch fundamentals with caching
   * Returns { cached, fetched, failed }
   */
  async batchGetFundamentals(symbols) {
    const results = {
      cached: 0,
      fetched: 0,
      failed: 0,
      data: {}
    };

    for (const symbol of symbols) {
      try {
        const data = await this.getFundamentals(symbol);

        if (data) {
          results.data[symbol] = data;

          // Check if it was cached
          const wasCached = await this.getCached(symbol);
          if (wasCached) {
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

    return results;
  }

  /**
   * Warm cache for all stocks in universe
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

    return results;
  }
}

export default new FMPCache();
