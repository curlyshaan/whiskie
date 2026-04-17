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
  }

  /**
   * Search for news and information
   */
  async search(query, options = {}) {
    try {
      const response = await axios.post(`${this.baseURL}/search`, {
        api_key: TAVILY_API_KEY,
        query,
        search_depth: options.depth || 'basic',
        max_results: options.maxResults || 5,
        include_domains: options.includeDomains || [],
        exclude_domains: options.excludeDomains || []
      });

      return response.data.results;
    } catch (error) {
      console.error('Tavily search error:', error.message);
      throw error;
    }
  }

  /**
   * Search for stock-specific news
   */
  async searchStockNews(symbol, maxResults = 5) {
    const query = `${symbol} stock news latest`;
    return await this.search(query, { maxResults });
  }

  /**
   * Search for market news
   */
  async searchMarketNews(maxResults = 5) {
    return await this.search('stock market news today', { depth: 'advanced', maxResults });
  }

  /**
   * Generic news search (missing method referenced in weekly-review.js)
   */
  async searchNews(query, maxResults = 5) {
    return await this.search(query, { depth: 'advanced', maxResults });
  }

  async searchStructuredStockContext(symbol, options = {}) {
    const days = options.days || 14;
    const maxResults = options.maxResults || 5;
    const query = [
      `${symbol} earnings guidance`,
      `${symbol} analyst downgrade OR analyst upgrade`,
      `${symbol} product launch OR customer announcement OR regulation`,
      `${symbol} litigation OR investigation OR recall`
    ].join(' OR ');

    return await this.search(query, {
      depth: 'advanced',
      maxResults,
      includeDomains: options.includeDomains || []
    });
  }

  async searchStructuredEarningsContext(symbol, options = {}) {
    const maxResults = options.maxResults || 5;
    const query = [
      `${symbol} earnings preview`,
      `${symbol} guidance`,
      `${symbol} consensus estimates`,
      `${symbol} margin outlook`,
      `${symbol} revenue outlook`
    ].join(' OR ');

    return await this.search(query, {
      depth: 'advanced',
      maxResults,
      includeDomains: options.includeDomains || []
    });
  }

  /**
   * Search for sector news
   */
  async searchSectorNews(sector, maxResults = 3) {
    const query = `${sector} sector stocks news`;
    return await this.search(query, { maxResults });
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
