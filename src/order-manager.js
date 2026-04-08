import tradier from './tradier.js';
import claude from './claude.js';
import tavily from './tavily.js';
import * as db from './db.js';

/**
 * Dynamic Order Management System
 * Allows AI to modify stop-loss, take-profit, and other orders based on news/analysis
 */
class OrderManager {
  constructor() {
    this.activeOrders = new Map(); // symbol -> order details
  }

  /**
   * Place initial position with OCO (stop-loss + take-profit)
   * Can use market entry or limit entry (OTOCO)
   */
  async placePositionWithProtection(symbol, quantity, entryPrice, stopLoss, takeProfit, useLimit = false) {
    try {
      console.log(`📋 Placing position for ${symbol} with protection orders...`);

      if (useLimit) {
        // Use OTOCO: limit entry with automatic OCO bracket
        console.log(`   Using OTOCO: Limit entry at ${entryPrice}`);
        const otocoOrder = await tradier.placeOTOCOOrder(
          symbol,
          'buy',
          quantity,
          entryPrice,
          stopLoss,
          takeProfit
        );
        console.log(`✅ OTOCO order placed: Entry ${entryPrice}, Stop ${stopLoss}, Limit ${takeProfit}`);

        // Store order details
        this.activeOrders.set(symbol, {
          symbol,
          quantity,
          entryPrice,
          stopLoss,
          takeProfit,
          otocoOrderId: otocoOrder.id,
          orderType: 'otoco',
          lastModified: new Date(),
          modificationHistory: []
        });

        // Save to database
        await this.saveOrderToDatabase(symbol);

        return {
          otocoOrder,
          success: true,
          orderType: 'otoco'
        };
      } else {
        // Use market entry + OCO
        console.log(`   Using market entry with OCO bracket`);
        const buyOrder = await tradier.placeOrder(symbol, 'buy', quantity, 'market');
        console.log(`✅ Buy order placed: ${buyOrder.id}`);

        // Poll until filled (max 30 seconds)
        const filledOrder = await this.waitForFill(buyOrder.id, 30000);
        if (!filledOrder) {
          throw new Error(`Buy order ${buyOrder.id} for ${symbol} did not fill within 30 seconds`);
        }
        const actualFillPrice = parseFloat(filledOrder.avg_fill_price);
        console.log(`✅ Buy order filled at $${actualFillPrice} (estimated: $${entryPrice})`);

        // Recalculate stop/target based on actual fill price
        const stopLossAdjusted = actualFillPrice * (stopLoss / entryPrice);
        const takeProfitAdjusted = actualFillPrice * (takeProfit / entryPrice);

        if (Math.abs(actualFillPrice - entryPrice) > entryPrice * 0.01) {
          console.log(`📊 Adjusting bracket: Stop $${stopLossAdjusted.toFixed(2)}, Target $${takeProfitAdjusted.toFixed(2)}`);
        }

        // Place OCO order (stop-loss + take-profit)
        const ocoOrder = await tradier.placeOCOOrder(symbol, quantity, stopLossAdjusted, takeProfitAdjusted);
        console.log(`✅ OCO order placed: Stop ${stopLossAdjusted.toFixed(2)}, Limit ${takeProfitAdjusted.toFixed(2)}`);

        // Store order details
        this.activeOrders.set(symbol, {
          symbol,
          quantity,
          entryPrice,
          stopLoss,
          takeProfit,
          ocoOrderId: ocoOrder.id,
          buyOrderId: buyOrder.id,
          orderType: 'market-oco',
          lastModified: new Date(),
          modificationHistory: []
        });

        // Save to database
        await this.saveOrderToDatabase(symbol);

        return {
          buyOrder,
          ocoOrder,
          success: true,
          orderType: 'market-oco'
        };
      }
    } catch (error) {
      console.error(`Error placing position with protection for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Modify stop-loss based on AI analysis
   * Uses atomic database-backed state to prevent unprotected positions on crash
   */
  async modifyStopLoss(symbol, newStopLoss, reason) {
    try {
      const orderInfo = this.activeOrders.get(symbol);
      if (!orderInfo) {
        console.log(`⚠️ No active orders found for ${symbol}`);
        return { success: false, reason: 'No active orders' };
      }

      console.log(`🔄 Modifying stop-loss for ${symbol}: ${orderInfo.stopLoss} → ${newStopLoss}`);
      console.log(`   Reason: ${reason}`);

      // Mark as pending_replace in database BEFORE canceling
      await db.query(
        `UPDATE positions SET oco_order_id = $1 WHERE symbol = $2`,
        [`PENDING_REPLACE_${orderInfo.ocoOrderId}`, symbol]
      );

      // Cancel existing OCO order
      await tradier.cancelOrder(orderInfo.ocoOrderId);
      console.log(`✅ Cancelled old OCO order`);

      // Place new OCO with updated stop-loss
      const newOcoOrder = await tradier.placeOCOOrder(
        symbol,
        orderInfo.quantity,
        newStopLoss,
        orderInfo.takeProfit
      );
      console.log(`✅ New OCO order placed with stop-loss: ${newStopLoss}`);

      // Update tracking
      orderInfo.modificationHistory.push({
        type: 'stop-loss-modification',
        oldValue: orderInfo.stopLoss,
        newValue: newStopLoss,
        reason,
        timestamp: new Date()
      });
      orderInfo.stopLoss = newStopLoss;
      orderInfo.ocoOrderId = newOcoOrder.id;
      orderInfo.lastModified = new Date();

      // Save to database with new OCO order ID
      await this.saveOrderToDatabase(symbol);

      return {
        success: true,
        oldStopLoss: orderInfo.modificationHistory[orderInfo.modificationHistory.length - 1].oldValue,
        newStopLoss,
        reason
      };
    } catch (error) {
      console.error(`Error modifying stop-loss for ${symbol}:`, error);
      // If we failed after cancel but before new order, log critical alert
      if (error.message.includes('place') || error.message.includes('OCO')) {
        console.error(`🚨 CRITICAL: ${symbol} may be unprotected after failed stop-loss modification`);
      }
      throw error;
    }
  }

  /**
   * Modify take-profit based on AI analysis
   * Uses atomic database-backed state to prevent unprotected positions on crash
   */
  async modifyTakeProfit(symbol, newTakeProfit, reason) {
    try {
      const orderInfo = this.activeOrders.get(symbol);
      if (!orderInfo) {
        console.log(`⚠️ No active orders found for ${symbol}`);
        return { success: false, reason: 'No active orders' };
      }

      console.log(`🔄 Modifying take-profit for ${symbol}: ${orderInfo.takeProfit} → ${newTakeProfit}`);
      console.log(`   Reason: ${reason}`);

      // Mark as pending_replace in database BEFORE canceling
      await db.query(
        `UPDATE positions SET oco_order_id = $1 WHERE symbol = $2`,
        [`PENDING_REPLACE_${orderInfo.ocoOrderId}`, symbol]
      );

      // Cancel existing OCO order
      await tradier.cancelOrder(orderInfo.ocoOrderId);
      console.log(`✅ Cancelled old OCO order`);

      // Place new OCO with updated take-profit
      const newOcoOrder = await tradier.placeOCOOrder(
        symbol,
        orderInfo.quantity,
        orderInfo.stopLoss,
        newTakeProfit
      );
      console.log(`✅ New OCO order placed with take-profit: ${newTakeProfit}`);

      // Update tracking
      orderInfo.modificationHistory.push({
        type: 'take-profit-modification',
        oldValue: orderInfo.takeProfit,
        newValue: newTakeProfit,
        reason,
        timestamp: new Date()
      });
      orderInfo.takeProfit = newTakeProfit;
      orderInfo.ocoOrderId = newOcoOrder.id;
      orderInfo.lastModified = new Date();

      // Save to database
      await this.saveOrderToDatabase(symbol);

      return {
        success: true,
        oldTakeProfit: orderInfo.modificationHistory[orderInfo.modificationHistory.length - 1].oldValue,
        newTakeProfit,
        reason
      };
    } catch (error) {
      console.error(`Error modifying take-profit for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Emergency market sell - cancel all orders and sell immediately
   */
  async emergencyMarketSell(symbol, reason) {
    try {
      const orderInfo = this.activeOrders.get(symbol);
      if (!orderInfo) {
        console.log(`⚠️ No active orders found for ${symbol}`);
        return { success: false, reason: 'No active orders' };
      }

      console.log(`🚨 EMERGENCY MARKET SELL: ${symbol}`);
      console.log(`   Reason: ${reason}`);

      // Cancel OCO order
      await tradier.cancelOrder(orderInfo.ocoOrderId);
      console.log(`✅ Cancelled OCO order`);

      // Place market sell order
      const sellOrder = await tradier.placeOrder(symbol, 'sell', orderInfo.quantity, 'market');
      console.log(`✅ Market sell order placed: ${sellOrder.id}`);

      // Update tracking
      orderInfo.modificationHistory.push({
        type: 'emergency-sell',
        reason,
        timestamp: new Date()
      });

      // Remove from active orders
      this.activeOrders.delete(symbol);

      // Log to database
      await db.logAIDecision({
        type: 'emergency-sell',
        symbol,
        recommendation: `Emergency market sell executed`,
        reasoning: reason,
        model: 'order-manager',
        confidence: 'high',
        executed: true
      });

      return {
        success: true,
        sellOrder,
        reason
      };
    } catch (error) {
      console.error(`Error executing emergency sell for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Analyze position and decide if orders need modification
   */
  async analyzeAndModifyOrders(symbol, position, currentPrice) {
    try {
      console.log(`\n🔍 Analyzing orders for ${symbol}...`);

      // Get recent news
      const news = await tavily.searchStockNews(symbol, 5);
      const formattedNews = tavily.formatResults(news);

      // Get order info
      const orderInfo = this.activeOrders.get(symbol);
      if (!orderInfo) {
        console.log(`   No active orders to modify`);
        return null;
      }

      // Ask Claude to analyze
      const prompt = `You are managing a position in ${symbol}. Analyze if stop-loss or take-profit orders should be modified.

**Current Position:**
- Entry Price: $${orderInfo.entryPrice}
- Current Price: $${currentPrice}
- Quantity: ${orderInfo.quantity}
- Current Stop-Loss: $${orderInfo.stopLoss}
- Current Take-Profit: $${orderInfo.takeProfit}
- Gain/Loss: ${((currentPrice - orderInfo.entryPrice) / orderInfo.entryPrice * 100).toFixed(2)}%

**Recent News:**
${formattedNews}

**Your Task:**
Decide if any orders should be modified based on:
1. News impact (earnings, guidance, major announcements)
2. Price action (strong momentum, breakdown, consolidation)
3. Risk management (tighten stops after gains, widen after news)

**Response Format:**
If modification needed:
ACTION: [MODIFY_STOP_LOSS | MODIFY_TAKE_PROFIT | EMERGENCY_SELL | NO_ACTION]
NEW_VALUE: [new price level]
REASON: [detailed reasoning]

If no action needed:
ACTION: NO_ACTION
REASON: [why current orders are appropriate]`;

      const messages = [{ role: 'user', content: prompt }];
      const response = await claude.sendMessage(messages, claude.MODELS.OPUS, null, true);

      const analysis = response.content.find(b => b.type === 'text')?.text || '';

      // Parse response
      const actionMatch = analysis.match(/ACTION:\s*(\w+)/);
      const valueMatch = analysis.match(/NEW_VALUE:\s*\$?(\d+\.?\d*)/);
      const reasonMatch = analysis.match(/REASON:\s*(.+?)(?=\n\n|\n[A-Z]+:|$)/s);

      if (!actionMatch) {
        console.log(`   Could not parse action from analysis`);
        return null;
      }

      const action = actionMatch[1];
      const newValue = valueMatch ? parseFloat(valueMatch[1]) : null;
      const reason = reasonMatch ? reasonMatch[1].trim() : 'AI analysis';

      console.log(`   AI Decision: ${action}`);
      if (newValue) console.log(`   New Value: $${newValue}`);
      console.log(`   Reason: ${reason.substring(0, 100)}...`);

      // Execute action
      let result = null;
      switch (action) {
        case 'MODIFY_STOP_LOSS':
          if (newValue) {
            result = await this.modifyStopLoss(symbol, newValue, reason);
          }
          break;

        case 'MODIFY_TAKE_PROFIT':
          if (newValue) {
            result = await this.modifyTakeProfit(symbol, newValue, reason);
          }
          break;

        case 'EMERGENCY_SELL':
          result = await this.emergencyMarketSell(symbol, reason);
          break;

        case 'NO_ACTION':
          console.log(`   ✅ No modifications needed`);
          result = { success: true, action: 'NO_ACTION', reason };
          break;

        default:
          console.log(`   Unknown action: ${action}`);
      }

      // Log decision
      await db.logAIDecision({
        type: 'order-modification-analysis',
        symbol,
        recommendation: action,
        reasoning: reason,
        model: 'opus',
        confidence: 'high',
        executed: result?.success || false
      });

      return result;
    } catch (error) {
      console.error(`Error analyzing orders for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Save order info to database
   */
  async saveOrderToDatabase(symbol) {
    const orderInfo = this.activeOrders.get(symbol);
    if (!orderInfo) return;

    // Store in position record
    await db.query(
      `UPDATE positions
       SET stop_loss = $1, take_profit = $2, updated_at = CURRENT_TIMESTAMP
       WHERE symbol = $3`,
      [orderInfo.stopLoss, orderInfo.takeProfit, symbol]
    );
  }

  /**
   * Load active orders from database on startup
   */
  async loadActiveOrders() {
    try {
      const positions = await db.getPositions();
      const orders = await tradier.getOrders();

      for (const position of positions) {
        // Find OCO order for this position
        const ocoOrder = orders.find(o =>
          o.symbol === position.symbol &&
          o.class === 'oco' &&
          o.status === 'open'
        );

        if (ocoOrder) {
          this.activeOrders.set(position.symbol, {
            symbol: position.symbol,
            quantity: position.quantity,
            entryPrice: position.cost_basis,
            stopLoss: position.stop_loss,
            takeProfit: position.take_profit,
            ocoOrderId: ocoOrder.id,
            lastModified: new Date(),
            modificationHistory: []
          });
        }
      }

      console.log(`📋 Loaded ${this.activeOrders.size} active orders`);
    } catch (error) {
      console.error('Error loading active orders:', error);
    }
  }

  /**
   * Get order info for a symbol
   */
  getOrderInfo(symbol) {
    return this.activeOrders.get(symbol);
  }

  /**
   * Get all active orders
   */
  getAllOrders() {
    return Array.from(this.activeOrders.values());
  }

  /**
   * Wait for order to fill (poll status until filled or timeout)
   */
  async waitForFill(orderId, timeoutMs = 30000) {
    const pollInterval = 2000;
    const maxAttempts = Math.floor(timeoutMs / pollInterval);

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      const orders = await tradier.getOrders();
      const order = orders.find(o => o.id === orderId);

      if (order?.status === 'filled') return order;
      if (order?.status === 'canceled' || order?.status === 'rejected') {
        throw new Error(`Order ${orderId} was ${order.status}`);
      }
    }
    return null; // Timed out
  }
}

export default new OrderManager();
