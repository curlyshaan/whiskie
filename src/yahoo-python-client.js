import fetch from 'node-fetch';

/**
 * Node.js client for Python Yahoo Finance service
 * Calls local Python service running on port 5001
 */
class YahooPythonClient {
  constructor() {
    this.BASE_URL = 'http://localhost:5001';
  }

  async getFundamentals(symbol) {
    try {
      const response = await fetch(`${this.BASE_URL}/fundamentals/${symbol}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Error fetching fundamentals for ${symbol}:`, error.message);
      return null;
    }
  }

  async getQuote(symbol) {
    try {
      const response = await fetch(`${this.BASE_URL}/quote/${symbol}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Error fetching quote for ${symbol}:`, error.message);
      return null;
    }
  }

  async getEarnings(symbol) {
    try {
      const response = await fetch(`${this.BASE_URL}/earnings/${symbol}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Error fetching earnings for ${symbol}:`, error.message);
      return null;
    }
  }

  async healthCheck() {
    try {
      const response = await fetch(`${this.BASE_URL}/health`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

export default new YahooPythonClient();
