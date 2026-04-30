import dotenv from 'dotenv';
import * as db from './db.js';
import tavily from './tavily.js';

dotenv.config();

class NewsSearchService {
  normalizePublisherName(source = '', url = '') {
    const explicit = String(source || '').trim();
    if (explicit) return explicit;
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      return hostname || 'Unknown';
    } catch {
      return 'Unknown';
    }
  }

  normalizeResults(results = []) {
    return (results || []).map(result => ({
      ...result,
      source: this.normalizePublisherName(result.source, result.url),
      articleText: result.raw_content || result.content || '',
      extractionQuality: result.raw_content ? 'provider_content' : (result.content ? 'snippet_only' : 'empty'),
      extractedTitle: null,
      extractedExcerpt: null,
      extractedByline: null,
      extractedSiteName: null,
      summary: result.content || 'No summary available.',
      bullets: []
    }));
  }

  async search(query, options = {}) {
    const results = await tavily.search(query, options);
    return this.normalizeResults(results);
  }

  async searchWithFallbacks(queryBuilders = [], baseOptions = {}) {
    const results = await tavily.searchWithFallbacks(queryBuilders, baseOptions);
    return this.normalizeResults(results);
  }

  async searchMany(queries = [], baseOptions = {}) {
    const results = await tavily.searchMany(queries, baseOptions);
    return this.normalizeResults(results);
  }

  async searchStockNews(symbol, maxResults = 5, options = {}) {
    const results = await tavily.searchStockNews(symbol, maxResults, options);
    return this.normalizeResults(results);
  }

  async searchMarketNews(maxResults = 5, options = {}) {
    const results = await tavily.searchMarketNews(maxResults, options);
    return this.normalizeResults(results);
  }

  async searchNews(query, maxResults = 5, options = {}) {
    const results = await tavily.searchNews(query, maxResults, options);
    return this.normalizeResults(results);
  }

  async searchStructuredStockContext(symbol, options = {}) {
    const results = await tavily.searchStructuredStockContext(symbol, options);
    return this.normalizeResults(results);
  }

  async searchStructuredProfileContext(symbol, options = {}) {
    const results = await tavily.searchStructuredStockContext(symbol, {
      ...options,
      activity: options.activity || 'profile_context'
    });
    return this.normalizeResults(results);
  }

  async searchStructuredMonitoringContext(symbol, options = {}) {
    const results = await tavily.searchStructuredMonitoringContext(symbol, options);
    return this.normalizeResults(results);
  }

  async searchStructuredEarningsContext(symbol, options = {}) {
    const results = await tavily.searchStructuredEarningsContext(symbol, options);
    return this.normalizeResults(results);
  }

  async searchStructuredPremarketContext(symbol, options = {}) {
    const results = await tavily.searchStructuredPremarketContext(symbol, options);
    return this.normalizeResults(results);
  }

  async searchStructuredMacroContext(options = {}) {
    const results = await tavily.searchStructuredMacroContext(options);
    return this.normalizeResults(results);
  }


  async getStructuredStockContextWithHealth(symbol, options = {}) {
    return await tavily.getHealthAwareResults(
      () => this.searchStructuredStockContext(symbol, options),
      { ...options, symbol, activity: 'stock_context' }
    );
  }

  async getStructuredProfileContextWithHealth(symbol, options = {}) {
    return await tavily.getHealthAwareResults(
      () => this.searchStructuredProfileContext(symbol, options),
      { ...options, symbol, activity: 'profile_context' }
    );
  }

  async getStructuredMacroContextWithHealth(options = {}) {
    return await tavily.getHealthAwareResults(
      () => this.searchStructuredMacroContext(options),
      { ...options, activity: 'macro_context' }
    );
  }

  async getStructuredEarningsContextWithHealth(symbol, options = {}) {
    return await tavily.getHealthAwareResults(
      () => this.searchStructuredEarningsContext(symbol, options),
      { ...options, symbol, activity: 'earnings_context' }
    );
  }

  async getStructuredPremarketContextWithHealth(symbol, options = {}) {
    return await tavily.getHealthAwareResults(
      () => this.searchStructuredPremarketContext(symbol, options),
      { ...options, symbol, activity: 'premarket_context' }
    );
  }

  async searchSectorNews(sector, maxResults = 3, options = {}) {
    const results = await tavily.searchSectorNews(sector, maxResults, options);
    return this.normalizeResults(results);
  }

  formatResults(results) {
    if (!results || results.length === 0) {
      return 'No recent news found.';
    }

    return results.map((result, index) => {
      const bulletText = Array.isArray(result.bullets) && result.bullets.length
        ? `\n   Key points: ${result.bullets.join(' | ')}`
        : '';
      const bestSummary = result.summary || result.content || 'No summary available.';
      return `${index + 1}. ${result.title}
   Source: ${result.source || 'Unknown'} — ${result.url}
   Summary: ${bestSummary}
   Published: ${result.published_date || 'Recent'}${bulletText}`;
    }).join('\n\n');
  }
}

export default new NewsSearchService();
