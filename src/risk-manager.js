import dotenv from 'dotenv';

dotenv.config();

/**
 * Risk Manager
 * Enforces hard-coded safety limits and validates trades
 */
class RiskManager {
  constructor() {
    this.MAX_POSITION_SIZE = parseFloat(process.env.MAX_POSITION_SIZE) || 0.15; // 15%
    this.MAX_DAILY_TRADES = parseInt(process.env.MAX_DAILY_TRADES) || 3;
    this.MAX_PORTFOLIO_DRAWDOWN = parseFloat(process.env.MAX_PORTFOLIO_DRAWDOWN) || 0.20; // 20%
    this.MIN_CASH_RESERVE = parseFloat(process.env.MIN_CASH_RESERVE) || 0.03; // 3%
    this.MAX_SECTOR_ALLOCATION = parseFloat(process.env.MAX_SECTOR_ALLOCATION) || 0.25; // 25%

    this.dailyTradeCount = 0;
    this.lastTradeDate = null;
  }

  /**
   * Reset daily trade counter
   */
  resetDailyCounter() {
    const today = new Date().toDateString();
    if (this.lastTradeDate !== today) {
      this.dailyTradeCount = 0;
      this.lastTradeDate = today;
    }
  }

  /**
   * Validate a proposed trade
   */
  validateTrade(trade, portfolio) {
    this.resetDailyCounter();

    const errors = [];

    // Check daily trade limit
    if (this.dailyTradeCount >= this.MAX_DAILY_TRADES) {
      errors.push(`Daily trade limit reached (${this.MAX_DAILY_TRADES} trades/day)`);
    }

    // Check position size
    const tradeValue = trade.quantity * trade.price;
    const positionSize = tradeValue / portfolio.totalValue;

    if (positionSize > this.MAX_POSITION_SIZE) {
      errors.push(`Position size ${(positionSize * 100).toFixed(1)}% exceeds max ${(this.MAX_POSITION_SIZE * 100)}%`);
    }

    // Check cash reserve after trade
    const cashAfterTrade = portfolio.cash - tradeValue;
    const cashReserveRatio = cashAfterTrade / portfolio.totalValue;

    if (cashReserveRatio < this.MIN_CASH_RESERVE) {
      errors.push(`Trade would leave ${(cashReserveRatio * 100).toFixed(1)}% cash, below minimum ${(this.MIN_CASH_RESERVE * 100)}%`);
    }

    // Check sector allocation (for buys)
    if (trade.action === 'buy') {
      const newSectorAllocation = this.calculateSectorAllocation(
        portfolio,
        trade.symbol,
        trade.sector,
        tradeValue
      );

      if (newSectorAllocation > this.MAX_SECTOR_ALLOCATION) {
        errors.push(`Sector allocation would be ${(newSectorAllocation * 100).toFixed(1)}%, exceeds max ${(this.MAX_SECTOR_ALLOCATION * 100)}%`);
      }
    }

    // Check portfolio drawdown
    if (portfolio.drawdown && Math.abs(portfolio.drawdown) > this.MAX_PORTFOLIO_DRAWDOWN) {
      errors.push(`Portfolio drawdown ${(portfolio.drawdown * 100).toFixed(1)}% exceeds max ${(this.MAX_PORTFOLIO_DRAWDOWN * 100)}% - DEFENSIVE MODE`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: this.generateWarnings(trade, portfolio)
    };
  }

  /**
   * Calculate sector allocation after trade
   */
  calculateSectorAllocation(portfolio, symbol, sector, additionalValue) {
    const currentSectorValue = portfolio.positions
      .filter(p => p.sector === sector)
      .reduce((sum, p) => sum + (p.quantity * p.currentPrice), 0);

    const newSectorValue = currentSectorValue + additionalValue;
    return newSectorValue / portfolio.totalValue;
  }

  /**
   * Generate warnings (not blocking, but important)
   */
  generateWarnings(trade, portfolio) {
    const warnings = [];

    // Warn if approaching limits
    const tradeValue = trade.quantity * trade.price;
    const positionSize = tradeValue / portfolio.totalValue;

    if (positionSize > this.MAX_POSITION_SIZE * 0.8) {
      warnings.push(`Position size ${(positionSize * 100).toFixed(1)}% is close to max limit`);
    }

    // Warn if too many positions
    if (portfolio.positions.length >= 12) {
      warnings.push('Portfolio already has 12 positions (max recommended)');
    }

    // Warn if concentration risk
    const top3Positions = portfolio.positions
      .sort((a, b) => (b.quantity * b.currentPrice) - (a.quantity * a.currentPrice))
      .slice(0, 3);

    const top3Value = top3Positions.reduce((sum, p) => sum + (p.quantity * p.currentPrice), 0);
    const top3Percentage = top3Value / portfolio.totalValue;

    if (top3Percentage > 0.35) {
      warnings.push(`Top 3 positions represent ${(top3Percentage * 100).toFixed(1)}% of portfolio (max recommended: 35%)`);
    }

    return warnings;
  }

  /**
   * Calculate position size based on risk level
   */
  calculatePositionSize(stockType, portfolioValue) {
    const sizeMap = {
      'index-etf': 0.15,      // 15% max
      'mega-cap': 0.12,       // 12% max
      'large-cap': 0.10,      // 10% max
      'mid-cap': 0.08,        // 8% max
      'opportunistic': 0.05   // 5% max
    };

    const maxSize = sizeMap[stockType] || 0.10;
    return Math.min(maxSize, this.MAX_POSITION_SIZE);
  }

  /**
   * Calculate stop-loss level based on stock type
   */
  calculateStopLoss(stockType, entryPrice) {
    const stopLossMap = {
      'index-etf': 0.12,      // -12%
      'blue-chip': 0.12,      // -12%
      'large-cap': 0.15,      // -15%
      'mid-cap': 0.18,        // -18%
      'opportunistic': 0.20   // -20%
    };

    const stopLossPercent = stopLossMap[stockType] || 0.15;
    return entryPrice * (1 - stopLossPercent);
  }

  /**
   * Check if stop-loss should trigger
   */
  shouldTriggerStopLoss(position, currentPrice) {
    const loss = (currentPrice - position.cost_basis) / position.cost_basis;
    const stopLossLevel = this.calculateStopLoss(position.stockType, position.cost_basis);

    return currentPrice <= stopLossLevel;
  }

  /**
   * Check if take-profit should trigger
   */
  shouldTriggerTakeProfit(position, currentPrice) {
    const gain = (currentPrice - position.cost_basis) / position.cost_basis;

    // First trim at +15-20%
    if (gain >= 0.15 && !position.trimmed_1) {
      return { action: 'trim', percentage: 0.25, reason: 'First take-profit at +15%' };
    }

    // Second trim at +25-30%
    if (gain >= 0.25 && !position.trimmed_2) {
      return { action: 'trim', percentage: 0.25, reason: 'Second take-profit at +25%' };
    }

    // Third trim at +40%
    if (gain >= 0.40 && !position.trimmed_3) {
      return { action: 'trim', percentage: 0.25, reason: 'Third take-profit at +40%' };
    }

    return null;
  }

  /**
   * Check if position needs attention (20%+ drop)
   */
  needsAttention(position, currentPrice) {
    const loss = (currentPrice - position.cost_basis) / position.cost_basis;
    return loss <= -0.20; // 20% or more loss
  }

  /**
   * Increment daily trade counter
   */
  recordTrade() {
    this.resetDailyCounter();
    this.dailyTradeCount++;
  }

  /**
   * Check if in defensive mode (portfolio down 15%+)
   */
  isDefensiveMode(portfolio) {
    return portfolio.drawdown && Math.abs(portfolio.drawdown) >= 0.15;
  }

  /**
   * Get defensive mode recommendations
   */
  getDefensiveModeActions() {
    return {
      mode: 'defensive',
      actions: [
        'Reduce new position sizes by 50%',
        'Tighten stop-losses by 20%',
        'Increase cash reserve to 10%',
        'Focus on defensive sectors (Consumer Staples, Healthcare, Utilities)',
        'Avoid new opportunistic positions',
        'Consider trimming losing positions'
      ]
    };
  }
}

export default new RiskManager();
