import tradier from './tradier.js';
import yahooFinance from './yahoo-finance.js';
import * as db from './db.js';

/**
 * Short Position Manager
 * Handles short selling with safety checks and ETB verification
 *
 * RULES:
 * - Mid/large-cap only (market cap > $2B)
 * - 12% max per short position (8% if DTC ≥4)
 * - 25% max total short exposure
 * - ETB (Easy-to-Borrow) verification required
 * - Stop-loss REQUIRED and modifiable
 * - Inverse stop-loss logic (stop triggers on price RISE)
 *
 * MEME STOCK PROTECTION:
 * - IV filter: 80% max (meme stocks typically have 100%+ IV)
 * - ETB verification: Ensures stock is available to borrow
 * - Short interest data: Currently unavailable (Yahoo Finance 401 errors)
 *   but ETB + IV filters provide adequate protection
 */
class ShortManager {
  constructor() {
    this.MAX_SHORT_POSITION_PCT = 0.12;  // 12% per position (when DTC <4)
    this.REDUCED_SHORT_POSITION_PCT = 0.08; // 8% when DTC 4-5 (increased from 5%)
    this.MAX_TOTAL_SHORT_PCT = 0.25;     // 25% total shorts
    this.MIN_MARKET_CAP = 2_000_000_000; // $2B minimum
    this.MAX_IV_THRESHOLD = 0.80;        // 80% IV hard block (increased from 70%)
    this.MAX_DAYS_TO_COVER = 5;          // Block if >5
    this.ELEVATED_DAYS_TO_COVER = 4;     // Reduce to 8% if >=4
  }

