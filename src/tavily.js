import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

/**
 * Tavily Search API Wrapper
 * Handles news and web search
 */
class TavilyAPI {
  constructor() {
    this.baseURL = 'https://api.tavily.com';
    this.defaultTTL = Number(process.env.TAVILY_CACHE_TTL_MS || 10 * 60 * 1000);
    this.cache = new Map();
  }

  /**
   * Search for news and information
   */
  getCacheKey(query, options = {}) {
    return JSON.stringify({
      query,
      depth: options.depth || 'basic',
      topic: options.topic || 'general',
      maxResults: options.maxResults || 5,
      timeRange: options.timeRange || null,
      startDate: options.startDate || null,
      endDate: options.endDate || null,
      includeDomains: options.includeDomains || [],
      excludeDomains: options.excludeDomains || []
    });
  }

  getCachedResult(cacheKey) {
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.cache.delete(cacheKey);
      return null;
    }
    return cached.results;
  }

  setCachedResult(cacheKey, results, ttlMs = this.defaultTTL) {
    this.cache.set(cacheKey, {
      results,
      expiresAt: Date.now() + ttlMs
    });
  }

  async search(query, options = {}) {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return [];

    const cacheTtlMs = options.cacheTtlMs ?? this.defaultTTL;
    const useCache = options.useCache !== false;
    const cacheKey = this.getCacheKey(normalizedQuery, options);

    if (useCache) {
      const cached = this.getCachedResult(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      const payload = {
        api_key: TAVILY_API_KEY,
        query: normalizedQuery,
        search_depth: options.depth || 'basic',
        topic: options.topic || 'general',
        max_results: options.maxResults || 5,
        time_range: options.timeRange || undefined,
        start_date: options.startDate || undefined,
        end_date: options.endDate || undefined,
        include_domains: options.includeDomains || [],
        exclude_domains: options.excludeDomains || []
      };

      const response = await axios.post(`${this.baseURL}/search`, payload);

      const results = response.data.results || [];
      if (useCache && cacheTtlMs > 0) {
        this.setCachedResult(cacheKey, results, cacheTtlMs);
      }

      return results;
    } catch (error) {
      console.error('Tavily search error:', error.message, {
        query: normalizedQuery,
        options: {
          depth: options.depth || 'basic',
          topic: options.topic || 'general',
          maxResults: options.maxResults || 5,
          timeRange: options.timeRange || undefined,
          includeDomains: options.includeDomains || [],
          excludeDomains: options.excludeDomains || []
        },
        responseStatus: error?.response?.status,
        responseBody: error?.response?.data || null
      });
      throw error;
    }
  }

  async searchWithFallbacks(queryBuilders = [], baseOptions = {}) {
    let lastError = null;

    for (const builder of queryBuilders) {
      if (!builder) continue;
      const built = typeof builder === 'function' ? builder() : builder;
      const nextQuery = String(built?.query || '').trim();
      if (!nextQuery) continue;
      const nextOptions = { ...baseOptions, ...(built?.options || {}) };

      try {
        return await this.search(nextQuery, nextOptions);
      } catch (error) {
        lastError = error;
        if (error?.response?.status !== 400) {
          throw error;
        }
      }
    }

    if (lastError) throw lastError;
    return [];
  }

  mergeSearchResults(resultsList = [], maxResults = 5) {
    const merged = [];
    const seen = new Set();

    for (const results of resultsList) {
      for (const result of results || []) {
        if (!result) continue;
        const key = `${result.url || ''}::${result.title || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(result);
        if (merged.length >= maxResults) {
          return merged;
        }
      }
    }

    return merged;
  }

  async searchMany(queries = [], baseOptions = {}) {
    const normalizedQueries = queries
      .map(entry => {
        const built = typeof entry === 'function' ? entry() : entry;
        const query = String(built?.query || '').trim();
        if (!query) return null;
        return {
          query,
          options: { ...baseOptions, ...(built?.options || {}) }
        };
      })
      .filter(Boolean);

    if (!normalizedQueries.length) return [];

    const settled = await Promise.allSettled(
      normalizedQueries.map(item => this.searchWithFallbacks([{ query: item.query, options: item.options }], item.options))
    );

    const fulfilled = settled
      .filter(item => item.status === 'fulfilled')
      .map(item => item.value);

    if (fulfilled.length) {
      return this.mergeSearchResults(fulfilled, baseOptions.maxResults || 5);
    }

    const firstRejected = settled.find(item => item.status === 'rejected');
    if (firstRejected) {
      throw firstRejected.reason;
    }

    return [];
  }

  /**
   * Search for stock-specific news
   */
  async searchStockNews(symbol, maxResults = 5, options = {}) {
    const query = `${symbol} stock news latest`;
    return await this.search(query, {
      maxResults,
      depth: options.depth || 'basic',
      topic: options.topic || 'news',
      timeRange: options.timeRange || 'week',
      ...options
    });
  }

  /**
   * Search for market news
   */
  async searchMarketNews(maxResults = 5, options = {}) {
    return await this.search('stock market news today', {
      depth: options.depth || 'basic',
      topic: options.topic || 'news',
      timeRange: options.timeRange || 'day',
      maxResults,
      ...options
    });
  }

  /**
   * Generic news search (missing method referenced in weekly-review.js)
   */
  async searchNews(query, maxResults = 5, options = {}) {
    return await this.search(query, {
      depth: options.depth || 'basic',
      topic: options.topic || 'news',
      timeRange: options.timeRange || 'week',
      maxResults,
      ...options
    });
  }

  async searchStructuredStockContext(symbol, options = {}) {
    const maxResults = options.maxResults || 5;
    const companyName = String(options.companyName || '').trim();
    const identity = companyName ? `"${companyName}" ${symbol}` : symbol;

    return await this.searchMany([
      { query: `${identity} earnings guidance outlook`, options: { maxResults: 2 } },
      { query: `${identity} analyst upgrade downgrade price target`, options: { maxResults: 2, includeDomains: [] } },
      { query: `${identity} partnership deal product launch customer announcement`, options: { maxResults: 2, includeDomains: [] } },
      { query: `${identity} litigation investigation recall management change`, options: { maxResults: 2, includeDomains: [] } },
      { query: `${symbol} latest stock news earnings guidance analyst`, options: { maxResults: 2, includeDomains: [] } }
    ], {
      depth: options.depth || 'advanced',
      topic: options.topic || 'news',
      timeRange: options.timeRange || 'month',
      maxResults,
      includeDomains: options.includeDomains || []
    });
  }

  async searchStructuredMonitoringContext(symbol, options = {}) {
    const maxResults = options.maxResults || 4;
    const query = [
      `${symbol} earnings guidance OR outlook`,
      `${symbol} analyst upgrade OR analyst downgrade OR price target`,
      `${symbol} product launch OR customer announcement OR partnership`,
      `${symbol} litigation OR investigation OR recall OR management change`
    ].join(' OR ');

    return await this.search(query, {
      depth: options.depth || 'advanced',
      topic: options.topic || 'news',
      timeRange: options.timeRange || 'month',
      maxResults,
      includeDomains: options.includeDomains || []
    });
  }

  async searchStructuredEarningsContext(symbol, options = {}) {
    const maxResults = options.maxResults || 5;
    const companyName = String(options.companyName || '').trim();
    const includeDomains = options.includeDomains || [
      'reuters.com',
      'cnbc.com',
      'marketwatch.com',
      'investing.com',
      'finance.yahoo.com',
      'barrons.com',
      'thestreet.com',
      'benzinga.com',
      'fool.com',
      'seekingalpha.com'
    ];
    const identity = companyName ? `"${companyName}" ${symbol}` : symbol;

    return await this.searchMany([
      { query: `${identity} earnings preview`, options: { maxResults: 5, includeDomains } },
      { query: `${identity} guidance outlook consensus estimates analyst expectations`, options: { maxResults: 5, includeDomains } },
      { query: `${identity} margin outlook revenue outlook EPS outlook`, options: { maxResults: 4, includeDomains } },
      { query: `${identity} analyst expectations price target sentiment`, options: { maxResults: 4, includeDomains } },
      { query: `${symbol} earnings preview`, options: { maxResults: 4, includeDomains: [] } }
    ], {
      depth: options.depth || 'advanced',
      topic: options.topic || 'news',
      timeRange: options.timeRange || 'week',
      maxResults,
      includeDomains
    });
  }

  async searchStructuredPremarketContext(symbol, options = {}) {
    const maxResults = options.maxResults || 2;
    const query = [
      `${symbol} premarket move`,
      `${symbol} earnings OR guidance OR analyst`,
      `${symbol} upgrade OR downgrade OR price target`,
      `${symbol} merger OR acquisition OR investigation`
    ].join(' OR ');

    return await this.search(query, {
      depth: options.depth || 'basic',
      topic: options.topic || 'news',
      timeRange: options.timeRange || 'day',
      maxResults,
      includeDomains: options.includeDomains || []
    });
  }

  async searchStructuredMacroContext(options = {}) {
    const maxResults = options.maxResults || 5;
    const query = [
      'Federal Reserve interest rates',
      'inflation CPI PPI',
      'jobs unemployment payrolls',
      'earnings season guidance'
    ].join(' OR ');

    return await this.search(query, {
      depth: options.depth || 'advanced',
      topic: options.topic || 'news',
      timeRange: options.timeRange || 'week',
      maxResults,
      includeDomains: options.includeDomains || []
    });
  }

  /**
   * Search for sector news
   */
  async searchSectorNews(sector, maxResults = 3, options = {}) {
    const query = `${sector} sector stocks news`;
    return await this.search(query, {
      maxResults,
      depth: options.depth || 'basic',
      topic: options.topic || 'news',
      timeRange: options.timeRange || 'week',
      ...options
    });
  }

  /**
   * Format search results for Claude
   */
  formatResults(results) {
    if (!results || results.length === 0) {
      return 'No recent news found.';
    }

    return results.map((result, index) => {
      return `${index + 1}. ${result.title}
   Source: ${result.url}
   Summary: ${result.content}
   Published: ${result.published_date || 'Recent'}`;
    }).join('\n\n');
  }
}

export default new TavilyAPI();
