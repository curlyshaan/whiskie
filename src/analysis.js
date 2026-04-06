import tradier from './tradier.js';
import claude from './claude.js';
import tavily from './tavily.js';
import riskManager from './risk-manager.js';
import { getPositions, upsertPosition } from './db.js';

/**
 * Portfolio Analysis Engine
 * Multi-factor analysis combining fundamentals and technicals
 */
class AnalysisEngine {
  constructor() {
    this.INITIAL_CAPITAL = parseFloat(process.env.INITIAL_CAPITAL) || 100000;
  }

  /**
   * Get complete portfolio state
   */
  async getPortfolioState() {
    try {
      const balances = await tradier.getBalances();
      const positions = await tradier.getPositions();
      const dbPositions = await getPositions();

      // Calculate portfolio metrics
      const cash = balances.total_cash || balances.cash?.cash_available || 0;
      const positionsValue = balances.long_market_value || 0;
      const totalValue = balances.total_equity || cash;

      // Calculate drawdown
      const drawdown = (totalValue - this.INITIAL_CAPITAL) / this.INITIAL_CAPITAL;

      return {
        totalValue,
        cash,
        positionsValue,
        positions: this.mergePositions(positions, dbPositions),
        drawdown,
        balances
      };
    } catch (error) {
      console.error('Error getting portfolio state:', error);
      throw error;
    }
  }

  /**
   * Merge Tradier positions with database positions
   */
  mergePositions(tradierPositions, dbPositions) {
    const merged = [];

    // Handle both single position and array
    const positions = Array.isArray(tradierPositions) ? tradierPositions : [tradierPositions];

    for (const tp of positions) {
      if (!tp || !tp.symbol) continue;

      const dbPos = dbPositions.find(p => p.symbol === tp.symbol);

      // Calculate per-share cost basis
      // Tradier sometimes returns total cost, not per-share
      let costBasis = dbPos?.cost_basis || 0;
      if (tp.cost_basis && tp.quantity) {
        const tradierCostBasis = parseFloat(tp.cost_basis);
        const quantity = parseInt(tp.quantity);

        // If Tradier's cost_basis is much larger than current price, it's likely total cost
        // Use a more robust check: if cost_basis / quantity is close to current price, it's total cost
        const perShareIfTotal = tradierCostBasis / quantity;
        const currentPrice = parseFloat(tp.last);

        // If dividing by quantity gives us something within 50% of current price, it's total cost
        if (Math.abs(perShareIfTotal - currentPrice) / currentPrice < 0.5) {
          costBasis = perShareIfTotal; // Convert to per-share
        } else if (tradierCostBasis > currentPrice * 2) {
          // Fallback: if cost basis is way higher than current price, likely total cost
          costBasis = tradierCostBasis / quantity;
        } else {
          costBasis = tradierCostBasis; // Already per-share
        }
      }

      merged.push({
        symbol: tp.symbol,
        quantity: tp.quantity,
        cost_basis: costBasis,
        currentPrice: tp.last || 0,
        sector: dbPos?.sector || 'Unknown',
        stock_type: dbPos?.stock_type || 'large-cap',
        entry_date: dbPos?.entry_date || new Date(),
        trimmed_1: dbPos?.trimmed_1 || false,
        trimmed_2: dbPos?.trimmed_2 || false,
        trimmed_3: dbPos?.trimmed_3 || false,
        stop_loss: dbPos?.stop_loss,
        take_profit: dbPos?.take_profit
      });
    }

    return merged;
  }

  /**
   * Analyze portfolio health
   */
  async analyzePortfolioHealth(portfolio) {
    const issues = [];
    const opportunities = [];

    // Check each position
    for (const position of portfolio.positions) {
      const currentPrice = position.currentPrice;
      const gain = (currentPrice - position.cost_basis) / position.cost_basis;

      // Check stop-loss triggers
      if (riskManager.shouldTriggerStopLoss(position, currentPrice)) {
        issues.push({
          type: 'stop-loss',
          symbol: position.symbol,
          message: `${position.symbol} hit stop-loss level`,
          severity: 'high'
        });
      }

      // Check take-profit opportunities
      const takeProfitAction = riskManager.shouldTriggerTakeProfit(position, currentPrice);
      if (takeProfitAction) {
        opportunities.push({
          type: 'take-profit',
          symbol: position.symbol,
          action: takeProfitAction,
          message: `${position.symbol} ${takeProfitAction.reason}`
        });
      }

      // Check positions needing attention (20%+ loss)
      if (riskManager.needsAttention(position, currentPrice)) {
        issues.push({
          type: 'attention',
          symbol: position.symbol,
          message: `${position.symbol} down ${(gain * 100).toFixed(1)}% - needs review`,
          severity: 'medium'
        });
      }
    }

    // Check defensive mode
    if (riskManager.isDefensiveMode(portfolio)) {
      issues.push({
        type: 'defensive-mode',
        message: 'Portfolio in defensive mode - reduce risk',
        severity: 'high',
        actions: riskManager.getDefensiveModeActions()
      });
    }

    return { issues, opportunities };
  }

