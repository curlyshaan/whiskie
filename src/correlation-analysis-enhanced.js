/**
 * Correlation Analysis
 * Prevents over-concentration in correlated positions
 */

import tradier from './tradier.js';
import * as db from './db.js';

class CorrelationAnalysis {
  constructor() {
    this.MAX_CORRELATION = 0.70; // Reject if >0.7 correlation
    this.LOOKBACK_DAYS = 60;     // 60-day correlation window
  }

  /**
   * Calculate correlation between two stocks
   */
  async calculateCorrelation(symbol1, symbol2) {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - this.LOOKBACK_DAYS);

      // Fetch historical prices
      const [history1, history2] = await Promise.all([
        tradier.getHistory(symbol1, 'daily', startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]),
        tradier.getHistory(symbol2, 'daily', startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0])
      ]);

      if (!history1 || !history2 || history1.length < 20 || history2.length < 20) {
        return null; // Insufficient data
      }

      // Calculate daily returns
      const returns1 = this.calculateReturns(history1);
      const returns2 = this.calculateReturns(history2);

      // Align dates (in case of missing data)
      const aligned = this.alignReturns(returns1, returns2);
      if (aligned.length < 20) return null;

      // Calculate Pearson correlation
      return this.pearsonCorrelation(aligned.map(a => a.r1), aligned.map(a => a.r2));

    } catch (error) {
      console.warn(`Could not calculate correlation for ${symbol1}/${symbol2}:`, error.message);
      return null;
    }
  }

  /**
   * Calculate daily returns from price history
   */
  calculateReturns(history) {
    const returns = [];
    for (let i = 1; i < history.length; i++) {
      const prevClose = history[i - 1].close;
      const currClose = history[i].close;
      const dailyReturn = (currClose - prevClose) / prevClose;
      returns.push({
        date: history[i].date,
        return: dailyReturn
      });
    }
    return returns;
  }

  /**
   * Align returns by date
   */
  alignReturns(returns1, returns2) {
    const map1 = new Map(returns1.map(r => [r.date, r.return]));
    const map2 = new Map(returns2.map(r => [r.date, r.return]));

    const aligned = [];
    for (const [date, r1] of map1) {
      if (map2.has(date)) {
        aligned.push({ date, r1, r2: map2.get(date) });
      }
    }
    return aligned;
  }

  /**
   * Calculate Pearson correlation coefficient
   */
  pearsonCorrelation(x, y) {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    if (denominator === 0) return 0;
    return numerator / denominator;
  }

  /**
   * Check if new position is too correlated with existing holdings
   */
  async checkCorrelation(newSymbol, existingPositions) {
    const correlations = [];

    for (const position of existingPositions) {
      const corr = await this.calculateCorrelation(newSymbol, position.symbol);
      if (corr !== null) {
        correlations.push({
          symbol: position.symbol,
          correlation: corr,
          positionSize: Math.abs(position.quantity * position.current_price)
        });
      }
    }

    // Find highest correlation
    const maxCorr = correlations.reduce((max, c) => Math.max(max, Math.abs(c.correlation)), 0);

    if (maxCorr > this.MAX_CORRELATION) {
      const highCorrStock = correlations.find(c => Math.abs(c.correlation) === maxCorr);
      return {
        allowed: false,
        reason: `${newSymbol} has ${(maxCorr * 100).toFixed(0)}% correlation with existing position ${highCorrStock.symbol} (max ${(this.MAX_CORRELATION * 100).toFixed(0)}%)`,
        correlations
      };
    }

    return { allowed: true, correlations };
  }

  /**
   * Get correlation matrix for all positions
   */
  async getCorrelationMatrix(symbols) {
    const matrix = {};

    for (let i = 0; i < symbols.length; i++) {
      matrix[symbols[i]] = {};
      for (let j = 0; j < symbols.length; j++) {
        if (i === j) {
          matrix[symbols[i]][symbols[j]] = 1.0;
        } else if (matrix[symbols[j]] && matrix[symbols[j]][symbols[i]] !== undefined) {
          // Use already calculated correlation
          matrix[symbols[i]][symbols[j]] = matrix[symbols[j]][symbols[i]];
        } else {
          const corr = await this.calculateCorrelation(symbols[i], symbols[j]);
          matrix[symbols[i]][symbols[j]] = corr;
        }
      }
    }

    return matrix;
  }
}

export default new CorrelationAnalysis();
