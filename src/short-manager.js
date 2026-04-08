import tradier from './tradier.js';
import * as db from './db.js';

/**
 * Short Position Manager
 * Handles short selling with safety checks and ETB verification
 *
 * RULES:
 * - Mid/large-cap only (market cap > $2B)
 * - 10% max per short position
 * - 30% max total short exposure
 * - ETB (Easy-to-Borrow) verification required
 * - Stop-loss REQUIRED and modifiable
 * - Inverse stop-loss logic (stop triggers on price RISE)
 */
class ShortManager {
  constructor() {
    this.MAX_SHORT_POSITION_PCT = 0.10;  // 10% per position
    this.MAX_TOTAL_SHORT_PCT = 0.30;     // 30% total shorts
    this.MIN_MARKET_CAP = 2_000_000_000; // $2B minimum
  }

  /**
   * Check if stock is eligible for shorting
   */
  async isShortable(symbol, marketCap) {
    const errors = [];

    // Check market cap
    if (marketCap < this.MIN_MARKET_CAP) {
      errors.push(`Market cap $${(marketCap / 1e9).toFixed(1)}B below minimum $2B`);
    }

    // Check ETB status from Tradier
    try {
      const etbList = await tradier.getETBList();
      const isETB = etbList.some(stock => stock.symbol === symbol);

      if (!isETB) {
        errors.push(`${symbol} not on Easy-to-Borrow list - cannot short`);
      }

      // Update database with ETB status
      await db.updateETBStatus(symbol, isETB);
    } catch (error) {
      errors.push(`Failed to verify ETB status: ${error.message}`);
    }

    return {
      shortable: errors.length === 0,
      errors
    };
  }

  /**
   * Check if short position is within limits
   */
  async canShort(symbol, quantity, price, portfolioValue) {
    const errors = [];

    // Calculate position value
    const positionValue = quantity * price;
    const positionPct = positionValue / portfolioValue;

    // Check single position limit
    if (positionPct > this.MAX_SHORT_POSITION_PCT) {
      errors.push(`Position size ${(positionPct * 100).toFixed(1)}% exceeds 10% limit`);
    }

    // Check total short exposure
    const positions = await db.getPositions();
    const currentShortExposure = positions
      .filter(p => p.quantity < 0)
      .reduce((sum, p) => sum + Math.abs(p.quantity * p.current_price), 0);

    const newTotalShortExposure = currentShortExposure + positionValue;
    const newShortPct = newTotalShortExposure / portfolioValue;

    if (newShortPct > this.MAX_TOTAL_SHORT_PCT) {
      errors.push(`Total short exposure would be ${(newShortPct * 100).toFixed(1)}%, exceeds 30% limit`);
    }

    return {
      allowed: errors.length === 0,
      errors,
      currentShortExposure,
      newShortExposure: newTotalShortExposure
    };
  }

