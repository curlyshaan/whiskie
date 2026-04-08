import * as db from './db.js';

/**
 * Trade Safeguard - Code-enforced trading limits
 * CRITICAL: These limits cannot be overridden by AI reasoning
 */

class TradeSafeguard {
  constructor() {
    this.MAX_TRADES_PER_DAY = 5;              // Up from 3 during build-out phase
    this.MAX_SINGLE_TRADE_VALUE = 15000;      // $15k per trade (15% of $100k)
    this.MAX_DAILY_EXPOSURE_CHANGE = 50000;   // Up from 30k — allows 3-4 positions/day
  }

  /**
   * Check if a trade is allowed based on hard limits
   */
  async canTrade(symbol, side, quantity, price) {
    const errors = [];

    // Check daily trade count
    const todayTrades = await this.getTodayTradeCount();
    if (todayTrades >= this.MAX_TRADES_PER_DAY) {
      errors.push(`Daily trade limit reached (${todayTrades}/${this.MAX_TRADES_PER_DAY})`);
    }

    // Check single trade value
    const tradeValue = Math.abs(quantity * price);
    if (tradeValue > this.MAX_SINGLE_TRADE_VALUE) {
      errors.push(`Trade value $${tradeValue.toFixed(2)} exceeds limit of $${this.MAX_SINGLE_TRADE_VALUE}`);
    }

    // Check daily exposure change
    const todayExposure = await this.getTodayExposureChange();
    if (todayExposure + tradeValue > this.MAX_DAILY_EXPOSURE_CHANGE) {
      errors.push(`Daily exposure change would exceed limit ($${(todayExposure + tradeValue).toFixed(2)} > $${this.MAX_DAILY_EXPOSURE_CHANGE})`);
    }

    // For sells: validate we have the position
    if (side === 'sell') {
      const validationError = await this.validateSellOrder(symbol, quantity);
      if (validationError) {
        errors.push(validationError);
      }
    }

    return {
      allowed: errors.length === 0,
      errors
    };
  }

  /**
   * Validate sell order against current positions
   * CRITICAL: Prevents accidental short positions
   */
  async validateSellOrder(symbol, sellQuantity) {
    try {
      const positions = await db.getPositions();
      const position = positions.find(p => p.symbol === symbol);

      if (!position) {
        return `Cannot sell ${symbol}: no position held`;
      }

      if (position.quantity <= 0) {
        return `Cannot sell ${symbol}: position has non-positive quantity (${position.quantity})`;
      }

      if (sellQuantity > position.quantity) {
        return `Cannot sell ${sellQuantity} shares of ${symbol}: only hold ${position.quantity}`;
      }

      return null; // Valid
    } catch (error) {
      return `Error validating sell order: ${error.message}`;
    }
  }

  /**
   * Get number of trades executed today
   */
  async getTodayTradeCount() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const result = await db.query(
        `SELECT COUNT(*) as count FROM trades
         WHERE DATE(executed_at) = $1`,
        [today]
      );
      return parseInt(result.rows[0]?.count || 0);
    } catch (error) {
      console.error('Error getting today trade count:', error);
      return 0;
    }
  }

  /**
   * Get total exposure change today (sum of trade values)
   */
  async getTodayExposureChange() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const result = await db.query(
        `SELECT COALESCE(SUM(ABS(total_value)), 0) as total
         FROM trades
         WHERE DATE(executed_at) = $1`,
        [today]
      );
      return parseFloat(result.rows[0]?.total || 0);
    } catch (error) {
      console.error('Error getting today exposure change:', error);
      return 0;
    }
  }
}

export default new TradeSafeguard();
