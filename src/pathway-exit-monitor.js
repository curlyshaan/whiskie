import * as db from './db.js';
import fmp from './fmp.js';
import pathwayStrategies from './pathway-exit-strategies.js';
import email from './email.js';
import tradier from './tradier.js';
import { resolveMarketPrice } from './utils.js';

/**
 * Pathway Exit Monitor
 *
 * Checks positions every 45 minutes during market hours for:
 * - Trim opportunities (e.g., value_dip at +20%)
 * - Trailing stop activation (e.g., deepValue at +50%)
 * - Fundamental exit conditions (ROE drops, dividend cuts)
 *
 * Auto-executes pathway exits and sends email notifications.
 */

class PathwayExitMonitor {
  constructor() {
    this.MARKET_OPEN = 9; // 9am ET
    this.MARKET_CLOSE = 16; // 4pm ET
  }

  /**
   * Main monitoring function - called every 45 minutes
   */
  async checkPathwayExits() {
    console.log('\n🔍 Checking pathway exit conditions...');

    // Check if market is open
    const now = new Date();
    const hour = now.getHours();

    if (hour < this.MARKET_OPEN || hour >= this.MARKET_CLOSE) {
      console.log('   Market closed - skipping pathway exit checks');
      return;
    }

    // Get all open positions
    const positions = await db.getPositions();

    if (positions.length === 0) {
      console.log('   No open positions to monitor');
      return;
    }

    console.log(`   Monitoring ${positions.length} positions for pathway exits`);

    const actions = [];

    for (const position of positions) {
      try {
        const action = await this.checkPositionExits(position);
        if (action) {
          actions.push(action);
        }

        const extraActions = await this.checkStructuredExitRules(position);
        if (extraActions.length > 0) {
          actions.push(...extraActions);
        }
      } catch (error) {
        console.error(`   ❌ Error checking ${position.symbol}:`, error.message);
      }
    }

    // Execute actions
    if (actions.length > 0) {
      console.log(`\n   📋 Found ${actions.length} pathway exit actions to execute`);
      await this.executeActions(actions);
    } else {
      console.log('   ✅ No pathway exit actions needed');
    }
  }

  /**
   * Check individual position for exit conditions
   */
  async checkPositionExits(position) {
    const { symbol, pathway, quantity, cost_basis, peak_price, trailing_stop_activated, pathway_selection_rule, secondary_pathways } = position;

    // Skip if no pathway assigned
    if (!pathway) {
      return null;
    }

    // Get current price
    const quote = await fmp.getQuote(symbol);
    if (!quote) {
      console.warn(`   ⚠️ No quote for ${symbol}`);
      return null;
    }

    const marketOpen = await tradier.isMarketOpen().catch(() => false);
    const currentPrice = resolveMarketPrice(quote, { marketOpen, fallback: 0 });
    const isShort = quantity < 0;

    // Calculate gain
    const gain = isShort
      ? (cost_basis - currentPrice) / cost_basis
      : (currentPrice - cost_basis) / cost_basis;

    // Update peak price if needed
    const newPeakPrice = isShort
      ? Math.min(peak_price || currentPrice, currentPrice)
      : Math.max(peak_price || currentPrice, currentPrice);

    if (newPeakPrice !== peak_price) {
      await db.query(
        'UPDATE positions SET peak_price = $1 WHERE symbol = $2',
        [newPeakPrice, symbol]
      );
    }

    // Get pathway strategy
    const strategy = pathwayStrategies.getExitStrategy(pathway);
    if (!strategy) {
      return null;
    }

    if (secondary_pathways?.length) {
      console.log(`   ℹ️ ${symbol} exit monitor using primary pathway ${pathway} (${pathway_selection_rule || 'primary_pathway'}) with secondary context: ${secondary_pathways.join(', ')}`);
    }

    // Check for trim opportunities
    const trimAction = pathwayStrategies.shouldTrimPosition(
      pathway,
      cost_basis,
      currentPrice,
      Math.abs(quantity),
      isShort
    );

    if (trimAction) {
      return {
        type: 'trim',
        symbol,
        pathway,
        quantity: trimAction.trimQuantity,
        currentPrice,
        reason: trimAction.reason,
        position
      };
    }

    // Check for trailing stop activation
    if (!trailing_stop_activated && strategy.trailingStop) {
      const trailingStopCheck = pathwayStrategies.shouldActivateTrailingStop(
        pathway,
        cost_basis,
        currentPrice,
        newPeakPrice,
        isShort
      );

      if (trailingStopCheck && trailingStopCheck.activated) {
        return {
          type: 'activate_trailing_stop',
          symbol,
          pathway,
          quantity: Math.abs(quantity),
          currentPrice,
          trailPrice: trailingStopCheck.trailPrice,
          trailDistance: trailingStopCheck.trailDistance,
          reason: trailingStopCheck.reason,
          position
        };
      }
    }

    // Check if trailing stop should trigger
    if (trailing_stop_activated && position.trailing_stop_distance) {
      const trailDistance = position.trailing_stop_distance;
      const stopPrice = isShort
        ? newPeakPrice * (1 + trailDistance) // For shorts, stop above the lowest favorable price
        : newPeakPrice * (1 - trailDistance); // For longs, stop below peak

      const stopTriggered = isShort
        ? currentPrice >= stopPrice
        : currentPrice <= stopPrice;

      if (stopTriggered) {
        return {
          type: 'trailing_stop_triggered',
          symbol,
          pathway,
          quantity: Math.abs(quantity),
          currentPrice,
          stopPrice,
          reason: `${pathway} trailing stop triggered: price ${isShort ? 'rose' : 'fell'} to $${currentPrice.toFixed(2)} (stop at $${stopPrice.toFixed(2)})`,
          position
        };
      }
    }

    return null;
  }

