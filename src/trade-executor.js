import tradeApproval from './trade-approval.js';
import shortManager from './short-manager.js';
import * as db from './db.js';
import tradier from './tradier.js';
import riskManager from './risk-manager.js';
import analysisEngine from './analysis.js';
import email from './email.js';
import circuitBreaker from './circuit-breaker.js';
import earningsGuard from './earnings-guard.js';
import correlationAnalysis from './correlation-analysis-enhanced.js';
import exitLiquidity from './exit-liquidity.js';

/**
 * Trade Execution Service
 * Processes approved trades from the approval queue
 * Runs every 5 minutes to check for approved trades
 */

class TradeExecutor {
  /**
   * Process all approved trades
   */
  async processApprovedTrades() {
    try {
      // Check circuit breaker first
      const portfolio = await db.getPortfolioSummary();
      const portfolioValue = portfolio?.totalValue || 0;

      const cbStatus = await circuitBreaker.checkCircuitBreaker(portfolioValue);
      if (cbStatus.tripped) {
        console.log(`🚨 Circuit breaker active: ${cbStatus.reason} — no trades executed`);
        return;
      }

      // Get all approved trades
      const result = await db.query(
        `SELECT * FROM trade_approvals
         WHERE status = 'approved' AND executed_at IS NULL
         ORDER BY approved_at ASC`
      );

      const approvedTrades = result.rows || [];

      if (approvedTrades.length === 0) {
        return;
      }

      console.log(`\n💼 Processing ${approvedTrades.length} approved trades...`);

      for (const trade of approvedTrades) {
        try {
          await this.executeTrade(trade);
        } catch (error) {
          console.error(`❌ Failed to execute trade ${trade.id}:`, error.message);
          await email.sendErrorAlert(error, `Trade execution failed: ${trade.symbol}`);
        }
      }

      console.log(`✅ Approved trades processed`);

    } catch (error) {
      console.error('❌ Error processing approved trades:', error);
    }
  }

  /**
   * Execute a single approved trade
   */
  async executeTrade(approval) {
    console.log(`\n   💼 Executing ${approval.action} ${approval.quantity} ${approval.symbol}...`);

    try {
      // Check earnings blackout period
      const earningsCheck = await earningsGuard.isEarningsBlackout(approval.symbol);
      if (earningsCheck.blocked) {
        console.log(`   ⚠️ ${earningsCheck.reason}`);
        await db.query(
          `UPDATE trade_approvals
           SET status = 'expired', rejection_reason = $1
           WHERE id = $2`,
          [earningsCheck.reason, approval.id]
        );
        return;
      }

      // Get current price
      const quote = await tradier.getQuote(approval.symbol);
      const currentPrice = quote.last || quote.close;

      // Check if price is still within acceptable range (±5% from approval price)
      const priceChange = Math.abs((currentPrice - approval.entry_price) / approval.entry_price);
      if (priceChange > 0.05) {
        console.log(`   ⚠️ Price moved ${(priceChange * 100).toFixed(1)}% since approval - skipping`);
        await db.query(
          `UPDATE trade_approvals
           SET status = 'expired', rejection_reason = 'Price moved >5% since approval'
           WHERE id = $1`,
          [approval.id]
        );
        return;
      }

      if (approval.action === 'sell_short') {
        // Execute short with protection
        const result = await shortManager.placeShortWithProtection(
          approval.symbol,
          approval.quantity,
          approval.entry_price,
          approval.stop_loss,
          approval.take_profit
        );

        await this.createPositionLots(approval, result.order.id);

        // Mark as executed
        await tradeApproval.markExecuted(approval.id, result.order.id);

        console.log(`   ✅ Short executed successfully`);

      } else {
        // Execute long trade
        const order = await tradier.placeOrder(
          approval.symbol,
          approval.action,
          approval.quantity,
          approval.order_type,
          approval.entry_price
        );

        // Log trade
        await db.logTrade({
          symbol: approval.symbol,
          action: approval.action,
          quantity: approval.quantity,
          price: approval.entry_price,
          orderId: order.id,
          status: order.status,
          reasoning: approval.reasoning
        });

        // Create position lots
        await this.createPositionLots(approval, order.id);

        // Mark as executed
        await tradeApproval.markExecuted(approval.id, order.id);

        console.log(`   ✅ Trade executed successfully`);
      }

      // Send confirmation email
      await email.sendTradeConfirmation({
        action: approval.action,
        symbol: approval.symbol,
        quantity: approval.quantity,
        price: approval.entry_price,
        stopLoss: approval.stop_loss,
        takeProfit: approval.take_profit,
        reasoning: approval.reasoning
      });

    } catch (error) {
      console.error(`   ❌ Execution failed:`, error.message);
      throw error;
    }
  }

  /**
   * Create position lots for executed trade
   */
  async createPositionLots(approval, orderId) {
    const isShort = approval.action === 'sell_short';
    const positionType = isShort ? 'short' : 'long';

    // Determine lot type based on intent
    let lotType = 'swing';
    if (approval.intent === 'value_momentum' || approval.intent === 'quality_dip' || approval.intent === 'fundamental_hold') {
      lotType = 'long-term';
    }

    await db.createPositionLot({
      symbol: approval.symbol,
      lot_type: lotType,
      position_type: positionType,
      quantity: isShort ? -approval.quantity : approval.quantity,
      cost_basis: approval.entry_price,
      entry_date: new Date(),
      stop_loss: approval.stop_loss,
      take_profit: approval.take_profit,
      oco_order_id: orderId,
      thesis: approval.reasoning,
      original_intent: approval.intent,
      current_intent: approval.intent,
      pathway: approval.pathway,
      intent: approval.intent,
      strategy_type: approval.strategy_type,
      holding_period: approval.holding_period,
      confidence: approval.confidence,
      growth_potential: approval.growth_potential,
      stop_type: approval.stop_type,
      target_type: approval.target_type,
      trailing_stop_pct: approval.trailing_stop_pct,
      rebalance_threshold_pct: approval.rebalance_threshold_pct,
      max_holding_days: approval.max_holding_days,
      fundamental_stop_conditions: approval.fundamental_stop_conditions,
      catalysts: approval.catalysts,
      news_links: approval.news_links
    });

    // Also create aggregate position with pathway info
    await db.upsertPosition({
      symbol: approval.symbol,
      quantity: isShort ? -approval.quantity : approval.quantity,
      cost_basis: approval.entry_price,
      current_price: approval.entry_price,
      sector: null, // Will be populated by position reconciliation
      stock_type: positionType,
      stop_loss: approval.stop_loss,
      take_profit: approval.take_profit,
      pathway: approval.pathway,
      intent: approval.intent,
      peak_price: approval.entry_price,
      strategy_type: approval.strategy_type,
      holding_period: approval.holding_period,
      confidence: approval.confidence,
      growth_potential: approval.growth_potential,
      stop_type: approval.stop_type,
      stop_reason: approval.stop_reason,
      target_type: approval.target_type,
      has_fixed_target: approval.has_fixed_target,
      trailing_stop_pct: approval.trailing_stop_pct,
      rebalance_threshold_pct: approval.rebalance_threshold_pct,
      max_holding_days: approval.max_holding_days,
      fundamental_stop_conditions: approval.fundamental_stop_conditions,
      catalysts: approval.catalysts,
      news_links: approval.news_links
    });
  }
}

export default new TradeExecutor();
