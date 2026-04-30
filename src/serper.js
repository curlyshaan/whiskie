import axios from 'axios';
import dotenv from 'dotenv';
import * as db from './db.js';

dotenv.config();

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const DEFAULT_FINANCE_DOMAINS = [
  'reuters.com',
  'cnbc.com',
  'marketwatch.com',
  'finance.yahoo.com',
  'investing.com',
  'barrons.com',
  'benzinga.com',
  'bloomberg.com'
];

const COMMENTARY_HEAVY_DOMAINS = [
  'marketbeat.com',
  'investorplace.com',
  'zacks.com'
];

const SOCIAL_NOISE_DOMAINS = [
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'youtube.com'
];

class SerperAPI {
  constructor() {
    this.baseURL = 'https://google.serper.dev';
    this.defaultTTL = Number(process.env.SERPER_CACHE_TTL_MS || 10 * 60 * 1000);
    this.cache = new Map();
    this.cooldownUntil = 0;
    this.lastStatus = this.buildStatus('idle');
  }

  buildStatus(status, extra = {}) {
    return {
      status,
      timestamp: new Date().toISOString(),
      cooldownUntil: this.cooldownUntil || null,
      ...extra
    };
  }

  setLastStatus(status, extra = {}) {
    this.lastStatus = this.buildStatus(status, extra);
    return this.lastStatus;
  }