  async checkStructuredExitRules(position) {
    const actions = [];
    const quote = await fmp.getQuote(position.symbol);
    if (!quote) return actions;

    const marketOpen = await tradier.isMarketOpen().catch(() => false);
    const currentPrice = resolveMarketPrice(quote, { marketOpen, fallback: 0 });
    const isShort = position.quantity < 0;

    if (position.max_holding_days && position.entry_date) {
      const daysHeld = Math.floor((Date.now() - new Date(position.entry_date).getTime()) / (1000 * 60 * 60 * 24));
      if (daysHeld > position.max_holding_days) {
        actions.push({
          type: 'time_stop_exit',
          symbol: position.symbol,
          pathway: position.pathway,
          quantity: Math.abs(position.quantity),
          currentPrice,
          reason: `Max holding days exceeded (${daysHeld}/${position.max_holding_days})`,
          position
        });
      }
    }

    // Only check rebalance for non-short positions with rebalance posture or threshold
    if (!isShort && position.rebalance_threshold_pct && position.current_price && position.quantity) {
      const basisValue = position.cost_basis * Math.abs(position.quantity);
      const currentValue = currentPrice * Math.abs(position.quantity);
      const gainPct = basisValue > 0 ? ((currentValue - basisValue) / basisValue) * 100 : 0;
      
      // For flexible_fundamental targets, use rebalance logic instead of hard exits
      const shouldRebalance = position.target_type === 'flexible_fundamental' || 
                             position.holding_posture === 'rebalance';
      
      if (gainPct >= position.rebalance_threshold_pct && shouldRebalance) {
        actions.push({
          type: 'rebalance_trim',
          symbol: position.symbol,
          pathway: position.pathway,
          quantity: Math.max(1, Math.floor(Math.abs(position.quantity) * 0.2)),
          currentPrice,
          reason: `Rebalance threshold reached (${gainPct.toFixed(1)}% >= ${position.rebalance_threshold_pct}%)`,
          position
        });
      }
    }

    if (position.thesis_state === 'broken') {
      actions.push({
        type: 'fundamental_exit',
        symbol: position.symbol,
        pathway: position.pathway,
        quantity: Math.abs(position.quantity),
        currentPrice,
        reason: 'Persisted thesis state is broken',
        position
      });
    }

    if (position.stop_type === 'fundamental' && position.fundamental_stop_conditions) {
      const fundamentals = await fmp.getFundamentals(position.symbol);
      let conditions = position.fundamental_stop_conditions;
      if (typeof conditions === 'string') {
        try {
          conditions = JSON.parse(conditions);
        } catch {
          conditions = null;
        }
      }

      if (fundamentals && conditions && !conditions.summary) {
        if (conditions.operating_margin_min && fundamentals.operatingMargin < conditions.operating_margin_min) {
          actions.push({
            type: 'fundamental_exit',
            symbol: position.symbol,
            pathway: position.pathway,
            quantity: Math.abs(position.quantity),
            currentPrice,
            reason: `Operating margin ${fundamentals.operatingMargin} < ${conditions.operating_margin_min}`,
            position
          });
        }
        if (conditions.debt_to_equity_max && fundamentals.debtToEquity > conditions.debt_to_equity_max) {
          actions.push({
            type: 'fundamental_exit',
            symbol: position.symbol,
            pathway: position.pathway,
            quantity: Math.abs(position.quantity),
            currentPrice,
            reason: `Debt/Equity ${fundamentals.debtToEquity} > ${conditions.debt_to_equity_max}`,
            position
          });
        }
      }
    }

    // Only apply holding_posture rebalance if not already handled above
    if (!isShort && position.holding_posture === 'rebalance' && position.rebalance_threshold_pct) {
      const basisValue = position.cost_basis * Math.abs(position.quantity);
      const currentValue = currentPrice * Math.abs(position.quantity);
      const gainPct = basisValue > 0 ? ((currentValue - basisValue) / basisValue) * 100 : 0;
      
      // Avoid duplicate rebalance actions
      const alreadyHasRebalance = actions.some(a => a.type === 'rebalance_trim' && a.symbol === position.symbol);
      
      if (gainPct >= position.rebalance_threshold_pct && !alreadyHasRebalance) {
        actions.push({
          type: 'rebalance_trim',
          symbol: position.symbol,
          pathway: position.pathway,
          quantity: Math.max(1, Math.floor(Math.abs(position.quantity) * 0.15)),
          currentPrice,
          reason: `Holding posture is rebalance and gain reached ${gainPct.toFixed(1)}%`,
          position
        });
      }
    }

    return actions;
  }

