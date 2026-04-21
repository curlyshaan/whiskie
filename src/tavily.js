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
      const response = await axios.post(`${this.baseURL}/search`, {
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
      });

      const results = response.data.results || [];
      if (useCache && cacheTtlMs > 0) {
        this.setCachedResult(cacheKey, results, cacheTtlMs);
      }

      return results;
    } catch (error) {
      console.error('Tavily search error:', error.message);
      throw error;
    }
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
    const identity = companyName ? `"${companyName}" OR ${symbol}` : symbol;
    const query = [
      `${identity} earnings guidance`,
      `${identity} analyst downgrade OR analyst upgrade OR price target`,
      `${identity} product launch OR customer announcement OR partnership OR deal`,
      `${identity} litigation OR investigation OR recall OR management change`
    ].join(' OR ');

    return await this.search(query, {
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
    const identity = companyName ? `"${companyName}" OR ${symbol}` : symbol;
    const query = [
      `${identity} earnings preview`,
      `${identity} guidance OR outlook`,
      `${identity} consensus estimates OR analyst expectations`,
      `${identity} margin outlook OR subscription growth OR pipeline`,
      `${identity} revenue outlook OR EPS outlook`
    ].join(' OR ');

    return await this.search(query, {
      depth: options.depth || 'advanced',
      topic: options.topic || 'news',
      timeRange: options.timeRange || 'week',
      maxResults,
      includeDomains: options.includeDomains || [
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
      ]
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
