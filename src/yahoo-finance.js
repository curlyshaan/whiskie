import fetch from 'node-fetch';

/**
 * Simple Yahoo Finance API wrapper for historical data
 * Uses Yahoo's public API (no authentication required)
 */
class YahooFinance {
  /**
   * Get historical price data
   * @param {string} symbol - Stock symbol
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Array} Array of {date, open, high, low, close, volume}
   */
  async getHistoricalData(symbol, startDate, endDate) {
    try {
      const period1 = Math.floor(startDate.getTime() / 1000);
      const period2 = Math.floor(endDate.getTime() / 1000);

      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d`;

      const response = await fetch(url);
      const data = await response.json();

      if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
        throw new Error(`No data returned for ${symbol}`);
      }

      const result = data.chart.result[0];
      const timestamps = result.timestamp;
      const quotes = result.indicators.quote[0];

      // Convert to array of daily bars, filter out incomplete data (null close prices)
      const history = timestamps
        .map((timestamp, i) => ({
          date: new Date(timestamp * 1000).toISOString().split('T')[0],
          open: quotes.open[i],
          high: quotes.high[i],
          low: quotes.low[i],
          close: quotes.close[i],
          volume: quotes.volume[i]
        }))
        .filter(bar => bar.close !== null && bar.close !== undefined);

      return history;
    } catch (error) {
      console.error(`Error fetching Yahoo Finance data for ${symbol}:`, error.message);
      throw error;
    }
  }
}

export default new YahooFinance();
