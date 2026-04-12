/**
 * Portfolio Risk Metrics
 * Calculates beta, Sharpe ratio, max drawdown, volatility
 */

import tradier from './tradier.js';
import * as db from './db.js';

class PortfolioRiskMetrics {
  constructor() {
    this.RISK_FREE_RATE = 0.045; // 4.5% annual risk-free rate (10-year Treasury)
    this.LOOKBACK_DAYS = 252;    // 1 year of trading days
  }

  /**
   * Calculate all portfolio risk metrics
   */
  async calculateRiskMetrics(portfolioValue) {
    try {
      const positions = await db.getPositions();
      if (positions.length === 0) {
        return this.getEmptyMetrics();
      }

      // Get portfolio returns history
      const returns = await this.getPortfolioReturns();
      if (returns.length < 20) {
        return this.getEmptyMetrics();
      }

      // Calculate metrics
      const volatility = this.calculateVolatility(returns);
      const sharpeRatio = this.calculateSharpeRatio(returns, volatility);
      const maxDrawdown = this.calculateMaxDrawdown(returns);
      const beta = await this.calculateBeta(returns);

      return {
        volatility: (volatility * 100).toFixed(2) + '%',
        sharpeRatio: sharpeRatio.toFixed(2),
        maxDrawdown: (maxDrawdown * 100).toFixed(2) + '%',
        beta: beta.toFixed(2),
        riskFreeRate: (this.RISK_FREE_RATE * 100).toFixed(2) + '%'
      };

    } catch (error) {
      console.error('Error calculating risk metrics:', error);
      return this.getEmptyMetrics();
    }
  }

  /**
   * Get portfolio returns from snapshots
   */
  async getPortfolioReturns() {
    const result = await db.query(
      `SELECT total_value, snapshot_date
       FROM portfolio_snapshots
       WHERE snapshot_date >= NOW() - INTERVAL '${this.LOOKBACK_DAYS} days'
       ORDER BY snapshot_date ASC`
    );

    if (result.rows.length < 2) return [];

    const returns = [];
    for (let i = 1; i < result.rows.length; i++) {
      const prevValue = parseFloat(result.rows[i - 1].total_value);
      const currValue = parseFloat(result.rows[i].total_value);
      const dailyReturn = (currValue - prevValue) / prevValue;
      returns.push(dailyReturn);
    }

    return returns;
  }

  /**
   * Calculate annualized volatility
   */
  calculateVolatility(returns) {
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const dailyVol = Math.sqrt(variance);
    return dailyVol * Math.sqrt(252); // Annualize
  }

  /**
   * Calculate Sharpe ratio
   */
  calculateSharpeRatio(returns, annualizedVol) {
    const avgDailyReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const annualizedReturn = avgDailyReturn * 252;
    const excessReturn = annualizedReturn - this.RISK_FREE_RATE;
    return excessReturn / annualizedVol;
  }

  /**
   * Calculate maximum drawdown
   */
  calculateMaxDrawdown(returns) {
    let peak = 1.0;
    let maxDD = 0;
    let cumulative = 1.0;

    for (const r of returns) {
      cumulative *= (1 + r);
      if (cumulative > peak) {
        peak = cumulative;
      }
      const drawdown = (peak - cumulative) / peak;
      if (drawdown > maxDD) {
        maxDD = drawdown;
      }
    }

    return maxDD;
  }

  /**
   * Calculate portfolio beta vs S&P 500
   */
  async calculateBeta(portfolioReturns) {
    try {
      // Fetch SPY (S&P 500 ETF) returns for same period
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - this.LOOKBACK_DAYS);

      const spyHistory = await tradier.getHistory(
        'SPY',
        'daily',
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0]
      );

      if (!spyHistory || spyHistory.length < 2) return 1.0;

      // Calculate SPY returns
      const spyReturns = [];
      for (let i = 1; i < spyHistory.length; i++) {
        const prevClose = spyHistory[i - 1].close;
        const currClose = spyHistory[i].close;
        spyReturns.push((currClose - prevClose) / prevClose);
      }

      // Align lengths
      const minLength = Math.min(portfolioReturns.length, spyReturns.length);
      const alignedPortfolio = portfolioReturns.slice(-minLength);
      const alignedSpy = spyReturns.slice(-minLength);

      // Calculate covariance and variance
      const portfolioMean = alignedPortfolio.reduce((sum, r) => sum + r, 0) / minLength;
      const spyMean = alignedSpy.reduce((sum, r) => sum + r, 0) / minLength;

      let covariance = 0;
      let spyVariance = 0;

      for (let i = 0; i < minLength; i++) {
        covariance += (alignedPortfolio[i] - portfolioMean) * (alignedSpy[i] - spyMean);
        spyVariance += Math.pow(alignedSpy[i] - spyMean, 2);
      }

      covariance /= minLength;
      spyVariance /= minLength;

      return covariance / spyVariance;

    } catch (error) {
      console.warn('Could not calculate beta:', error.message);
      return 1.0; // Default to market beta
    }
  }

  /**
   * Get empty metrics structure
   */
  getEmptyMetrics() {
    return {
      volatility: 'N/A',
      sharpeRatio: 'N/A',
      maxDrawdown: 'N/A',
      beta: 'N/A',
      riskFreeRate: (this.RISK_FREE_RATE * 100).toFixed(2) + '%'
    };
  }
}

export default new PortfolioRiskMetrics();