  getStatus() {
    return {
      ...this.lastStatus,
      cooldownActive: this.shouldShortCircuit()
    };
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

  normalizeDomain(domain = '') {
    return String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  }

  getHostname(url = '') {
    try {
      return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return '';
    }
  }

  getCacheKey(query, options = {}) {
    return JSON.stringify({
      engine: options.engine || 'search',
      query,
      maxResults: options.maxResults || 5,
      timeRange: options.timeRange || null,
      includeDomains: (options.includeDomains || []).map(domain => this.normalizeDomain(domain)),
      excludeDomains: (options.excludeDomains || []).map(domain => this.normalizeDomain(domain)),
      activity: options.activity || null,
      context: options.context || null
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
    const includeDomains = (options.includeDomains || []).map(domain => this.normalizeDomain(domain)).filter(Boolean);
    const excludeDomains = (options.excludeDomains || []).map(domain => this.normalizeDomain(domain)).filter(Boolean);

    return results.filter(result => {
      const hostname = this.getHostname(result.url);
      if (includeDomains.length && !includeDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))) {
        return false;
      }
      if (excludeDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))) {
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

  buildResultMetadata(query, options = {}, extra = {}) {
    return {
      provider: 'serper',
      query: String(query || '').trim(),
      engine: options.engine === 'news' ? 'news' : 'search',
      activity: options.activity || 'unspecified',
      symbol: options.symbol || null,
      timeRange: options.timeRange || null,
      includeDomains: options.includeDomains || [],
      excludeDomains: options.excludeDomains || [],
      ...extra
    };
  }

  attachMetadata(results = [], metadata = {}) {
    Object.defineProperty(results, '_meta', {
      value: metadata,
      enumerable: false,
      configurable: true,
      writable: true
    });
    return results;
  }

  async logUsage(query, options, resultCount, cacheHit, status, extra = {}) {
    await db.logSerperUsageEvent({
      activity: options.activity || 'unspecified',
      symbol: options.symbol || null,
      query,
      searchType: options.engine || 'search',
      maxResults: options.maxResults || 5,
      resultCount: Array.isArray(resultCount) ? resultCount.length : Number(resultCount || 0),
      cacheHit,
      context: {
        ...(options.context || {}),
        providerStatus: status,
        ...extra
      }
    });
  }

  async search(query, options = {}) {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) {
      return this.attachMetadata([], this.buildResultMetadata(query, options, { providerStatus: 'empty_query' }));
    }

    if (!SERPER_API_KEY) {
      this.setLastStatus('misconfigured', { message: 'SERPER_API_KEY missing' });
      throw new Error('Serper API key missing');
    }

    if (this.shouldShortCircuit()) {
      const cooldownUntil = new Date(this.cooldownUntil).toISOString();
      this.setLastStatus('cooldown', { query: normalizedQuery, cooldownUntil });
      throw new Error(`Serper cooldown active until ${cooldownUntil}`);
    }

    const cacheTtlMs = options.cacheTtlMs ?? this.defaultTTL;
    const useCache = options.useCache !== false;
    const cacheKey = this.getCacheKey(normalizedQuery, options);

    if (useCache) {
      const cached = this.getCachedResult(cacheKey);
      if (cached) {
        await this.logUsage(normalizedQuery, options, cached.length, true, 'ok', { cacheHitSource: 'memory' });
        this.setLastStatus('ok', { query: normalizedQuery, cacheHit: true, resultCount: cached.length });
        return this.attachMetadata(cached, this.buildResultMetadata(normalizedQuery, options, {
          providerStatus: 'ok',
          cacheHit: true,
          resultCount: cached.length
        }));
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

      await this.logUsage(normalizedQuery, options, results.length, false, 'ok');
      this.setLastStatus('ok', { query: normalizedQuery, resultCount: results.length, cacheHit: false });

      return this.attachMetadata(results, this.buildResultMetadata(normalizedQuery, options, {
        providerStatus: 'ok',
        cacheHit: false,
        resultCount: results.length
      }));
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
        this.setLastStatus('cooldown', {
          query: normalizedQuery,
          responseStatus,
          cooldownUntil: new Date(this.cooldownUntil).toISOString()
        });
        throw new Error(`Serper unavailable (status ${responseStatus}); cooldown active`);
      }

      this.setLastStatus('error', { query: normalizedQuery, responseStatus, message: error.message });
      throw error;
    }
  }

  async searchWithFallbacks(queryBuilders = [], baseOptions = {}) {
    let lastError = null;
    let anyResults = [];

    for (const builder of queryBuilders) {
      if (!builder) continue;
      const built = typeof builder === 'function' ? builder() : builder;
      const nextQuery = String(built?.query || '').trim();
      if (!nextQuery) continue;
      const nextOptions = { ...baseOptions, ...(built?.options || {}) };

      try {
        const results = await this.search(nextQuery, nextOptions);
        anyResults = results;
        if (results.length > 0) {
          return this.attachMetadata(results, {
            ...(results._meta || this.buildResultMetadata(nextQuery, nextOptions)),
            fallbackUsed: nextQuery !== String(queryBuilders?.[0]?.query || '').trim()
          });
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (anyResults.length >= 0 && anyResults._meta) {
      return anyResults;
    }

    if (lastError) throw lastError;
    return this.attachMetadata([], this.buildResultMetadata('', baseOptions, { providerStatus: 'no_queries' }));
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

    if (!normalizedQueries.length) {
      return this.attachMetadata([], this.buildResultMetadata('', baseOptions, { providerStatus: 'no_queries' }));
    }

    const settled = await Promise.allSettled(
      normalizedQueries.map(item => this.searchWithFallbacks([{ query: item.query, options: item.options }], item.options))
    );

    const fulfilled = settled
      .filter(item => item.status === 'fulfilled')
      .map(item => item.value);

    if (fulfilled.length) {
      const merged = this.mergeSearchResults(fulfilled, baseOptions.maxResults || 5);
      return this.attachMetadata(merged, this.buildResultMetadata(normalizedQueries[0]?.query || '', baseOptions, {
        providerStatus: 'ok',
        queryCount: normalizedQueries.length,
        resultCount: merged.length
      }));
    }

    const firstRejected = settled.find(item => item.status === 'rejected');
    if (firstRejected) {
      throw firstRejected.reason;
    }

    return this.attachMetadata([], this.buildResultMetadata(normalizedQueries[0]?.query || '', baseOptions, {
      providerStatus: 'ok',
      queryCount: normalizedQueries.length,
      resultCount: 0
    }));
  }

  async getHealthAwareResults(searchPromiseFactory, options = {}) {
    try {
      const results = await searchPromiseFactory();
      return {
        ok: true,
        degraded: false,
        providerStatus: results?._meta?.providerStatus || 'ok',
        warning: null,
        results,
        meta: results?._meta || null
      };
    } catch (error) {
      const status = this.getStatus();
      return {
        ok: false,
        degraded: true,
        providerStatus: status.status || 'error',
        warning: error.message,
        results: this.attachMetadata([], this.buildResultMetadata('', options, {
          providerStatus: status.status || 'error',
          warning: error.message
        })),
        meta: status
      };
    }
  }

  buildTieredQueries(primaryQueries = [], fallbackQueries = []) {
    return [
      ...primaryQueries.map(item => ({ ...item, options: { ...(item.options || {}), sourceTier: 'primary' } })),
      ...fallbackQueries.map(item => ({ ...item, options: { ...(item.options || {}), sourceTier: 'fallback' } }))
    ];
  }

  ensureMinResults(queries = [], minResults = 4) {
    const normalizedMin = Math.max(1, Number(minResults || 4));
    return (queries || []).map(item => ({
      ...item,
      options: {
        ...(item.options || {}),
        maxResults: Math.max(normalizedMin, Number(item?.options?.maxResults || 0))
      }
    }));
  }

  getDefaultExcludeDomains(extra = []) {
    return [...new Set([...COMMENTARY_HEAVY_DOMAINS, ...SOCIAL_NOISE_DOMAINS, ...(extra || [])])];
  }

  buildStockContextQueries(symbol, companyName = '') {
    const identity = this.buildTickerIdentity(symbol, companyName);
    const ticker = this.normalizeSymbolToken(symbol);
    return this.buildTieredQueries(
      [
        { query: `${identity} stock news`, options: { maxResults: 3, engine: 'news' } },
        { query: `${identity} earnings guidance analyst`, options: { maxResults: 2, engine: 'news' } },
        { query: `${identity} partnership acquisition contract product launch`, options: { maxResults: 2, engine: 'news' } },
        { query: `${identity} investigation lawsuit recall regulatory executive`, options: { maxResults: 2, engine: 'news' } }
      ],
      [
        { query: `${ticker} stock news`, options: { maxResults: 3, engine: 'news' } },
        { query: `${identity} latest news`, options: { maxResults: 2, engine: 'news' } }
      ]
    );
  }

  buildProfileContextQueries(symbol, companyName = '') {
    const identity = this.buildTickerIdentity(symbol, companyName);
    const ticker = this.normalizeSymbolToken(symbol);
    return this.buildTieredQueries(
      [
        { query: `${identity} company news strategy outlook`, options: { maxResults: 3, engine: 'news' } },
        { query: `${identity} earnings guidance demand margin`, options: { maxResults: 2, engine: 'news' } },
        { query: `${identity} partnership acquisition product launch customer`, options: { maxResults: 2, engine: 'news' } }
      ],
      [
        { query: `${ticker} stock news`, options: { maxResults: 2, engine: 'news' } },
        { query: `${identity} latest news`, options: { maxResults: 2, engine: 'news' } }
      ]
    );
  }

  buildPremarketContextQueries(symbol, companyName = '') {
    const identity = this.buildTickerIdentity(symbol, companyName);
    const ticker = this.normalizeSymbolToken(symbol);
    return this.buildTieredQueries(
      [
        { query: `${identity} stock news today`, options: { maxResults: 2, engine: 'news' } },
        { query: `${identity} earnings guidance analyst`, options: { maxResults: 2, engine: 'news' } }
      ],
      [
        { query: `${identity} acquisition merger product launch investigation`, options: { maxResults: 2, engine: 'news' } },
        { query: `${ticker} premarket news`, options: { maxResults: 2, engine: 'news' } }
      ]
    );
  }

  buildEarningsContextQueries(symbol, companyName = '') {
    const identity = this.buildTickerIdentity(symbol, companyName);
    const ticker = this.normalizeSymbolToken(symbol);
    return this.buildTieredQueries(
      [
        { query: `${identity} earnings preview`, options: { maxResults: 3, engine: 'news' } },
        { query: `${identity} guidance outlook analyst expectations`, options: { maxResults: 3, engine: 'news' } },
        { query: `${identity} margin revenue EPS expectations`, options: { maxResults: 2, engine: 'news' } }
      ],
      [
        { query: `${ticker} earnings preview`, options: { maxResults: 2, engine: 'news' } },
        { query: `${identity} latest earnings news`, options: { maxResults: 2, engine: 'news' } }
      ]
    );
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
    return await this.search('stock market news today earnings fed inflation oil geopolitical risk', {
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
    const minResults = Math.max(3, Number(options.minResults || 4));
    const maxResults = Math.max(minResults, Number(options.maxResults || 5));
    const companyName = String(options.companyName || '').trim();

    return await this.searchMany(this.ensureMinResults(this.buildStockContextQueries(symbol, companyName), minResults), {
      activity: 'stock_context',
      symbol,
      maxResults,
      timeRange: options.timeRange || 'week',
      context: options.context || {},
      includeDomains: options.includeDomains || DEFAULT_FINANCE_DOMAINS,
      excludeDomains: options.excludeDomains || this.getDefaultExcludeDomains()
    });
  }

  async searchStructuredProfileContext(symbol, options = {}) {
    const minResults = Math.max(3, Number(options.minResults || 4));
    const maxResults = Math.max(minResults, Number(options.maxResults || 5));
    const companyName = String(options.companyName || '').trim();

    return await this.searchMany(this.ensureMinResults(this.buildProfileContextQueries(symbol, companyName), minResults), {
      activity: 'profile_context',
      symbol,
      maxResults,
      timeRange: options.timeRange || 'week',
      context: options.context || {},
      includeDomains: options.includeDomains || DEFAULT_FINANCE_DOMAINS,
      excludeDomains: options.excludeDomains || this.getDefaultExcludeDomains()
    });
  }

  async searchStructuredMonitoringContext(symbol, options = {}) {
    const minResults = Math.max(3, Number(options.minResults || 4));
    const maxResults = Math.max(minResults, Number(options.maxResults || 4));
    const companyName = String(options.companyName || '').trim();

    return await this.searchMany(this.ensureMinResults(this.buildTieredQueries(
      [
        { query: `${this.buildTickerIdentity(symbol, companyName)} guidance outlook warning Reuters CNBC Bloomberg`, options: { maxResults: 2, engine: 'news' } },
        { query: `${this.buildTickerIdentity(symbol, companyName)} analyst downgrade upgrade price target Reuters CNBC Bloomberg`, options: { maxResults: 2, engine: 'news' } },
        { query: `${this.buildTickerIdentity(symbol, companyName)} product launch contract acquisition partnership Reuters Bloomberg SEC FDA`, options: { maxResults: 2, engine: 'news' } }
      ],
      [
        { query: `${this.buildTickerIdentity(symbol, companyName)} investigation lawsuit recall management change`, options: { maxResults: 2, engine: 'news' } },
        { query: `${this.normalizeSymbolToken(symbol)} stock news warning downgrade catalyst`, options: { maxResults: 2, engine: 'news' } }
      ]
    ), minResults), {
      engine: 'news',
      activity: 'monitoring_context',
      symbol,
      timeRange: options.timeRange || 'week',
      maxResults,
      context: options.context || {},
      includeDomains: options.includeDomains || DEFAULT_FINANCE_DOMAINS,
      excludeDomains: options.excludeDomains || this.getDefaultExcludeDomains()
    });
  }

  async searchStructuredEarningsContext(symbol, options = {}) {
    const minResults = Math.max(3, Number(options.minResults || 4));
    const maxResults = Math.max(minResults, Number(options.maxResults || 5));
    const companyName = String(options.companyName || '').trim();
    const includeDomains = options.includeDomains || DEFAULT_FINANCE_DOMAINS;

    return await this.searchMany(this.ensureMinResults(this.buildEarningsContextQueries(symbol, companyName), minResults), {
      activity: 'earnings_context',
      symbol,
      timeRange: options.timeRange || 'week',
      maxResults,
      context: options.context || {},
      includeDomains,
      excludeDomains: options.excludeDomains || this.getDefaultExcludeDomains()
    });
  }

  async searchStructuredPremarketContext(symbol, options = {}) {
    const minResults = Math.max(3, Number(options.minResults || 4));
    const maxResults = Math.max(minResults, Number(options.maxResults || 4));
    const companyName = String(options.companyName || '').trim();
    return await this.searchMany(this.ensureMinResults(this.buildPremarketContextQueries(symbol, companyName), minResults), {
      engine: 'news',
      activity: 'premarket_context',
      symbol,
      timeRange: options.timeRange || 'day',
      maxResults,
      context: options.context || {},
      includeDomains: options.includeDomains || DEFAULT_FINANCE_DOMAINS,
      excludeDomains: options.excludeDomains || this.getDefaultExcludeDomains()
    });
  }

  async searchStructuredMacroContext(options = {}) {
    const minResults = Math.max(3, Number(options.minResults || 4));
    const maxResults = Math.max(minResults, Number(options.maxResults || 5));

    return await this.searchMany(this.ensureMinResults(this.buildTieredQueries(
      [
        { query: 'Federal Reserve interest rates Powell FOMC stocks bonds inflation Reuters CNBC Bloomberg', options: { maxResults: 2, engine: 'news' } },
        { query: 'oil prices Middle East Iran war stocks inflation energy market impact Reuters CNBC Bloomberg', options: { maxResults: 2, engine: 'news' } }
      ],
      [
        { query: 'CPI PPI payrolls unemployment recession stock market impact', options: { maxResults: 2, engine: 'news' } },
        { query: 'earnings season guidance outlook stock market today', options: { maxResults: 2, engine: 'news' } }
      ]
    ), minResults), {
      activity: 'macro_context',
      engine: 'news',
      timeRange: options.timeRange || 'week',
      maxResults,
      includeDomains: options.includeDomains || DEFAULT_FINANCE_DOMAINS,
      excludeDomains: options.excludeDomains || this.getDefaultExcludeDomains()
    });
  }

  async searchSectorNews(sector, maxResults = 3, options = {}) {
    const minResults = Math.max(3, Number(options.minResults || 4));
    const normalizedMax = Math.max(minResults, Number(maxResults || 3));
    const query = `${sector} stocks news`;
    return await this.search(query, {
      engine: 'news',
      maxResults: normalizedMax,
      timeRange: options.timeRange || 'week',
      includeDomains: options.includeDomains || DEFAULT_FINANCE_DOMAINS,
      excludeDomains: options.excludeDomains || this.getDefaultExcludeDomains(),
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
