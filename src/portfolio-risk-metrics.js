/**
 * Portfolio Risk Metrics
 * Calculates benchmark-relative return, beta, Sharpe ratio, VaR, drawdown, volatility, and correlation concentration.
 */

import tradier from './tradier.js';
import * as db from './db.js';
import fmp from './fmp.js';

class PortfolioRiskMetrics {
  constructor() {
    this.RISK_FREE_RATE = 0.045;
    this.LOOKBACK_DAYS = 252;
    this.BENCHMARK_SYMBOL = 'SPY';
    this.VAR_CONFIDENCE = 0.95;
  }

  async calculateRiskMetrics(portfolioValue = null, options = {}) {
    try {
      const positions = Array.isArray(options.positions) && options.positions.length
        ? options.positions
        : await db.getPositions();
      if (!positions.length) {
        return this.getEmptyMetrics();
      }

      const portfolioSeries = await this.getPortfolioValueSeries();
      if (portfolioSeries.length < 20) {
        return this.getEmptyMetrics();
      }

      const portfolioReturns = this.extractReturnsFromSeries(portfolioSeries);
      if (portfolioReturns.length < 20) {
        return this.getEmptyMetrics();
      }

      const benchmarkSeries = await this.getBenchmarkSeries(options.benchmarkSymbol || this.BENCHMARK_SYMBOL, portfolioSeries[0]?.date, portfolioSeries[portfolioSeries.length - 1]?.date);
      const benchmarkReturns = this.extractReturnsFromSeries(benchmarkSeries);
      const aligned = this.alignSeries(portfolioReturns, benchmarkReturns);
      const alignedPortfolioReturns = aligned.portfolio;
      const alignedBenchmarkReturns = aligned.benchmark;
      const latestPortfolioValue = Number(portfolioValue || portfolioSeries[portfolioSeries.length - 1]?.value || 0);
      const volatility = this.calculateVolatility(alignedPortfolioReturns);
      const sharpeRatio = this.calculateSharpeRatio(alignedPortfolioReturns, volatility);
      const sortinoRatio = this.calculateSortinoRatio(alignedPortfolioReturns);
      const maxDrawdown = this.calculateMaxDrawdown(alignedPortfolioReturns);
      const beta = this.calculateBeta(alignedPortfolioReturns, alignedBenchmarkReturns);
      const correlation = this.calculateCorrelation(alignedPortfolioReturns, alignedBenchmarkReturns);
      const valueAtRiskPct = this.calculateHistoricalVaR(alignedPortfolioReturns);
      const benchmarkReturnPct = this.calculateCumulativeReturn(alignedBenchmarkReturns);
      const portfolioReturnPct = this.calculateCumulativeReturn(alignedPortfolioReturns);
      const activeReturnPct = portfolioReturnPct - benchmarkReturnPct;
      const monthlyReturnPct = this.calculateCumulativeReturn(alignedPortfolioReturns.slice(-21));
      const benchmarkMonthlyReturnPct = this.calculateCumulativeReturn(alignedBenchmarkReturns.slice(-21));
      const activeMonthlyReturnPct = monthlyReturnPct - benchmarkMonthlyReturnPct;
      const holdingsBreakdown = await this.buildHoldingsBreakdown(positions, latestPortfolioValue || portfolioValue || 0);
      const correlationMatrix = await this.buildCorrelationMatrix(positions);
      const diversificationScore = this.calculateDiversificationScore(holdingsBreakdown, correlationMatrix);

      return {
        benchmarkSymbol: options.benchmarkSymbol || this.BENCHMARK_SYMBOL,
        riskFreeRate: this.toPctString(this.RISK_FREE_RATE),
        volatility: this.toPctString(volatility),
        sharpeRatio: this.toFixedString(sharpeRatio),
        sortinoRatio: this.toFixedString(sortinoRatio),
        maxDrawdown: this.toPctString(maxDrawdown),
        beta: this.toFixedString(beta),
        correlationToBenchmark: this.toFixedString(correlation),
        valueAtRisk95: this.toPctString(valueAtRiskPct),
        valueAtRisk95Value: Number.isFinite(latestPortfolioValue) ? Number((latestPortfolioValue * valueAtRiskPct).toFixed(2)) : null,
        portfolioReturnPct: this.toPctString(portfolioReturnPct),
        benchmarkReturnPct: this.toPctString(benchmarkReturnPct),
        activeReturnPct: this.toPctString(activeReturnPct),
        monthlyReturnPct: this.toPctString(monthlyReturnPct),
        benchmarkMonthlyReturnPct: this.toPctString(benchmarkMonthlyReturnPct),
        activeMonthlyReturnPct: this.toPctString(activeMonthlyReturnPct),
        diversificationScore: this.toFixedString(diversificationScore),
        concentrationRisk: this.buildConcentrationRiskLabel(diversificationScore, holdingsBreakdown),
        holdingsBreakdown,
        correlationMatrix,
        returnsSampleSize: alignedPortfolioReturns.length
      };
    } catch (error) {
      console.error('Error calculating risk metrics:', error);
      return this.getEmptyMetrics();
    }
  }

