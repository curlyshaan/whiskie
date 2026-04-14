import dotenv from 'dotenv';
import correlationAnalysis from './correlation-analysis.js';
import vixRegime from './vix-regime.js';
import allocationManager from './allocation-manager.js';
import * as db from './db.js';

dotenv.config();

/**
 * Risk Manager
 * Enforces hard-coded safety limits and validates trades
 */
class RiskManager {
  constructor() {
    // 3-Pillar Strategy: Long-term anchors (35-40%) + Swing/momentum (30-35%) + Shorts (15-20%)
    this.MAX_POSITION_SIZE = parseFloat(process.env.MAX_POSITION_SIZE) || 0.12; // 12% max per position (down from 15%)
    this.MAX_SHORT_POSITION_SIZE = 0.10; // 10% for shorts (tighter due to unlimited loss risk)
    this.MAX_DAILY_TRADES = parseInt(process.env.MAX_DAILY_TRADES) || 7;
    this.MAX_PORTFOLIO_DRAWDOWN = parseFloat(process.env.MAX_PORTFOLIO_DRAWDOWN) || 0.20; // 20%
    this.MIN_CASH_RESERVE = parseFloat(process.env.MIN_CASH_RESERVE) || 0.10; // 10% minimum cash (up from 3%)
    this.MAX_SECTOR_ALLOCATION = parseFloat(process.env.MAX_SECTOR_ALLOCATION) || 0.30; // 30% per sector (both long and short)
    this.MAX_SHORT_SECTOR_ALLOCATION = 0.30; // 30% shorts per sector
    this.MAX_TOTAL_SHORT_EXPOSURE = parseFloat(process.env.MAX_TOTAL_SHORT_EXPOSURE) || 0.20; // 20% total shorts (down from 30%, scale up after 60 days)
    this.TARGET_LONG_ALLOCATION = 0.70; // 70% long (typical)
    this.MAX_LONG_ALLOCATION = 0.80; // 80% long (hard limit)
  }

