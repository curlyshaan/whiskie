import newsSearch from '../news-search.js';

class NewsCacheService {
  constructor() {
    this.cache = new Map();
    this.ttlMs = 15 * 60 * 1000;
  }

  buildStockKey(symbol, options = {}) {
    return JSON.stringify({
      type: 'stock',
      symbol,
      activity: options.activity || 'stock_context',
      maxResults: options.maxResults || 5,
      timeRange: options.timeRange || 'week',
      context: options.context || null,
      companyName: options.companyName || null,
      includeDomains: options.includeDomains || [],
      excludeDomains: options.excludeDomains || []
    });
  }

  async getStructuredStockContext(symbol, options = {}) {
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    const key = this.buildStockKey(normalizedSymbol, options);

    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      return cached.data;
    }

    const activity = options.activity || 'stock_context';
    const data = activity === 'profile_context'
      ? await newsSearch.searchStructuredProfileContext(normalizedSymbol, options)
      : await newsSearch.searchStructuredStockContext(normalizedSymbol, options);
    this.cache.set(key, { data, timestamp: Date.now() });
    return data;
  }

  async getStructuredMacroContext(options = {}) {
    const key = JSON.stringify({ type: 'macro', options });
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      return cached.data;
    }

    const data = await newsSearch.searchStructuredMacroContext(options);
    this.cache.set(key, { data, timestamp: Date.now() });
    return data;
  }
}

export default new NewsCacheService();
