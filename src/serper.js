import axios from 'axios';
import dotenv from 'dotenv';
import * as db from './db.js';

dotenv.config();

const SERPER_API_KEY = process.env.SERPER_API_KEY;

class SerperAPI {
  constructor() {
    this.baseURL = 'https://google.serper.dev';
    this.defaultTTL = Number(process.env.SERPER_CACHE_TTL_MS || 10 * 60 * 1000);
    this.cache = new Map();
    this.cooldownUntil = 0;
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

  getCacheKey(query, options = {}) {
    return JSON.stringify({
      engine: options.engine || 'search',
      query,
      maxResults: options.maxResults || 5,
      timeRange: options.timeRange || null,
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

  isNonFatalAvailabilityError(error) {
    const status = Number(error?.response?.status || 0);
    return [401, 403, 429].includes(status);
  }

  getCooldownMs(status) {
    if (status === 429) return 15 * 60 * 1000;
    if (status === 401 || status === 403) return 60 * 60 * 1000;
    return 10 * 60 * 1000;
  }

  shouldShortCircuit() {
    return this.cooldownUntil > Date.now();
  }

  activateCooldown(status) {
    this.cooldownUntil = Date.now() + this.getCooldownMs(status);
  }

  mapOrganicResults(results = []) {
    return results.map(item => ({
      title: item.title || '',
      url: item.link || '',
      content: item.snippet || '',
      published_date: item.date || null
    })).filter(item => item.title || item.url || item.content);
  }

  mapNewsResults(results = []) {
    return results.map(item => ({
      title: item.title || '',
      url: item.link || '',
      content: item.snippet || '',
      published_date: item.date || null,
      source: item.source || null
    })).filter(item => item.title || item.url || item.content);
  }

  filterDomainResults(results = [], options = {}) {
    const includeDomains = (options.includeDomains || []).map(domain => String(domain).toLowerCase());
    const excludeDomains = (options.excludeDomains || []).map(domain => String(domain).toLowerCase());

    return results.filter(result => {
      const url = String(result.url || '').toLowerCase();
      if (includeDomains.length && !includeDomains.some(domain => url.includes(domain))) {
        return false;
      }
      if (excludeDomains.some(domain => url.includes(domain))) {
        return false;
      }
      return true;
    });
  }

  buildRequestPayload(query, options = {}) {
    const payload = {
      q: query,
      num: Math.min(Math.max(Number(options.maxResults || 5), 1), 10)
    };

    if (options.timeRange) {
      payload.tbs = this.mapTimeRange(options.timeRange);
    }

    return payload;
  }

  mapTimeRange(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['day', 'd'].includes(normalized)) return 'qdr:d';
    if (['week', 'w'].includes(normalized)) return 'qdr:w';
    if (['month', 'm'].includes(normalized)) return 'qdr:m';
    if (['year', 'y'].includes(normalized)) return 'qdr:y';
    return undefined;
  }

  async search(query, options = {}) {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return [];

    if (!SERPER_API_KEY) {
      console.warn('Serper API key missing; skipping Serper search.');
      return [];
    }

    if (this.shouldShortCircuit()) {
      console.warn(`Serper search skipped during cooldown for query: ${normalizedQuery}`);
      return [];
    }

    const cacheTtlMs = options.cacheTtlMs ?? this.defaultTTL;
    const useCache = options.useCache !== false;
    const cacheKey = this.getCacheKey(normalizedQuery, options);

    if (useCache) {
      const cached = this.getCachedResult(cacheKey);
      if (cached) {
        await db.logSerperUsageEvent({
          activity: options.activity || 'unspecified',
          symbol: options.symbol || null,
          query: normalizedQuery,
          searchType: options.engine || 'search',
          maxResults: options.maxResults || 5,
          resultCount: Array.isArray(cached) ? cached.length : 0,
          cacheHit: true,
          context: options.context || {}
        });
        return cached;
      }
    }

    const engine = options.engine === 'news' ? 'news' : 'search';
    const endpoint = `${this.baseURL}/${engine}`;

    try {
      const response = await axios.post(
        endpoint,
        this.buildRequestPayload(normalizedQuery, options),
        {
          headers: {
            'X-API-KEY': SERPER_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );

      const rawResults = engine === 'news'
        ? this.mapNewsResults(response.data?.news || [])
        : this.mapOrganicResults(response.data?.organic || []);
      const results = this.filterDomainResults(rawResults, options).slice(0, options.maxResults || 5);

      if (useCache && cacheTtlMs > 0) {
        this.setCachedResult(cacheKey, results, cacheTtlMs);
      }

      await db.logSerperUsageEvent({
        activity: options.activity || 'unspecified',
        symbol: options.symbol || null,
        query: normalizedQuery,
        searchType: engine,
        maxResults: options.maxResults || 5,
        resultCount: Array.isArray(results) ? results.length : 0,
        cacheHit: false,
        context: options.context || {}
      });

      return results;
    } catch (error) {
      const responseStatus = error?.response?.status;
      const responseDetail = error?.response?.data || null;
      console.error('Serper search error:', {
        message: error.message,
        query: normalizedQuery,
        engine,
        responseStatus,
        responseDetail
      });

      if (this.isNonFatalAvailabilityError(error)) {
        this.activateCooldown(responseStatus);
        console.warn(`Serper unavailable (status ${responseStatus}); returning empty results for now.`);
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

  async searchStockNews(symbol, maxResults = 5, options = {}) {
    const ticker = this.normalizeSymbolToken(symbol);
    const query = `${ticker} stock news latest`;
    return await this.search(query, {
      engine: 'news',
      maxResults,
      timeRange: options.timeRange || 'week',
      ...options
    });
  }

  async searchMarketNews(maxResults = 5, options = {}) {
    return await this.search('stock market news today', {
      engine: 'news',
      timeRange: options.timeRange || 'day',
      maxResults,
      ...options
    });
  }

  async searchNews(query, maxResults = 5, options = {}) {
    return await this.search(query, {
      engine: 'news',
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
      { query: `${identity} earnings guidance outlook`, options: { maxResults: 2, engine: 'news' } },
      { query: `${identity} analyst upgrade downgrade price target`, options: { maxResults: 2, engine: 'news' } },
      { query: `${identity} partnership deal product launch customer announcement`, options: { maxResults: 2, engine: 'news' } },
      { query: `${identity} litigation investigation recall management change`, options: { maxResults: 2, engine: 'news' } },
      { query: `${ticker} latest stock news earnings guidance analyst`, options: { maxResults: 2, engine: 'news' } }
    ], {
      activity: 'stock_context',
      symbol,
      maxResults,
      timeRange: options.timeRange || 'month',
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
      engine: 'news',
      activity: 'monitoring_context',
      symbol,
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
      { query: `${identity} earnings preview`, options: { maxResults: 5, includeDomains, engine: 'news' } },
      { query: `${identity} guidance outlook consensus estimates analyst expectations`, options: { maxResults: 5, includeDomains, engine: 'news' } },
      { query: `${identity} margin outlook revenue outlook EPS outlook`, options: { maxResults: 4, includeDomains, engine: 'news' } },
      { query: `${identity} analyst expectations price target sentiment`, options: { maxResults: 4, includeDomains, engine: 'news' } },
      { query: `${ticker} earnings preview`, options: { maxResults: 4, engine: 'news' } }
    ], {
      activity: 'earnings_context',
      symbol,
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
      engine: 'news',
      activity: 'premarket_context',
      symbol,
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
      engine: 'news',
      timeRange: options.timeRange || 'week',
      maxResults,
      includeDomains: options.includeDomains || []
    });
  }

  async searchSectorNews(sector, maxResults = 3, options = {}) {
    const query = `${sector} sector stocks news`;
    return await this.search(query, {
      engine: 'news',
      maxResults,
      timeRange: options.timeRange || 'week',
      ...options
    });
  }

  formatResults(results) {
    if (!results || results.length === 0) {
      return 'No recent news found.';
    }

    return results.map((result, index) => `${index + 1}. ${result.title}
   Source: ${result.url}
   Summary: ${result.content}
   Published: ${result.published_date || 'Recent'}`).join('\n\n');
  }
}

export default new SerperAPI();