  /**
   * Execute pathway exit actions
   */
  async executeActions(actions) {
    const results = [];

    for (const action of actions) {
      try {
        let result;

        switch (action.type) {
          case 'trim':
          case 'rebalance_trim':
            result = await this.executeTrim(action);
            break;
          case 'activate_trailing_stop':
            result = await this.activateTrailingStop(action);
            break;
          case 'trailing_stop_triggered':
          case 'fundamental_exit':
          case 'time_stop_exit':
            result = await this.executeTrailingStopExit(action);
            break;
          default:
            console.warn(`   ⚠️ Unknown action type: ${action.type}`);
        }

        if (result) {
          results.push(result);
        }
      } catch (error) {
        console.error(`   ❌ Error executing ${action.type} for ${action.symbol}:`, error.message);
        results.push({
          symbol: action.symbol,
          action: action.type,
          success: false,
          error: error.message
        });
      }
    }

    // Send email notification
    if (results.length > 0) {
      await this.sendExitNotification(results);
    }

    return results;
  }

  /**
   * Execute position trim
   */
  async executeTrim(action) {
    const { symbol, quantity, currentPrice, reason, position } = action;
    const isShort = position.quantity < 0;

    console.log(`   📉 Trimming ${symbol}: ${quantity} shares at $${currentPrice.toFixed(2)}`);
    console.log(`      Reason: ${reason}`);

    // Place market order to trim
    const orderType = isShort ? 'buy_to_cover' : 'sell';
    const order = await tradier.placeOrder(symbol, orderType, quantity, 'market');

    // Update position in database
    const newQuantity = position.quantity + (isShort ? quantity : -quantity);

    // Add to trim history
    const trimHistory = position.trim_history || [];
    trimHistory.push({
      date: new Date().toISOString(),
      quantity,
      price: currentPrice,
      reason
    });

    await db.query(
      `UPDATE positions
       SET quantity = $1,
           last_trim_date = NOW(),
           trim_history = $2
       WHERE symbol = $3`,
      [newQuantity, JSON.stringify(trimHistory), symbol]
    );

    // If position fully closed, remove from positions table
    if (Math.abs(newQuantity) < 1) {
      await db.query('DELETE FROM positions WHERE symbol = $1', [symbol]);
    } else {
      // Cancel old OCO and place new one for remaining shares
      if (position.oco_order_id) {
        await tradier.cancelOrder(position.oco_order_id);

        // Place new OCO for remaining shares
        const newOCO = await tradier.placeOTOCOOrder(
          symbol,
          isShort ? 'buy_to_cover' : 'sell',
          Math.abs(newQuantity),
          currentPrice,
          position.stop_loss,
          position.take_profit
        );

        await db.query(
          'UPDATE positions SET oco_order_id = $1 WHERE symbol = $2',
          [newOCO.order.id, symbol]
        );
      }
    }

    console.log(`   ✅ Trim executed: ${symbol} ${quantity} shares at $${currentPrice.toFixed(2)}`);

    return {
      symbol,
      action: 'trim',
      success: true,
      quantity,
      price: currentPrice,
      reason,
      orderId: order.order.id
    };
  }

