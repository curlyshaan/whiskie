import tradier from './tradier.js';

/**
 * Market Timing Analyzer
 * Uses market clock, intraday data, and time & sales for better entry/exit timing
 */
class MarketTimingAnalyzer {
  /**
   * Get current market status
   */
  async getMarketStatus() {
    try {
      const clock = await tradier.getMarketClock();

      return {
        state: clock.state, // 'open', 'closed', 'premarket', 'postmarket'
        timestamp: clock.timestamp,
        nextOpen: clock.next_open,
        nextClose: clock.next_close,
        description: clock.description
      };
    } catch (error) {
      console.error('Error getting market status:', error.message);
      return null;
    }
  }

  /**
   * Check if it's a good time to trade (avoid low liquidity periods)
   */
  async isGoodTradingTime() {
    const status = await this.getMarketStatus();
    if (!status) return false;

    // Don't trade if market is closed
    if (status.state === 'closed') {
      return { canTrade: false, reason: 'Market is closed' };
    }

    // Get current time in ET
    const now = new Date();
    const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = etTime.getHours();
    const minute = etTime.getMinutes();

    // Avoid first 15 minutes (9:30-9:45) - high volatility, wide spreads
    if (hour === 9 && minute < 45) {
      return { canTrade: false, reason: 'Market open volatility - wait until 9:45 AM ET' };
    }

    // Avoid last 15 minutes (3:45-4:00) - closing auction volatility
    if (hour === 15 && minute >= 45) {
      return { canTrade: false, reason: 'Market close volatility - avoid last 15 minutes' };
    }

    // Avoid lunch hour (12:00-1:30 PM) - low volume
    if (hour === 12 || (hour === 13 && minute < 30)) {
      return { canTrade: false, reason: 'Lunch window (12:00-1:30 PM ET) - low liquidity' };
    }

    return { canTrade: true, reason: 'Good trading window' };
  }

  /**
   * Analyze intraday momentum for a symbol
   */
  async analyzeIntradayMomentum(symbol) {
    try {
      // Get last 2 hours of 5-minute bars
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 2 * 60 * 60 * 1000);

      const bars = await tradier.getIntradayHistory(
        symbol,
        '5min',
        startTime.toISOString(),
        endTime.toISOString()
      );

      if (!bars || bars.length < 10) {
        return null;
      }

      // Calculate momentum indicators
      const prices = bars.map(b => b.close);
      const volumes = bars.map(b => b.volume);

      const currentPrice = prices[prices.length - 1];
      const priceChange = ((currentPrice - prices[0]) / prices[0]) * 100;

      // Calculate average volume
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      const recentVolume = volumes.slice(-3).reduce((a, b) => a + b, 0) / 3;
      const volumeRatio = recentVolume / avgVolume;

      // Detect trend
      let trend = 'neutral';
      if (priceChange > 0.5 && volumeRatio > 1.2) trend = 'strong-uptrend';
      else if (priceChange > 0.2) trend = 'uptrend';
      else if (priceChange < -0.5 && volumeRatio > 1.2) trend = 'strong-downtrend';
      else if (priceChange < -0.2) trend = 'downtrend';

      return {
        symbol,
        priceChange: priceChange.toFixed(2) + '%',
        volumeRatio: volumeRatio.toFixed(2),
        trend,
        barsAnalyzed: bars.length,
        recommendation: this.getTimingRecommendation(trend, volumeRatio)
      };
    } catch (error) {
      console.error(`Error analyzing intraday momentum for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get timing recommendation based on momentum
   */
  getTimingRecommendation(trend, volumeRatio) {
    if (trend === 'strong-uptrend' && volumeRatio > 1.5) {
      return 'Strong buying momentum - consider entering on pullback';
    } else if (trend === 'uptrend') {
      return 'Positive momentum - good time to enter';
    } else if (trend === 'strong-downtrend' && volumeRatio > 1.5) {
      return 'Strong selling pressure - avoid or wait for stabilization';
    } else if (trend === 'downtrend') {
      return 'Negative momentum - wait for reversal';
    } else {
      return 'Neutral - wait for clearer direction';
    }
  }

  /**
   * Detect large block trades (institutional activity)
   */
  async detectBlockTrades(symbol, minSize = 10000) {
    try {
      // Get last hour of tick data
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 60 * 60 * 1000);

      const ticks = await tradier.getTimeSales(
        symbol,
        '1min',
        startTime.toISOString(),
        endTime.toISOString()
      );

      if (!ticks || ticks.length === 0) {
        return null;
      }

      // Find large trades
      const blockTrades = ticks.filter(t => t.volume >= minSize);

      if (blockTrades.length === 0) {
        return {
          symbol,
          blockTrades: 0,
          interpretation: 'No significant institutional activity detected'
        };
      }

      // Analyze direction
      const buyVolume = blockTrades.filter(t => t.type === 'buy').reduce((sum, t) => sum + t.volume, 0);
      const sellVolume = blockTrades.filter(t => t.type === 'sell').reduce((sum, t) => sum + t.volume, 0);

      let direction = 'neutral';
      if (buyVolume > sellVolume * 1.5) direction = 'bullish';
      else if (sellVolume > buyVolume * 1.5) direction = 'bearish';

      return {
        symbol,
        blockTrades: blockTrades.length,
        totalBlockVolume: buyVolume + sellVolume,
        buyVolume,
        sellVolume,
        direction,
        interpretation: this.interpretBlockTrades(direction, blockTrades.length)
      };
    } catch (error) {
      console.error(`Error detecting block trades for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Interpret block trade activity
   */
  interpretBlockTrades(direction, count) {
    if (direction === 'bullish' && count > 5) {
      return 'Heavy institutional buying - strong bullish signal';
    } else if (direction === 'bullish') {
      return 'Moderate institutional buying detected';
    } else if (direction === 'bearish' && count > 5) {
      return 'Heavy institutional selling - strong bearish signal';
    } else if (direction === 'bearish') {
      return 'Moderate institutional selling detected';
    } else {
      return 'Mixed institutional activity - no clear direction';
    }
  }
}

export default new MarketTimingAnalyzer();
