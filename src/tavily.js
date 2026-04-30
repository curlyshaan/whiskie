import axios from 'axios';
import dotenv from 'dotenv';
import * as db from './db.js';

dotenv.config();

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

async function logTavilyUsage(payload = {}) {
  if (typeof db.logTavilyUsageEvent === 'function') {
    return await db.logTavilyUsageEvent(payload);
  }
}

/**
 * Tavily Search API Wrapper
 * Handles news and web search
 */
class TavilyAPI {
  constructor() {
    this.baseURL = 'https://api.tavily.com';
    this.defaultTTL = Number(process.env.TAVILY_CACHE_TTL_MS || 10 * 60 * 1000);
    this.cache = new Map();
    this.cooldownUntil = 0;
  }

  isNonFatalAvailabilityError(error) {
    const status = Number(error?.response?.status || 0);
    return [401, 429, 432, 433].includes(status);
  }

  getCooldownMs(status) {
    if (status === 429) return 15 * 60 * 1000;
    if (status === 432 || status === 433) return 60 * 60 * 1000;
    if (status === 401) return 60 * 60 * 1000;
    return 10 * 60 * 1000;
  }

  getErrorDetail(error) {
    const responseBody = error?.response?.data;
    return typeof responseBody?.detail?.error === 'string'
      ? responseBody.detail.error
      : (typeof responseBody?.detail === 'string' ? responseBody.detail : null);
  }

  shouldShortCircuit() {
    return this.cooldownUntil > Date.now();
  }

  activateCooldown(status) {
    this.cooldownUntil = Date.now() + this.getCooldownMs(status);
  }

  normalizeSymbolToken(symbol) {
    const normalized = String(symbol || '').trim().toUpperCase().replace(/^\$+/, '');
    if (!normalized) return '';
    return `$${normalized}`;
  }