  /**
   * Validate a proposed trade
   * Note: Daily trade count now uses database-backed tradeSafeguard, not in-memory counter
   * @param {Object} trade - Trade to validate
   * @param {Object} portfolio - Current portfolio state
   * @param {number} maxAssetClassAllocation - Optional VIX-adjusted asset class limit (defaults to dynamic calculation)
   */
  async validateTrade(trade, portfolio, maxAssetClassAllocation = null) {
    const errors = [];
    const warnings = [];

    // Check position size
    const tradeValue = trade.quantity * trade.price;
    const positionSize = tradeValue / portfolio.totalValue;

    if (positionSize > this.MAX_POSITION_SIZE) {
      errors.push(`Position size ${(positionSize * 100).toFixed(1)}% exceeds max ${(this.MAX_POSITION_SIZE * 100)}%`);
    }

    // Cash reserve check removed - cash level now informs Claude's judgment via checkCashState()
    // instead of mechanically blocking trades

    // Check asset class allocation (for buys)
    if (trade.action === 'buy') {
      const assetClass = trade.assetClass || 'Unknown';

      // Validate asset class allocation
      const validation = await allocationManager.validateAssetClassAllocation(
        trade.symbol,
        tradeValue,
        portfolio
      );

      if (!validation.valid) {
        errors.push(validation.error);
      }

      // Check correlation with existing positions
      const correlationCheck = await correlationAnalysis.checkCorrelation(
        trade.symbol,
        portfolio.positions
      );

      if (correlationCheck.hasHighCorrelation) {
        warnings.push(...correlationCheck.warnings);
      }
    }

    // Check portfolio drawdown
    if (portfolio.drawdown && Math.abs(portfolio.drawdown) > this.MAX_PORTFOLIO_DRAWDOWN) {
      errors.push(`Portfolio drawdown ${(portfolio.drawdown * 100).toFixed(1)}% exceeds max ${(this.MAX_PORTFOLIO_DRAWDOWN * 100)}% - DEFENSIVE MODE`);
    }

    // Add additional warnings from generateWarnings (now async)
    const additionalWarnings = await this.generateWarnings(trade, portfolio);
    warnings.push(...additionalWarnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  // Remove old calculateSectorAllocation - replaced by allocationManager

  /**
   * Generate warnings (not blocking, but important)
   */
  async generateWarnings(trade, portfolio) {
    const warnings = [];

    // Check VIX regime constraints
    try {
      const regime = await vixRegime.getRegime();

      // Warn if attempting new shorts in elevated volatility
      if (trade.action === 'buy' && trade.position_type === 'short' && !regime.newShortsAllowed) {
        warnings.push(`VIX regime (${regime.name}) does not allow new short positions - volatility too high`);
      }

      // Warn if attempting any new positions in panic mode
      if (!regime.newPositionsAllowed) {
        warnings.push(`VIX regime (${regime.name}) - DEFENSIVE MODE: no new positions allowed`);
      }

      // Warn if cash reserve below regime requirement
      const cashPercent = portfolio.cash / portfolio.totalValue;
      if (cashPercent < regime.minCashReserve) {
        warnings.push(`Cash reserve ${(cashPercent * 100).toFixed(1)}% below ${regime.name} regime requirement of ${(regime.minCashReserve * 100).toFixed(0)}%`);
      }
    } catch (error) {
      console.warn('Could not fetch VIX regime for warnings:', error.message);
    }

    // Warn if approaching limits
    const tradeValue = trade.quantity * trade.price;
    const positionSize = tradeValue / portfolio.totalValue;

    if (positionSize > this.MAX_POSITION_SIZE * 0.8) {
      warnings.push(`Position size ${(positionSize * 100).toFixed(1)}% is close to max limit`);
    }

    // Warn if too many positions
    if (portfolio.positions.length >= 14) {
      warnings.push('Portfolio already has 14 positions (max recommended)');
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
   * Calculate position size based on risk level (for longs)
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
   * Calculate position size for shorts (tighter due to unlimited loss risk)
   */
  calculateShortPositionSize(stockType, portfolioValue) {
    const sizeMap = {
      'index-etf': 0.12,      // 12% max (SPY, QQQ shorts)
      'mega-cap': 0.10,       // 10% max (AAPL, MSFT shorts)
      'large-cap': 0.08,      // 8% max
      'mid-cap': 0.06,        // 6% max (higher squeeze risk)
      'opportunistic': 0.03   // 3% max (avoid - too risky)
    };

    const maxSize = sizeMap[stockType] || 0.08;
    return Math.min(maxSize, this.MAX_SHORT_POSITION_SIZE);
  }

  /**
   * Calculate stop-loss level based on stock type (for longs)
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
   * Calculate stop-loss level for shorts (tighter stops, triggers on price RISE)
   */
  calculateShortStopLoss(stockType, entryPrice) {
    const stopLossMap = {
      'index-etf': 0.08,      // +8% (SPY shorts)
      'mega-cap': 0.10,       // +10% (AAPL, MSFT shorts)
      'large-cap': 0.12,      // +12%
      'mid-cap': 0.15,        // +15%
      'opportunistic': 0.18   // +18% (if allowed at all)
    };

    const stopLossPercent = stopLossMap[stockType] || 0.12;
    return entryPrice * (1 + stopLossPercent); // INVERTED: stop ABOVE entry
  }

  /**
   * Check if stop-loss should trigger
   * Checks custom lot-level stops first, then falls back to default calculation
   * Handles both long and short positions
   */
  async shouldTriggerStopLoss(position, currentPrice) {
    const isShort = position.position_type === 'short';

    // First check if any lots have custom stop-loss levels
    try {
      const lots = await db.query(
        `SELECT stop_loss, position_type FROM position_lots WHERE symbol = $1 AND quantity > 0`,
        [position.symbol]
      );

      if (lots.rows && lots.rows.length > 0) {
        // Check if any lot's custom stop-loss is triggered
        for (const lot of lots.rows) {
          if (lot.stop_loss) {
            const lotIsShort = lot.position_type === 'short';
            const triggered = lotIsShort
              ? currentPrice >= lot.stop_loss  // Short: stop triggers when price rises
              : currentPrice <= lot.stop_loss; // Long: stop triggers when price falls

            if (triggered) {
              console.log(`Stop-loss check for ${position.symbol} (${lotIsShort ? 'SHORT' : 'LONG'}):`);
              console.log(`  Current: $${currentPrice}, Custom stop: $${lot.stop_loss}`);
              console.log(`  Trigger: true (custom stop-loss)`);
              return true;
            }
          }
        }
      }
    } catch (error) {
      console.error('Error checking custom stop-loss:', error);
      // Fall through to default calculation
    }

    // Fall back to default percentage-based stop-loss
    const stockType = position.stock_type || position.stockType || 'large-cap';
    const stopLossPercent = this.getStopLossPercent(stockType);

    let triggered;
    if (isShort) {
      // Short position: stop triggers when price rises above entry
      const stopLossLevel = position.cost_basis * (1 + stopLossPercent);
      triggered = currentPrice >= stopLossLevel;
      console.log(`Stop-loss check for ${position.symbol} (SHORT):`);
      console.log(`  Current: $${currentPrice}, Entry: $${position.cost_basis}`);
      console.log(`  Stop-loss level: $${stopLossLevel.toFixed(2)} (+${(stopLossPercent * 100).toFixed(1)}%)`);
      console.log(`  Trigger: ${triggered}`);
    } else {
      // Long position: stop triggers when price falls below entry
      const stopLossLevel = this.calculateStopLoss(stockType, position.cost_basis);
      triggered = currentPrice <= stopLossLevel;
      console.log(`Stop-loss check for ${position.symbol} (LONG):`);
      console.log(`  Current: $${currentPrice}, Cost basis: $${position.cost_basis}`);
      console.log(`  Stop-loss level: $${stopLossLevel.toFixed(2)}`);
      console.log(`  Trigger: ${triggered}`);
    }

    return triggered;
  }

  /**
   * Get stop-loss percentage for stock type
   */
  getStopLossPercent(stockType) {
    const stopLossMap = {
      'index-etf': 0.12,      // -12%
      'blue-chip': 0.12,      // -12%
      'large-cap': 0.15,      // -15%
      'mid-cap': 0.18,        // -18%
      'opportunistic': 0.20   // -20%
    };
    return stopLossMap[stockType] || 0.15;
  }

  /**
   * Check if take-profit should trigger
   * NOTE: Automatic trim triggers removed - Opus manages all exits via analyzeAndModifyOrders()
   * This allows home run positions to compound without being trimmed to death
   */
  shouldTriggerTakeProfit(position, currentPrice) {
    // No automatic trimming - Opus decides when to exit based on:
    // - Thesis changes (earnings miss, guidance down)
    // - News events (partnership, product launch, etc.)
    // - Technical signals (parabolic moves, support breaks)
    // - Dynamic trailing stops adjusted based on volatility
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
   * Assess current cash state and generate context for Claude
   * Cash is a tool, not a constraint — this informs Claude's judgment, doesn't override it
   */
  checkCashState(portfolio) {
    const cashPct = portfolio.cash / portfolio.totalValue;
    const cashAmount = portfolio.cash;

    let state, context;

    if (cashPct > 0.12) {
      state = 'FLUSH';
      context = `Cash: ${(cashPct * 100).toFixed(1)}% ($${cashAmount.toFixed(0)}) — FLUSH. ` +
        `Full flexibility. Deploy normally on high and medium conviction setups.`;

    } else if (cashPct >= 0.05) {
      state = 'NORMAL';
      context = `Cash: ${(cashPct * 100).toFixed(1)}% ($${cashAmount.toFixed(0)}) — NORMAL. ` +
        `10% is the resting target. Prefer not to go below 5% without strong conviction. ` +
        `Prioritize the best setups only if cash would drop under 5%.`;

    } else if (cashPct > 0) {
      state = 'DEPLOYED';
      context = `Cash: ${(cashPct * 100).toFixed(1)}% ($${cashAmount.toFixed(0)}) — NEARLY FULLY DEPLOYED. ` +
        `Before buying anything new, evaluate existing positions: is there one with a weakened thesis, ` +
        `underperforming its sector, or a better opportunity available? If yes — rotate capital. ` +
        `If no clear rotation target exists, wait for a stop-loss or take-profit to free up capital naturally. ` +
        `Only bypass this for extremely high conviction setups (strong catalyst + technical confirmation).`;

    } else {
      state = 'ZERO';
      context = `Cash: 0% — FULLY DEPLOYED. ` +
        `Do not buy anything new unless you are simultaneously rotating out of a weaker position. ` +
        `Review all current positions for rotation candidates: weak thesis, underperforming vs sector, ` +
        `or a clearly better opportunity available. If no rotation makes sense, hold and wait.`;
    }

    // Identify rotation candidates when deployed/zero
    let rotationCandidates = [];
    if (cashPct < 0.05) {
      rotationCandidates = portfolio.positions
        .filter(p => p.quantity > 0) // Longs only
        .map(p => {
          const gainPct = ((p.currentPrice - p.cost_basis) / p.cost_basis) * 100;
          const positionValue = p.quantity * p.currentPrice;
          return { symbol: p.symbol, gainPct: gainPct.toFixed(1), positionValue: positionValue.toFixed(0), stock_type: p.stock_type };
        })
        // Surface underperformers first (small gain or negative)
        .sort((a, b) => parseFloat(a.gainPct) - parseFloat(b.gainPct))
        .slice(0, 5);
    }

    return { state, cashPct, cashAmount, context, rotationCandidates };
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

  /**
   * Detect market regime based on SPY technicals
   * Returns: 'bull', 'bear', or 'transitional'
   */
  async getMarketRegime() {
    try {
      const analysisEngine = await import('./analysis.js');
      const spyTechnicals = await analysisEngine.default.getTechnicalIndicators('SPY');

      if (!spyTechnicals || !spyTechnicals.sma200) {
        return 'unknown';
      }

      const { currentPrice, sma200, sma200Slope } = spyTechnicals;

      if (currentPrice > sma200 && sma200Slope > 0) {
        return 'bull'; // Price above rising 200MA
      } else if (currentPrice < sma200 && sma200Slope < 0) {
        return 'bear'; // Price below declining 200MA
      } else {
        return 'transitional'; // Mixed signals
      }
    } catch (error) {
      console.error('Error detecting market regime:', error);
      return 'unknown';
    }
  }

  /**
   * Get target allocation based on market regime
   * Returns recommended long/short/cash percentages
   */
  getTargetAllocation(regime) {
    const allocations = {
      'bull': { long: 0.65, short: 0.20, cash: 0.15 },
      'transitional': { long: 0.45, short: 0.25, cash: 0.30 },
      'bear': { long: 0.30, short: 0.40, cash: 0.30 },
      'unknown': { long: 0.60, short: 0.15, cash: 0.25 }
    };
    return allocations[regime] || allocations['bull'];
  }
}

export default new RiskManager();