  /**
   * Check if stock is eligible for shorting
   */
  async isShortable(symbol, marketCap) {
    const errors = [];
    const warnings = [];

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

    // Check short interest as % of float (squeeze risk)
    try {
      const shortStats = await yahooFinance.getShortInterest(symbol);

      if (shortStats && shortStats.shortPercentOfFloat) {
        const shortPct = shortStats.shortPercentOfFloat;

        if (shortPct > 0.30) {
          // >30% short float = very high squeeze risk, hard block
          errors.push(`${symbol} short float is ${(shortPct * 100).toFixed(0)}% — extreme squeeze risk, cannot short`);
        } else if (shortPct > 0.20) {
          // 20-30% = elevated risk, warn but allow
          warnings.push(`${symbol} short float is ${(shortPct * 100).toFixed(0)}% — elevated squeeze risk, use smaller position (3% max)`);
        } else if (shortPct > 0.15) {
          warnings.push(`${symbol} short float is ${(shortPct * 100).toFixed(0)}% — moderate squeeze risk, monitor closely`);
        }

        // Check Days to Cover (squeeze risk indicator)
        if (shortStats.shortRatio) {
          const daysToCover = shortStats.shortRatio;

          if (daysToCover > this.MAX_DAYS_TO_COVER) {
            errors.push(`${symbol} days to cover is ${daysToCover.toFixed(1)} (max ${this.MAX_DAYS_TO_COVER}) — extreme squeeze risk, cannot short`);
          } else if (daysToCover >= this.ELEVATED_DAYS_TO_COVER) {
            warnings.push(`${symbol} days to cover is ${daysToCover.toFixed(1)} — elevated squeeze risk, max position 5%`);
          }
        }

        // Log for decision tracking
        await db.query(
          `UPDATE stock_universe SET short_float_pct = $1, last_updated = NOW() WHERE symbol = $2`,
          [shortPct, symbol]
        ).catch(() => {}); // Non-blocking
      }
    } catch (error) {
      // Short interest check is non-blocking — log but don't prevent the trade
      console.warn(`⚠️ Could not fetch short interest for ${symbol}: ${error.message}`);
      warnings.push(`Short interest data unavailable for ${symbol} — verify manually before shorting`);
    }

    // Check Implied Volatility (IV) via options chain
    try {
      const iv = await this.getImpliedVolatility(symbol);

      if (iv !== null) {
        if (iv > this.MAX_IV_THRESHOLD) {
          errors.push(`${symbol} IV is ${(iv * 100).toFixed(0)}% (max ${(this.MAX_IV_THRESHOLD * 100).toFixed(0)}%) — meme stock territory, cannot short`);
        } else if (iv > 0.70) {
          warnings.push(`${symbol} IV is ${(iv * 100).toFixed(0)}% — elevated volatility, reduce position to 5%`);
        } else if (iv > 0.60) {
          warnings.push(`${symbol} IV is ${(iv * 100).toFixed(0)}% — moderate volatility, monitor closely`);
        }
      }
    } catch (error) {
      console.warn(`⚠️ Could not fetch IV for ${symbol}: ${error.message}`);
      warnings.push(`IV data unavailable for ${symbol} — verify manually before shorting`);
    }

    return {
      shortable: errors.length === 0,
      errors,
      warnings
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

    // Check single position limit (DTC-based)
    const maxPositionPct = await this.getMaxPositionSize(symbol);
    if (positionPct > maxPositionPct) {
      errors.push(`Position size ${(positionPct * 100).toFixed(1)}% exceeds ${(maxPositionPct * 100).toFixed(0)}% limit`);
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
      const result = await tradier.placeOrder(
        symbol,
        'buy_to_cover',
        Math.abs(position.quantity),
        'market'
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

  /**
   * Get Implied Volatility from options chain
   * Returns ATM (at-the-money) IV as a decimal (e.g., 0.45 = 45%)
   */
  async getImpliedVolatility(symbol) {
    try {
      const optionsData = await tradier.getOptionsChain(symbol);

      if (!optionsData || !optionsData.options || !optionsData.options.option) {
        return null;
      }

      const options = Array.isArray(optionsData.options.option)
        ? optionsData.options.option
        : [optionsData.options.option];

      // Get current stock price
      const quote = await tradier.getQuote(symbol);
      const currentPrice = quote?.last || quote?.close;

      if (!currentPrice) {
        return null;
      }

      // Find ATM (at-the-money) options - closest strike to current price
      const atmOptions = options
        .filter(opt => opt.greeks && opt.greeks.mid_iv)
        .map(opt => ({
          strike: opt.strike,
          iv: opt.greeks.mid_iv,
          distance: Math.abs(opt.strike - currentPrice)
        }))
        .sort((a, b) => a.distance - b.distance);

      if (atmOptions.length === 0) {
        return null;
      }

      // Return ATM IV (closest to current price)
      return atmOptions[0].iv;
    } catch (error) {
      console.error(`Error fetching IV for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get maximum position size based on Days to Cover
   * DTC <4: 12% max
   * DTC 4-5: 5% max
   * DTC >5: blocked (handled in isShortable)
   */
  async getMaxPositionSize(symbol) {
    try {
      const shortStats = await yahooFinance.getShortInterest(symbol);

      if (shortStats && shortStats.shortRatio) {
        const daysToCover = shortStats.shortRatio;

        if (daysToCover >= this.ELEVATED_DAYS_TO_COVER) {
          return this.REDUCED_SHORT_POSITION_PCT; // 5% for DTC 4-5
        }
      }

      return this.MAX_SHORT_POSITION_PCT; // 12% for DTC <4
    } catch (error) {
      console.warn(`Could not fetch DTC for ${symbol}, using standard limit`);
      return this.MAX_SHORT_POSITION_PCT;
    }
  }

  /**
   * Calculate ATR-based stop-loss for short position
   * Stop = Entry Price + (2 × ATR)
   * Uses 14-day ATR by default
   */
  async calculateATRStopLoss(symbol, entryPrice, period = 14) {
    try {
      // Fetch historical data for ATR calculation
      const history = await tradier.getHistoricalPrices(symbol, period + 1);

      if (!history || history.length < period + 1) {
        console.warn(`Insufficient data for ATR calculation on ${symbol}`);
        return null;
      }

      // Calculate True Range for each period
      const trueRanges = [];
      for (let i = 1; i < history.length; i++) {
        const high = history[i].high;
        const low = history[i].low;
        const prevClose = history[i - 1].close;

        const tr = Math.max(
          high - low,
          Math.abs(high - prevClose),
          Math.abs(low - prevClose)
        );
        trueRanges.push(tr);
      }

      // Calculate ATR (simple moving average of True Range)
      const atr = trueRanges.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;

      // Stop-loss = Entry + (2 × ATR) for shorts
      const stopLoss = entryPrice + (2 * atr);

      return {
        atr: atr,
        stopLoss: stopLoss,
        stopDistance: stopLoss - entryPrice,
        stopPercent: ((stopLoss - entryPrice) / entryPrice) * 100
      };
    } catch (error) {
      console.error(`Error calculating ATR for ${symbol}:`, error.message);
      return null;
    }
  }
}

export default new ShortManager();