  buildTickerIdentity(symbol, companyName = '') {
    const ticker = this.normalizeSymbolToken(symbol);
    const normalizedCompanyName = String(companyName || '').trim();
    if (!ticker) return normalizedCompanyName;
    return normalizedCompanyName ? `"${normalizedCompanyName}" ${ticker}` : ticker;
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

    if (!TAVILY_API_KEY) {
      console.warn('Tavily API key missing; skipping Tavily search.');
      return [];
    }

    if (this.shouldShortCircuit()) {
      console.warn(`Tavily search skipped during cooldown for query: ${normalizedQuery}`);
      return [];
    }

    const cacheTtlMs = options.cacheTtlMs ?? this.defaultTTL;
    const useCache = options.useCache !== false;
    const cacheKey = this.getCacheKey(normalizedQuery, options);

    if (useCache) {
      const cached = this.getCachedResult(cacheKey);
      if (cached) {
        await logTavilyUsage({
          activity: options.activity || 'unspecified',
          symbol: options.symbol || null,
          query: normalizedQuery,
          topic: options.topic || 'general',
          searchDepth: options.depth || 'basic',
          maxResults: options.maxResults || 5,
          resultCount: Array.isArray(cached) ? cached.length : 0,
          cacheHit: true,
          context: options.context || {}
        });
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
        include_answer: options.includeAnswer ?? true,
        include_raw_content: options.includeRawContent ?? true,
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

      await logTavilyUsage({
        activity: options.activity || 'unspecified',
        symbol: options.symbol || null,
        query: normalizedQuery,
        topic: options.topic || 'general',
        searchDepth: options.depth || 'basic',
        maxResults: options.maxResults || 5,
        resultCount: Array.isArray(results) ? results.length : 0,
        cacheHit: false,
        context: options.context || {}
      });

      return results;
    } catch (error) {
      const responseStatus = error?.response?.status;
      const responseDetail = this.getErrorDetail(error);
      console.error('Tavily search error:', {
        message: error.message,
        query: normalizedQuery,
        options: {
          depth: options.depth || 'basic',
          topic: options.topic || 'general',
          maxResults: options.maxResults || 5,
          timeRange: options.timeRange || undefined,
          includeDomains: options.includeDomains || [],
          excludeDomains: options.excludeDomains || []
        },
        responseStatus,
        responseDetail
      });

      if (this.isNonFatalAvailabilityError(error)) {
        this.activateCooldown(responseStatus);
        console.warn(`Tavily unavailable (status ${responseStatus}); returning empty results for now.`);
        return [];
      }

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
        if (this.isNonFatalAvailabilityError(error)) {
          return [];
        }
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
    const ticker = this.normalizeSymbolToken(symbol);
    const query = `${ticker} stock news latest`;
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
    const identity = this.buildTickerIdentity(symbol, companyName);
    const ticker = this.normalizeSymbolToken(symbol);

    return await this.searchMany([
      { query: `${identity} earnings guidance outlook`, options: { maxResults: 2 } },
      { query: `${identity} analyst upgrade downgrade price target`, options: { maxResults: 2, includeDomains: [] } },
      { query: `${identity} partnership deal product launch customer announcement`, options: { maxResults: 2, includeDomains: [] } },
      { query: `${identity} litigation investigation recall management change`, options: { maxResults: 2, includeDomains: [] } },
      { query: `${ticker} latest stock news earnings guidance analyst`, options: { maxResults: 2, includeDomains: [] } }
    ], {
      activity: 'stock_context',
      symbol,
      depth: options.depth || 'advanced',
      topic: options.topic || 'news',
      includeAnswer: options.includeAnswer ?? true,
      includeRawContent: options.includeRawContent ?? true,
      timeRange: options.timeRange || 'month',
      maxResults,
      context: options.context || {},
      includeDomains: options.includeDomains || []
    });
  }

  async searchStructuredMonitoringContext(symbol, options = {}) {
    const maxResults = options.maxResults || 4;
    const ticker = this.normalizeSymbolToken(symbol);
    const query = [
      `${ticker} earnings guidance OR outlook`,
      `${ticker} analyst upgrade OR analyst downgrade OR price target`,
      `${ticker} product launch OR customer announcement OR partnership`,
      `${ticker} litigation OR investigation OR recall OR management change`
    ].join(' OR ');

    return await this.search(query, {
      activity: 'monitoring_context',
      symbol,
      depth: options.depth || 'advanced',
      topic: options.topic || 'news',
      includeAnswer: options.includeAnswer ?? true,
      includeRawContent: options.includeRawContent ?? true,
      timeRange: options.timeRange || 'month',
      maxResults,
      context: options.context || {},
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
    const identity = this.buildTickerIdentity(symbol, companyName);
    const ticker = this.normalizeSymbolToken(symbol);

    return await this.searchMany([
      { query: `${identity} earnings preview`, options: { maxResults: 5, includeDomains } },
      { query: `${identity} guidance outlook consensus estimates analyst expectations`, options: { maxResults: 5, includeDomains } },
      { query: `${identity} margin outlook revenue outlook EPS outlook`, options: { maxResults: 4, includeDomains } },
      { query: `${identity} analyst expectations price target sentiment`, options: { maxResults: 4, includeDomains } },
      { query: `${ticker} earnings preview`, options: { maxResults: 4, includeDomains: [] } }
    ], {
      activity: 'earnings_context',
      symbol,
      depth: options.depth || 'advanced',
      topic: options.topic || 'news',
      includeAnswer: options.includeAnswer ?? true,
      includeRawContent: options.includeRawContent ?? true,
      timeRange: options.timeRange || 'week',
      maxResults,
      context: options.context || {},
      includeDomains
    });
  }

  async searchStructuredPremarketContext(symbol, options = {}) {
    const maxResults = options.maxResults || 2;
    const ticker = this.normalizeSymbolToken(symbol);
    const query = [
      `${ticker} premarket move`,
      `${ticker} earnings OR guidance OR analyst`,
      `${ticker} upgrade OR downgrade OR price target`,
      `${ticker} merger OR acquisition OR investigation`
    ].join(' OR ');

    return await this.search(query, {
      activity: 'premarket_context',
      symbol,
      depth: options.depth || 'basic',
      topic: options.topic || 'news',
      includeAnswer: options.includeAnswer ?? true,
      includeRawContent: options.includeRawContent ?? true,
      timeRange: options.timeRange || 'day',
      maxResults,
      context: options.context || {},
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
      includeAnswer: options.includeAnswer ?? true,
      includeRawContent: options.includeRawContent ?? true,
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
      includeAnswer: options.includeAnswer ?? true,
      includeRawContent: options.includeRawContent ?? true,
      timeRange: options.timeRange || 'week',
      ...options
    });
  }

  getHealthStatus() {
    return {
      provider: 'tavily',
      cooldownActive: this.shouldShortCircuit(),
      cooldownUntil: this.cooldownUntil ? new Date(this.cooldownUntil).toISOString() : null
    };
  }

  async getHealthAwareResults(searchPromiseFactory, options = {}) {
    try {
      const results = await searchPromiseFactory();
      return {
        ok: true,
        degraded: false,
        providerStatus: 'ok',
        warning: null,
        results,
        meta: {
          provider: 'tavily',
          activity: options.activity || 'unspecified',
          symbol: options.symbol || null,
          resultCount: Array.isArray(results) ? results.length : 0
        }
      };
    } catch (error) {
      const status = this.getHealthStatus();
      return {
        ok: false,
        degraded: true,
        providerStatus: status.cooldownActive ? 'cooldown' : 'error',
        warning: error.message,
        results: [],
        meta: status
      };
    }
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
