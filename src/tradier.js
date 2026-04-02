import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const isPaperTrading = process.env.NODE_ENV === 'paper';

// Use sandbox credentials for paper trading
const TRADIER_API_KEY = isPaperTrading
  ? process.env.TRADIER_SANDBOX_API_KEY
  : process.env.TRADIER_API_KEY;

const TRADIER_ACCOUNT_ID = isPaperTrading
  ? process.env.TRADIER_SANDBOX_ACCOUNT_ID
  : process.env.TRADIER_ACCOUNT_ID;

const BASE_URL = isPaperTrading
  ? process.env.TRADIER_SANDBOX_URL
  : process.env.TRADIER_BASE_URL;

/**
 * Tradier API Wrapper
 * Handles all trading operations and market data
 */
class TradierAPI {
  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      headers: {
        'Authorization': `Bearer ${TRADIER_API_KEY}`,
        'Accept': 'application/json'
      }
    });
  }

  /**
   * Get current stock quote
   */
  async getQuote(symbol) {
    try {
      const response = await this.client.get('/markets/quotes', {
        params: { symbols: symbol }
      });
      return response.data.quotes.quote;
    } catch (error) {
      console.error(`Error fetching quote for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get multiple quotes at once
   */
  async getQuotes(symbols) {
    try {
      const symbolString = Array.isArray(symbols) ? symbols.join(',') : symbols;
      const response = await this.client.get('/markets/quotes', {
        params: { symbols: symbolString }
      });
      return response.data.quotes.quote;
    } catch (error) {
      console.error('Error fetching quotes:', error.message);
      throw error;
    }
  }

  /**
   * Get historical price data
   */
  async getHistory(symbol, interval = 'daily', start = null, end = null) {
    try {
      const params = { symbol, interval };
      if (start) params.start = start;
      if (end) params.end = end;

      const response = await this.client.get('/markets/history', { params });
      return response.data.history.day;
    } catch (error) {
      console.error(`Error fetching history for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get account profile
   */
  async getProfile() {
    try {
      const response = await this.client.get('/user/profile');
      return response.data.profile;
    } catch (error) {
      console.error('Error fetching profile:', error.message);
      throw error;
    }
  }

  /**
   * Get account balances
   */
  async getBalances(accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.get(`/accounts/${accountId}/balances`);
      return response.data.balances;
    } catch (error) {
      console.error('Error fetching balances:', error.message);
      throw error;
    }
  }

  /**
   * Get current positions
   */
  async getPositions(accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.get(`/accounts/${accountId}/positions`);
      return response.data.positions?.position || [];
    } catch (error) {
      console.error('Error fetching positions:', error.message);
      throw error;
    }
  }

  /**
   * Get order history
   */
  async getOrders(accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.get(`/accounts/${accountId}/orders`);
      return response.data.orders?.order || [];
    } catch (error) {
      console.error('Error fetching orders:', error.message);
      throw error;
    }
  }

  /**
   * Place a market order
   */
  async placeOrder(symbol, side, quantity, orderType = 'market', accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.post(`/accounts/${accountId}/orders`, null, {
        params: {
          class: 'equity',
          symbol,
          side, // 'buy' or 'sell'
          quantity,
          type: orderType,
          duration: 'day'
        }
      });
      return response.data.order;
    } catch (error) {
      console.error(`Error placing ${side} order for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Place a limit order
   */
  async placeLimitOrder(symbol, side, quantity, price, accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.post(`/accounts/${accountId}/orders`, null, {
        params: {
          class: 'equity',
          symbol,
          side,
          quantity,
          type: 'limit',
          price,
          duration: 'day'
        }
      });
      return response.data.order;
    } catch (error) {
      console.error(`Error placing limit order for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId, accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.delete(`/accounts/${accountId}/orders/${orderId}`);
      return response.data;
    } catch (error) {
      console.error(`Error canceling order ${orderId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get company fundamentals (if available)
   */
  async getFundamentals(symbols) {
    try {
      const symbolString = Array.isArray(symbols) ? symbols.join(',') : symbols;
      const response = await this.client.get('/markets/fundamentals/company', {
        params: { symbols: symbolString }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching fundamentals:', error.message);
      throw error;
    }
  }

  /**
   * Get market calendar (trading days, holidays)
   */
  async getCalendar(month = null, year = null) {
    try {
      const params = {};
      if (month) params.month = month;
      if (year) params.year = year;

      const response = await this.client.get('/markets/calendar', { params });
      return response.data.calendar;
    } catch (error) {
      console.error('Error fetching calendar:', error.message);
      throw error;
    }
  }

  /**
   * Check if market is open
   */
  async isMarketOpen() {
    try {
      const response = await this.client.get('/markets/clock');
      return response.data.clock.state === 'open';
    } catch (error) {
      console.error('Error checking market status:', error.message);
      throw error;
    }
  }

  /**
   * Get market clock (open/close times)
   */
  async getMarketClock() {
    try {
      const response = await this.client.get('/markets/clock');
      return response.data.clock;
    } catch (error) {
      console.error('Error fetching market clock:', error.message);
      throw error;
    }
  }
}

export default new TradierAPI();