  /**
   * Place short position with required stop-loss
   * Stop-loss for shorts triggers on PRICE RISE (inverse logic)
   */
  async placeShortWithProtection(symbol, quantity, entryPrice, stopLoss, takeProfit) {
    if (!stopLoss) {
      throw new Error('Stop-loss is REQUIRED for short positions');
    }

    // Validate inverse stop-loss logic
    if (stopLoss <= entryPrice) {
      throw new Error(`Short stop-loss $${stopLoss} must be ABOVE entry $${entryPrice} (triggers on price rise)`);
    }

    // Validate take-profit
    if (takeProfit && takeProfit >= entryPrice) {
      throw new Error(`Short take-profit $${takeProfit} must be BELOW entry $${entryPrice}`);
    }

    try {
      // Place short sell order with OCO bracket
      const result = await tradier.placeOTOCOOrder(
        symbol,
        'sell_short',  // Short sell
        quantity,
        entryPrice,
        stopLoss,      // Stop triggers on price RISE
        takeProfit     // Profit target on price FALL
      );

      // Log to database with negative quantity to indicate short
      await db.logTrade({
        symbol,
        action: 'sell_short',
        quantity: -quantity,  // Negative = short position
        price: entryPrice,
        orderId: result.order.id,
        status: result.order.status,
        reasoning: 'Short position with protective stop-loss'
      });

      return result;
    } catch (error) {
      console.error(`Error placing short position for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Modify stop-loss for short position
   * Remember: short stops trigger on price RISE
   */
  async modifyShortStopLoss(symbol, newStopLoss, currentPrice, reasoning) {
    // Validate inverse logic
    if (newStopLoss <= currentPrice) {
      throw new Error(`Short stop-loss $${newStopLoss} must be ABOVE current price $${currentPrice}`);
    }

    const positions = await db.getPositions();
    const position = positions.find(p => p.symbol === symbol && p.quantity < 0);

    if (!position) {
      throw new Error(`No short position found for ${symbol}`);
    }

    try {
      // Get current OCO order
      if (!position.oco_order_id) {
        throw new Error(`No OCO order found for ${symbol} short position`);
      }

      // Cancel old OCO and place new one
      await tradier.cancelOrder(position.oco_order_id);

      const newOCO = await tradier.placeOCOOrder(
        symbol,
        'buy_to_cover',  // Close short = buy to cover
        Math.abs(position.quantity),
        newStopLoss,     // Stop on price rise
        position.take_profit
      );

      // Update database
      await db.upsertPosition({
        ...position,
        stop_loss: newStopLoss,
        oco_order_id: newOCO.order.id
      });

      // Log modification
      const modification = {
        timestamp: new Date().toISOString(),
        old_stop_loss: position.stop_loss,
        new_stop_loss: newStopLoss,
        reasoning
      };

      const history = position.order_modification_history || [];
      history.push(modification);

      await db.query(
        `UPDATE positions SET order_modification_history = $1 WHERE symbol = $2`,
        [JSON.stringify(history), symbol]
      );

      console.log(`✅ Modified short stop-loss for ${symbol}: $${position.stop_loss} → $${newStopLoss}`);
      return newOCO;
    } catch (error) {
      console.error(`Error modifying short stop-loss for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Emergency cover short (buy to cover at market)
   */
  async emergencyCoverShort(symbol, reasoning) {
    const positions = await db.getPositions();
    const position = positions.find(p => p.symbol === symbol && p.quantity < 0);

    if (!position) {
      throw new Error(`No short position found for ${symbol}`);
    }

    try {
      // Cancel all pending orders
      if (position.oco_order_id) {
        await tradier.cancelOrder(position.oco_order_id);
      }

      // Buy to cover at market
      const result = await tradier.placeMarketOrder(
        symbol,
        'buy_to_cover',
        Math.abs(position.quantity)
      );

      await db.logTrade({
        symbol,
        action: 'buy_to_cover',
        quantity: Math.abs(position.quantity),
        price: result.order.avg_fill_price || position.current_price,
        orderId: result.order.id,
        status: result.order.status,
        reasoning: `EMERGENCY COVER: ${reasoning}`
      });

      console.log(`🚨 Emergency covered short ${symbol} at market`);
      return result;
    } catch (error) {
      console.error(`Error covering short for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get current short exposure summary
   */
  async getShortExposure(portfolioValue) {
    const positions = await db.getPositions();
    const shorts = positions.filter(p => p.quantity < 0);

    const totalShortValue = shorts.reduce((sum, p) => {
      return sum + Math.abs(p.quantity * p.current_price);
    }, 0);

    const shortPct = (totalShortValue / portfolioValue) * 100;

    return {
      shortPositions: shorts.length,
      totalShortValue,
      shortPct: shortPct.toFixed(1) + '%',
      remainingCapacity: Math.max(0, (this.MAX_TOTAL_SHORT_PCT * portfolioValue) - totalShortValue),
      shorts: shorts.map(p => ({
        symbol: p.symbol,
        quantity: Math.abs(p.quantity),
        entryPrice: p.cost_basis,
        currentPrice: p.current_price,
        unrealizedPL: (p.cost_basis - p.current_price) * Math.abs(p.quantity),
        stopLoss: p.stop_loss,
        takeProfit: p.take_profit
      }))
    };
  }
}

export default new ShortManager();