  /**
   * Activate trailing stop
   */
  async activateTrailingStop(action) {
    const { symbol, quantity, trailPrice, trailDistance, reason, position } = action;
    const isShort = position.quantity < 0;

    console.log(`   🎯 Activating trailing stop for ${symbol}`);
    console.log(`      Trail price: $${trailPrice.toFixed(2)} (${(Math.abs(trailDistance) * 100).toFixed(0)}% trail)`);
    console.log(`      Reason: ${reason}`);

    // Cancel existing OCO order
    if (position.oco_order_id) {
      await tradier.cancelOrder(position.oco_order_id);
    }

    // Place trailing stop order
    const orderType = isShort ? 'buy' : 'sell';
    const trailAmount = Math.abs(trailDistance * position.peak_price);

    const trailingStopOrder = await tradier.placeTrailingStopOrder(
      symbol,
      orderType,
      quantity,
      trailAmount
    );

    // Update position in database
    await db.query(
      `UPDATE positions
       SET trailing_stop_activated = TRUE,
           trailing_stop_distance = $1,
           oco_order_id = $2
       WHERE symbol = $3`,
      [Math.abs(trailDistance), trailingStopOrder.order.id, symbol]
    );

    console.log(`   ✅ Trailing stop activated for ${symbol}`);

    return {
      symbol,
      action: 'activate_trailing_stop',
      success: true,
      trailPrice,
      trailDistance,
      reason,
      orderId: trailingStopOrder.order.id
    };
  }

  /**
   * Execute trailing stop exit
   */
  async executeTrailingStopExit(action) {
    const { symbol, quantity, currentPrice, stopPrice, reason, position } = action;
    const isShort = position.quantity < 0;

    console.log(`   🛑 Trailing stop triggered for ${symbol}`);
    console.log(`      Exit price: $${currentPrice.toFixed(2)} (stop at $${stopPrice.toFixed(2)})`);
    console.log(`      Reason: ${reason}`);

    // Place market order to exit
    const orderType = isShort ? 'buy_to_cover' : 'sell';
    const order = await tradier.placeOrder(symbol, orderType, quantity, 'market');

    // Remove position from database
    await db.query('DELETE FROM positions WHERE symbol = $1', [symbol]);

    // Log trade
    await db.logTrade({
      symbol,
      action: orderType,
      quantity: isShort ? quantity : -quantity,
      price: currentPrice,
      orderId: order.order.id,
      status: order.order.status,
      reasoning: reason
    });

    console.log(`   ✅ Trailing stop exit executed: ${symbol} at $${currentPrice.toFixed(2)}`);

    return {
      symbol,
      action: 'trailing_stop_exit',
      success: true,
      quantity,
      price: currentPrice,
      stopPrice,
      reason,
      orderId: order.order.id
    };
  }

  /**
   * Send email notification for pathway exits
   */
  async sendExitNotification(results) {
    const successfulActions = results.filter(r => r.success);

    if (successfulActions.length === 0) {
      return;
    }

    const subject = `Whiskie: ${successfulActions.length} Pathway Exit${successfulActions.length > 1 ? 's' : ''} Executed`;

    let body = `<h2>Pathway Exit Actions Executed</h2>\n\n`;
    body += `<p>${successfulActions.length} position${successfulActions.length > 1 ? 's' : ''} modified based on pathway exit strategies.</p>\n\n`;

    for (const result of successfulActions) {
      body += `<h3>${result.symbol} - ${result.action.replace(/_/g, ' ').toUpperCase()}</h3>\n`;
      body += `<ul>\n`;

      if (result.quantity) {
        body += `<li><strong>Quantity:</strong> ${result.quantity} shares</li>\n`;
      }
      if (result.price) {
        body += `<li><strong>Price:</strong> $${result.price.toFixed(2)}</li>\n`;
      }
      if (result.trailPrice) {
        body += `<li><strong>Trail Price:</strong> $${result.trailPrice.toFixed(2)}</li>\n`;
        body += `<li><strong>Trail Distance:</strong> ${(Math.abs(result.trailDistance) * 100).toFixed(0)}%</li>\n`;
      }
      if (result.stopPrice) {
        body += `<li><strong>Stop Price:</strong> $${result.stopPrice.toFixed(2)}</li>\n`;
      }
      body += `<li><strong>Reason:</strong> ${result.reason}</li>\n`;
      body += `<li><strong>Order ID:</strong> ${result.orderId}</li>\n`;
      body += `</ul>\n\n`;
    }

    body += `<p><a href="https://whiskie-production.up.railway.app">View Dashboard</a></p>`;

    await email.sendEmail(
      process.env.ALERT_EMAIL,
      subject,
      body
    );

    console.log(`   📧 Email notification sent for ${successfulActions.length} pathway exit${successfulActions.length > 1 ? 's' : ''}`);
  }
}

export default new PathwayExitMonitor();
