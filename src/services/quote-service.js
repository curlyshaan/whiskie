import fmp from '../fmp.js';

class QuoteService {
  constructor() {
    this.cache = new Map();
    this.ttlMs = 60 * 1000;
  }

  async getQuote(symbol) {
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    const cached = this.cache.get(normalizedSymbol);
    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      return cached.data;
    }

    const data = await fmp.getQuote(normalizedSymbol);
    this.cache.set(normalizedSymbol, { data, timestamp: Date.now() });
    return data;
  }

  async getBatchQuotes(symbols = []) {
    const normalizedSymbols = [...new Set(symbols.map(symbol => String(symbol || '').trim().toUpperCase()).filter(Boolean))];
    const results = new Map();
    const uncached = [];

    for (const symbol of normalizedSymbols) {
      const cached = this.cache.get(symbol);
      if (cached && Date.now() - cached.timestamp < this.ttlMs) {
        results.set(symbol, cached.data);
      } else {
        uncached.push(symbol);
      }
    }

    if (uncached.length > 0) {
      const fetched = await fmp.getQuotes(uncached);
      const items = Array.isArray(fetched) ? fetched : [fetched];
      for (const quote of items.filter(Boolean)) {
        this.cache.set(quote.symbol, { data: quote, timestamp: Date.now() });
        results.set(quote.symbol, quote);
      }
    }

    return results;
  }
}

export default new QuoteService();