  async getPortfolioValueSeries() {
    const result = await db.query(
      `SELECT snapshot_date, total_value
       FROM portfolio_snapshots
       WHERE snapshot_date >= NOW() - INTERVAL '${this.LOOKBACK_DAYS} days'
       ORDER BY snapshot_date ASC`
    );

    return (result.rows || [])
      .map(row => ({
        date: String(row.snapshot_date).slice(0, 10),
        value: Number(row.total_value || 0)
      }))
      .filter(row => Number.isFinite(row.value) && row.value > 0);
  }

  async getBenchmarkSeries(symbol, startDate, endDate) {
    if (!startDate || !endDate) return [];
    try {
      const history = await tradier.getHistory(symbol, 'daily', startDate, endDate);
      return (history || [])
        .map(row => ({
          date: String(row.date || '').slice(0, 10),
          value: Number(row.close || 0)
        }))
        .filter(row => row.date && Number.isFinite(row.value) && row.value > 0);
    } catch (error) {
      console.warn(`Could not calculate benchmark history for ${symbol}:`, error.message);
      return [];
    }
  }

  extractReturnsFromSeries(series = []) {
    if (!Array.isArray(series) || series.length < 2) return [];
    const returns = [];
    for (let i = 1; i < series.length; i++) {
      const prev = Number(series[i - 1]?.value || 0);
      const curr = Number(series[i]?.value || 0);
      if (prev > 0 && curr > 0) {
        returns.push({
          date: series[i].date,
          value: (curr - prev) / prev
        });
      }
    }
    return returns;
  }

  alignSeries(portfolioReturns = [], benchmarkReturns = []) {
    const benchmarkMap = new Map((benchmarkReturns || []).map(row => [row.date, Number(row.value || 0)]));
    const alignedPortfolio = [];
    const alignedBenchmark = [];
    for (const row of portfolioReturns || []) {
      if (!benchmarkMap.has(row.date)) continue;
      alignedPortfolio.push(Number(row.value || 0));
      alignedBenchmark.push(Number(benchmarkMap.get(row.date) || 0));
    }
    return {
      portfolio: alignedPortfolio,
      benchmark: alignedBenchmark.length ? alignedBenchmark : new Array(alignedPortfolio.length).fill(0)
    };
  }

  calculateVolatility(returns = []) {
    if (!returns.length) return 0;
    const mean = this.mean(returns);
    const variance = this.mean(returns.map(r => Math.pow(r - mean, 2)));
    return Math.sqrt(Math.max(variance, 0)) * Math.sqrt(252);
  }

  calculateSharpeRatio(returns = [], annualizedVol = 0) {
    if (!returns.length || !annualizedVol) return 0;
    const annualizedReturn = this.mean(returns) * 252;
    return (annualizedReturn - this.RISK_FREE_RATE) / annualizedVol;
  }

  calculateSortinoRatio(returns = []) {
    if (!returns.length) return 0;
    const downside = returns.filter(r => r < 0);
    if (!downside.length) return 0;
    const downsideDeviation = Math.sqrt(this.mean(downside.map(r => r * r))) * Math.sqrt(252);
    if (!downsideDeviation) return 0;
    const annualizedReturn = this.mean(returns) * 252;
    return (annualizedReturn - this.RISK_FREE_RATE) / downsideDeviation;
  }

  calculateMaxDrawdown(returns = []) {
    let peak = 1;
    let cumulative = 1;
    let maxDrawdown = 0;
    for (const value of returns) {
      cumulative *= (1 + value);
      peak = Math.max(peak, cumulative);
      maxDrawdown = Math.max(maxDrawdown, (peak - cumulative) / peak);
    }
    return maxDrawdown;
  }

  calculateBeta(portfolioReturns = [], benchmarkReturns = []) {
    if (!portfolioReturns.length || portfolioReturns.length !== benchmarkReturns.length) return 0;
    const portfolioMean = this.mean(portfolioReturns);
    const benchmarkMean = this.mean(benchmarkReturns);
    let covariance = 0;
    let benchmarkVariance = 0;
    for (let i = 0; i < portfolioReturns.length; i++) {
      covariance += (portfolioReturns[i] - portfolioMean) * (benchmarkReturns[i] - benchmarkMean);
      benchmarkVariance += Math.pow(benchmarkReturns[i] - benchmarkMean, 2);
    }
    covariance /= portfolioReturns.length;
    benchmarkVariance /= portfolioReturns.length;
    return benchmarkVariance ? covariance / benchmarkVariance : 0;
  }

