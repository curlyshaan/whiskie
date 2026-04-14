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
      const orders = response.data.orders?.order || [];
      // Tradier returns single order as object, multiple as array
      return Array.isArray(orders) ? orders : [orders];
    } catch (error) {
      console.error('Error fetching orders:', error.message);
      throw error;
    }
  }

  /**
   * Place a market order
   * Supports long and short positions:
   * - buy/sell: long positions (default)
   * - buy_to_open: open long position
   * - sell_to_close: close long position
   * - sell_to_open: open short position (short selling)
   * - buy_to_close: close short position (cover)
   */
  async placeOrder(symbol, side, quantity, orderType = 'market', accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.post(`/accounts/${accountId}/orders`, null, {
        params: {
          class: 'equity',
          symbol,
          side, // 'buy', 'sell', 'buy_to_open', 'sell_to_close', 'sell_to_open', 'buy_to_close'
          quantity,
          type: orderType,
          duration: 'gtc', // Good-til-canceled for extended hours support
          extended_hours: true // Enable pre-market (4am-9:30am) and after-hours (4pm-8pm ET)
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
          duration: 'gtc',
          // Leg 1: Stop-loss
          'symbol[0]': symbol,
          'side[0]': 'sell',
          'quantity[0]': quantity,
          'type[0]': 'stop',
          'stop[0]': stopPrice.toFixed(2),
          // Leg 2: Take-profit (limit)
          'symbol[1]': symbol,
          'side[1]': 'sell',
          'quantity[1]': quantity,
          'type[1]': 'limit',
          'price[1]': limitPrice.toFixed(2)
        }
      });
      return response.data.order;
    } catch (error) {
      console.error(`Error placing OCO order for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Place OTOCO order (One-Triggers-Other-Cancels-Other)
   * Entry order that automatically sets up OCO bracket when filled
   * Example: Buy at limit $100, then auto-place stop $95 + limit $110
   */
  async placeOTOCOOrder(symbol, side, quantity, entryPrice, stopPrice, limitPrice, accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.post(`/accounts/${accountId}/orders`, null, {
        params: {
          class: 'otoco',
          symbol,
          side,
          quantity,
          type: 'limit',
          price: entryPrice,
          duration: 'gtc',
          // Leg 1: Stop-loss (triggers after entry fills)
          'order[0][type]': 'stop',
          'order[0][side]': side === 'buy' ? 'sell' : 'buy',
          'order[0][quantity]': quantity,
          'order[0][stop]': stopPrice,
          // Leg 2: Take-profit (triggers after entry fills)
          'order[1][type]': 'limit',
          'order[1][side]': side === 'buy' ? 'sell' : 'buy',
          'order[1][quantity]': quantity,
          'order[1][price]': limitPrice
        }
      });
      return response.data.order;
    } catch (error) {
      console.error(`Error placing OTOCO order for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Place trailing stop order
   * Automatically adjusts stop price as market moves in favorable direction
   * @param {string} symbol - Stock symbol
   * @param {string} side - 'buy' or 'sell'
   * @param {number} quantity - Number of shares
   * @param {number} trailAmount - Dollar amount to trail (e.g., $5.00)
   * @param {string} accountId - Tradier account ID
   */
  async placeTrailingStopOrder(symbol, side, quantity, trailAmount, accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.post(`/accounts/${accountId}/orders`, null, {
        params: {
          class: 'equity',
          symbol,
          side,
          quantity,
          type: 'trailing_stop',
          trail: trailAmount.toFixed(2),
          duration: 'gtc'
        }
      });
      return response.data;
    } catch (error) {
      console.error(`Error placing trailing stop order for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Place stop-limit order
   * Triggers at stop price, then becomes limit order
   */
  async placeStopLimitOrder(symbol, side, quantity, stopPrice, limitPrice, accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.post(`/accounts/${accountId}/orders`, null, {
        params: {
          class: 'equity',
          symbol,
          side,
          quantity,
          type: 'stop_limit',
          stop: stopPrice,
          price: limitPrice,
          duration: 'gtc'
        }
      });
      return response.data.order;
    } catch (error) {
      console.error(`Error placing stop-limit order for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Modify an existing order
   */
  async modifyOrder(orderId, updates, accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.put(`/accounts/${accountId}/orders/${orderId}`, null, {
        params: updates
      });
      return response.data.order;
    } catch (error) {
      console.error(`Error modifying order ${orderId}:`, error.message);
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
   * Get order status
   */
  async getOrderStatus(orderId, accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.get(`/accounts/${accountId}/orders/${orderId}`);
      return response.data.order;
    } catch (error) {
      console.error(`Error getting order status ${orderId}:`, error.message);
      throw error;
    }
  }

  /**
   * Place trailing stop order (dollar amount)
   */
  async placeTrailingStopOrder(symbol, side, quantity, trailAmount, accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.post(`/accounts/${accountId}/orders`, null, {
        params: {
          class: 'equity',
          symbol,
          side,
          quantity,
          type: 'trailing_stop',
          trail: trailAmount,
          duration: 'gtc'
        }
      });
      return response.data.order;
    } catch (error) {
      console.error(`Error placing trailing stop order for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Place trailing stop order (percentage)
   */
  async placeTrailingStopPercentOrder(symbol, side, quantity, trailPercent, accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.post(`/accounts/${accountId}/orders`, null, {
        params: {
          class: 'equity',
          symbol,
          side,
          quantity,
          type: 'trailing_stop',
          trail_percent: trailPercent,
          duration: 'gtc'
        }
      });
      return response.data.order;
    } catch (error) {
      console.error(`Error placing trailing stop % order for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Preview order before placing (get estimated costs)
   */
  async previewOrder(symbol, side, quantity, orderType, price = null, accountId = TRADIER_ACCOUNT_ID) {
    try {
      const params = {
        class: 'equity',
        symbol,
        side,
        quantity,
        type: orderType,
        duration: 'day'
      };
      if (price) params.price = price;

      const response = await this.client.post(`/accounts/${accountId}/orders/preview`, null, { params });
      return response.data.order;
    } catch (error) {
      console.error(`Error previewing order for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Replace existing order (modify without cancel+replace)
   */
  async replaceOrder(orderId, updates, accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.put(`/accounts/${accountId}/orders/${orderId}`, null, {
        params: updates
      });
      return response.data.order;
    } catch (error) {
      console.error(`Error replacing order ${orderId}:`, error.message);
      throw error;
    }
  }

  /**
   * Place order with extended hours trading
   */
  async placeExtendedHoursOrder(symbol, side, quantity, orderType, price = null, accountId = TRADIER_ACCOUNT_ID) {
    try {
      const params = {
        class: 'equity',
        symbol,
        side,
        quantity,
        type: orderType,
        duration: 'day',
        extended_hours: true
      };
      if (price) params.price = price;

      const response = await this.client.post(`/accounts/${accountId}/orders`, null, { params });
      return response.data.order;
    } catch (error) {
      console.error(`Error placing extended hours order for ${symbol}:`, error.message);
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
   * Get options chain for a symbol
   */
  async getOptionsChain(symbol, expiration = null, accountId = TRADIER_ACCOUNT_ID) {
    try {
      const params = { symbol, greeks: true };
      if (expiration) params.expiration = expiration;

      const response = await this.client.get('/markets/options/chains', { params });
      return response.data.options?.option || [];
    } catch (error) {
      console.error(`Error fetching options chain for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get options expirations for a symbol
   */
  async getOptionsExpirations(symbol) {
    try {
      const response = await this.client.get('/markets/options/expirations', {
        params: { symbol, includeAllRoots: true }
      });
      return response.data.expirations?.date || [];
    } catch (error) {
      console.error(`Error fetching options expirations for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get time and sales (tick data) for a symbol
   */
  async getTimeSales(symbol, interval = '1min', start = null, end = null) {
    try {
      const params = { symbol, interval };
      if (start) params.start = start;
      if (end) params.end = end;

      const response = await this.client.get('/markets/timesales', { params });
      return response.data.series?.data || [];
    } catch (error) {
      console.error(`Error fetching time & sales for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get market clock (status, next open/close)
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

  /**
   * Get ETB (Easy-to-Borrow) list for shorting
   */
  async getETBList(accountId = TRADIER_ACCOUNT_ID) {
    try {
      const response = await this.client.get(`/accounts/${accountId}/orders/etb`);
      return response.data.securities?.security || [];
    } catch (error) {
      console.error('Error fetching ETB list:', error.message);
      throw error;
    }
  }

  /**
   * Get historical intraday data (minute/hourly bars)
   */
  async getIntradayHistory(symbol, interval = '5min', start = null, end = null) {
    try {
      const params = { symbol, interval };
      if (start) params.start = start;
      if (end) params.end = end;

      const response = await this.client.get('/markets/timesales', { params });
      return response.data.series?.data || [];
    } catch (error) {
      console.error(`Error fetching intraday history for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get gain/loss report
   */
  async getGainLoss(accountId = TRADIER_ACCOUNT_ID, page = 1, limit = 100) {
    try {
      const response = await this.client.get(`/accounts/${accountId}/gainloss`, {
        params: { page, limit }
      });
      return response.data.gainloss;
    } catch (error) {
      console.error('Error fetching gain/loss report:', error.message);
      throw error;
    }
  }

  /**
   * Search symbols
   */
  async searchSymbols(query, indexes = true) {
    try {
      const response = await this.client.get('/markets/search', {
        params: { q: query, indexes }
      });
      return response.data.securities?.security || [];
    } catch (error) {
      console.error(`Error searching symbols for ${query}:`, error.message);
      throw error;
    }
  }

  /**
   * Lookup symbol details
   */
  async lookupSymbol(query) {
    try {
      const response = await this.client.get('/markets/lookup', {
        params: { q: query }
      });
      return response.data.securities?.security || [];
    } catch (error) {
      console.error(`Error looking up symbol ${query}:`, error.message);
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

}

export default new TradierAPI();