  /**
   * Calculate technical indicators for a stock
   */
  async getTechnicalIndicators(symbol) {
    try {
      // Get 200 days of history for moving averages
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const history = await tradier.getHistory(symbol, 'daily', startDate, endDate);

      if (!history || history.length < 50) {
        return null;
      }

      const prices = history.map(d => d.close);
      const volumes = history.map(d => d.volume);

      // Calculate indicators
      const currentPrice = prices[prices.length - 1];
      const sma50 = this.calculateSMA(prices, 50);
      const sma200 = this.calculateSMA(prices, 200);
      const rsi = this.calculateRSI(prices, 14);

      return {
        currentPrice,
        sma50,
        sma200,
        rsi,
        trend: currentPrice > sma200 ? 'uptrend' : 'downtrend',
        aboveSMA50: currentPrice > sma50,
        aboveSMA200: currentPrice > sma200,
        avgVolume: volumes.slice(-20).reduce((a, b) => a + b, 0) / 20
      };
    } catch (error) {
      console.error(`Error getting technicals for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Calculate Simple Moving Average
   */
  calculateSMA(prices, period) {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  /**
   * Calculate RSI (Relative Strength Index)
   */
  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;

    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }

    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);

    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return rsi;
  }

  /**
   * Evaluate a stock for purchase
   */
  async evaluateStockForPurchase(symbol) {
    try {
      console.log(`📊 Evaluating ${symbol}...`);

      // Get quote
      const quote = await tradier.getQuote(symbol);
      if (!quote) {
        return { recommendation: 'SKIP', reason: 'No quote data available' };
      }

      // Get technical indicators
      const technicals = await this.getTechnicalIndicators(symbol);

      // Get news
      const news = await tavily.searchStockNews(symbol, 3);
      const formattedNews = tavily.formatResults(news);

      // Get fundamentals (if available)
      let fundamentals = null;
      try {
        fundamentals = await tradier.getFundamentals(symbol);
      } catch (err) {
        console.log(`No fundamentals available for ${symbol}`);
      }

      // Ask Claude to evaluate
      const analysis = await claude.evaluateStock(
        symbol,
        fundamentals,
        technicals,
        formattedNews
      );

      return {
        symbol,
        currentPrice: quote.last,
        analysis: analysis.analysis,
        technicals,
        news: formattedNews
      };
    } catch (error) {
      console.error(`Error evaluating ${symbol}:`, error.message);
      return { recommendation: 'ERROR', reason: error.message };
    }
  }

  /**
   * Evaluate whether to sell a position
   */
  async evaluateSellDecision(position, reason) {
    try {
      console.log(`🔍 Evaluating sell decision for ${position.symbol}...`);

      // Get current price
      const quote = await tradier.getQuote(position.symbol);
      const currentPrice = quote.last;

      // Get news
      const news = await tavily.searchStockNews(position.symbol, 3);
      const formattedNews = tavily.formatResults(news);

      // Ask Claude to evaluate
      const analysis = await claude.evaluateSell(
        position.symbol,
        position,
        currentPrice,
        formattedNews,
        reason
      );

      return {
        symbol: position.symbol,
        currentPrice,
        analysis: analysis.analysis,
        news: formattedNews
      };
    } catch (error) {
      console.error(`Error evaluating sell for ${position.symbol}:`, error.message);
      return { recommendation: 'ERROR', reason: error.message };
    }
  }

  /**
   * Get sector allocation
   */
  getSectorAllocation(portfolio) {
    const sectorValues = {};
    let totalPositionsValue = 0;

    for (const position of portfolio.positions) {
      const value = position.quantity * position.currentPrice;
      const sector = position.sector || 'Unknown';

      sectorValues[sector] = (sectorValues[sector] || 0) + value;
      totalPositionsValue += value;
    }

    const allocation = {};
    for (const [sector, value] of Object.entries(sectorValues)) {
      allocation[sector] = {
        value,
        percentage: (value / portfolio.totalValue) * 100
      };
    }

    return allocation;
  }

  /**
   * Find rebalancing opportunities
   */
  findRebalancingOpportunities(portfolio) {
    const opportunities = [];
    const sectorAllocation = this.getSectorAllocation(portfolio);

    // Check for overweight sectors
    for (const [sector, data] of Object.entries(sectorAllocation)) {
      if (data.percentage > 25) {
        opportunities.push({
          type: 'trim-sector',
          sector,
          current: data.percentage,
          target: 25,
          message: `${sector} is ${data.percentage.toFixed(1)}% (max 25%)`
        });
      }
    }

    // Check for underweight cash
    const cashPercentage = (portfolio.cash / portfolio.totalValue) * 100;
    if (cashPercentage < 3) {
      opportunities.push({
        type: 'increase-cash',
        current: cashPercentage,
        target: 5,
        message: `Cash reserve ${cashPercentage.toFixed(1)}% (min 3%, target 5%)`
      });
    }

    return opportunities;
  }
}

export default new AnalysisEngine();