  calculateCorrelation(a = [], b = []) {
    if (!a.length || a.length !== b.length) return 0;
    const meanA = this.mean(a);
    const meanB = this.mean(b);
    let covariance = 0;
    let varianceA = 0;
    let varianceB = 0;
    for (let i = 0; i < a.length; i++) {
      covariance += (a[i] - meanA) * (b[i] - meanB);
      varianceA += Math.pow(a[i] - meanA, 2);
      varianceB += Math.pow(b[i] - meanB, 2);
    }
    const denominator = Math.sqrt(varianceA * varianceB);
    return denominator ? covariance / denominator : 0;
  }

  calculateHistoricalVaR(returns = []) {
    if (!returns.length) return 0;
    const sorted = [...returns].sort((a, b) => a - b);
    const index = Math.max(0, Math.floor((1 - this.VAR_CONFIDENCE) * sorted.length));
    return Math.abs(sorted[index] || 0);
  }

  calculateCumulativeReturn(returns = []) {
    if (!returns.length) return 0;
    return returns.reduce((acc, value) => acc * (1 + value), 1) - 1;
  }

  async buildHoldingsBreakdown(positions = [], portfolioValue = 0) {
    const totalValue = Number(portfolioValue || 0);
    return (positions || []).map(position => {
      const marketValue = Math.abs(Number(position.quantity || 0) * Number(position.current_price || position.currentPrice || 0));
      return {
        symbol: position.symbol,
        positionType: position.position_type || (Number(position.quantity || 0) < 0 ? 'short' : 'long'),
        weightPct: totalValue > 0 ? Number(((marketValue / totalValue) * 100).toFixed(2)) : 0,
        marketValue: Number(marketValue.toFixed(2))
      };
    }).sort((a, b) => b.weightPct - a.weightPct);
  }

  async buildCorrelationMatrix(positions = []) {
    const symbols = [...new Set((positions || []).map(position => String(position.symbol || '').toUpperCase()).filter(Boolean))].slice(0, 8);
    if (symbols.length < 2) return [];

    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 90);
    const from = start.toISOString().split('T')[0];
    const to = end.toISOString().split('T')[0];
    const histories = new Map();

    for (const symbol of symbols) {
      try {
        const history = await fmp.getHistoricalPriceEodFull(symbol, from, to);
        histories.set(symbol, this.extractReturnsFromSeries((history || []).map(row => ({ date: row.date, value: Number(row.close || 0) }))));
      } catch (error) {
        histories.set(symbol, []);
      }
    }

    const matrix = [];
    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const left = histories.get(symbols[i]) || [];
        const right = histories.get(symbols[j]) || [];
        const aligned = this.alignSeries(left, right);
        if (aligned.portfolio.length < 15) continue;
        matrix.push({
          left: symbols[i],
          right: symbols[j],
          correlation: Number(this.calculateCorrelation(aligned.portfolio, aligned.benchmark).toFixed(2))
        });
      }
    }

    return matrix.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)).slice(0, 10);
  }

  calculateDiversificationScore(holdingsBreakdown = [], correlationMatrix = []) {
    if (!holdingsBreakdown.length) return 0;
    const topWeight = Math.max(...holdingsBreakdown.map(row => Number(row.weightPct || 0)), 0);
    const avgAbsCorrelation = correlationMatrix.length
      ? this.mean(correlationMatrix.map(row => Math.abs(Number(row.correlation || 0))))
      : 0.25;
    const diversification = 100 - (topWeight * 2.5) - (avgAbsCorrelation * 35);
    return Math.max(0, Math.min(100, diversification));
  }

  buildConcentrationRiskLabel(diversificationScore, holdingsBreakdown = []) {
    const topHolding = holdingsBreakdown[0];
    if (diversificationScore < 35) {
      return topHolding ? `High concentration risk (${topHolding.symbol} at ${topHolding.weightPct}%)` : 'High concentration risk';
    }
    if (diversificationScore < 65) return 'Moderate concentration risk';
    return 'Well diversified';
  }

  mean(values = []) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
  }

  toPctString(value) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : 'N/A';
  }

  toFixedString(value) {
    return Number.isFinite(value) ? Number(value).toFixed(2) : 'N/A';
  }

  getEmptyMetrics() {
    return {
      benchmarkSymbol: this.BENCHMARK_SYMBOL,
      riskFreeRate: this.toPctString(this.RISK_FREE_RATE),
      volatility: 'N/A',
      sharpeRatio: 'N/A',
      sortinoRatio: 'N/A',
      maxDrawdown: 'N/A',
      beta: 'N/A',
      correlationToBenchmark: 'N/A',
      valueAtRisk95: 'N/A',
      valueAtRisk95Value: null,
      portfolioReturnPct: 'N/A',
      benchmarkReturnPct: 'N/A',
      activeReturnPct: 'N/A',
      monthlyReturnPct: 'N/A',
      benchmarkMonthlyReturnPct: 'N/A',
      activeMonthlyReturnPct: 'N/A',
      diversificationScore: 'N/A',
      concentrationRisk: 'N/A',
      holdingsBreakdown: [],
      correlationMatrix: [],
      returnsSampleSize: 0
    };
  }
}

export default new PortfolioRiskMetrics();
