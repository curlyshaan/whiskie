import tavily from '../tavily.js';

class NewsCacheService {
  constructor() {
    this.cache = new Map();
    this.ttlMs = 15 * 60 * 1000;
  }

  async getStructuredStockContext(symbol, options = {}) {
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    const key = JSON.stringify({
      symbol: normalizedSymbol,
      maxResults: options.maxResults || 5,
      timeRange: options.timeRange || 'month',
      depth: options.depth || 'basic',
      topic: options.topic || 'news',
      context: options.context || null
    });

    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      return cached.data;
    }

    const data = await tavily.searchStructuredStockContext(normalizedSymbol, options);
    this.cache.set(key, { data, timestamp: Date.now() });
    return data;
  }

  async getStructuredMacroContext(options = {}) {
    const key = JSON.stringify({ type: 'macro', options });
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      return cached.data;
    }

    const data = await tavily.searchStructuredMacroContext(options);
    this.cache.set(key, { data, timestamp: Date.now() });
    return data;
  }
}

export default new NewsCacheService();
