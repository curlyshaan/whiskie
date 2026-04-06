import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const isPaperTrading = process.env.NODE_ENV === 'paper';

// CRITICAL SAFETY: Hardcode sandbox URL to prevent accidental live trading
const BASE_URL = 'https://sandbox.tradier.com/v1';

// Runtime assertion to ensure we're using sandbox
if (!BASE_URL.includes('sandbox')) {
  throw new Error('SAFETY CHECK FAILED: Refusing to run against live Tradier API. BASE_URL must contain "sandbox".');
}

// Use sandbox credentials for paper trading
const TRADIER_API_KEY = isPaperTrading
  ? process.env.TRADIER_SANDBOX_API_KEY
  : process.env.TRADIER_API_KEY;

const TRADIER_ACCOUNT_ID = isPaperTrading
  ? process.env.TRADIER_SANDBOX_ACCOUNT_ID
  : process.env.TRADIER_ACCOUNT_ID;

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
      },
      timeout: 30000 // 30 second timeout
    });

    this.MAX_RETRIES = 3;
    this.BACKOFF_MS = [2000, 5000, 15000]; // Exponential backoff
  }

  /**
   * Execute API call with retry logic and graceful degradation
   */
  async executeWithRetry(apiCall, operationName) {
    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        return await apiCall();
      } catch (error) {
        const isLastAttempt = attempt === this.MAX_RETRIES - 1;

        if (isLastAttempt) {
          console.error(`❌ ${operationName} failed after ${this.MAX_RETRIES} attempts:`, error.message);
          throw new Error(`Tradier API unavailable: ${operationName} failed`);
        }

        console.warn(`⚠️ ${operationName} attempt ${attempt + 1} failed, retrying in ${this.BACKOFF_MS[attempt]}ms...`);
        await new Promise(resolve => setTimeout(resolve, this.BACKOFF_MS[attempt]));
      }
    }
  }

  /**
   * Get current stock quote
   */
  async getQuote(symbol) {
    return this.executeWithRetry(async () => {
      const response = await this.client.get('/markets/quotes', {
        params: { symbols: symbol }
      });
      return response.data.quotes.quote;
    }, `getQuote(${symbol})`);
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
    return this.executeWithRetry(async () => {
      const response = await this.client.get(`/accounts/${accountId}/positions`);
      return response.data.positions?.position || [];
    }, 'getPositions');
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
          duration: 'gtc' // Good-til-canceled
        }
      });
      return response.data.order;
    } catch (error) {
      console.error(`Error placing limit order for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Place a stop-loss order
   */
  async placeStopOrder(symbol, side, quantity, stopPrice, accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.post(`/accounts/${accountId}/orders`, null, {
        params: {
          class: 'equity',
          symbol,
          side,
          quantity,
          type: 'stop',
          stop: stopPrice,
          duration: 'gtc' // Good-til-canceled
        }
      });
      return response.data.order;
    } catch (error) {
      console.error(`Error placing stop order for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Place OCO order (One-Cancels-Other) - Stop-loss + Take-profit
   * When one executes, the other is automatically canceled
   */
  async placeOCOOrder(symbol, quantity, stopPrice, limitPrice, accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.post(`/accounts/${accountId}/orders`, null, {
        params: {
          class: 'oco',
          symbol,
          side: 'sell',
          quantity,
          type: 'market',
          duration: 'gtc',
          // Leg 1: Stop-loss
          'order[0][type]': 'stop',
          'order[0][stop]': stopPrice,
          // Leg 2: Take-profit (limit)
          'order[1][type]': 'limit',
          'order[1][price]': limitPrice
        }
      });
      return response.data.order;
    } catch (error) {
      console.error(`Error placing OCO order for ${symbol}:`, error.message);
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
