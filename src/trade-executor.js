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
import thesisManager from './thesis-manager.js';
import orderReconciliation from './order-reconciliation.js';
import { resolveMarketPrice } from './utils.js';

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

  async executeApprovalById(approvalId) {
    const result = await db.query(
      `SELECT * FROM trade_approvals
       WHERE id = $1`,
      [approvalId]
    );

    const approval = result.rows?.[0];
    if (!approval) {
      throw new Error(`Approval ${approvalId} not found`);
    }

    if (!['approved', 'pending'].includes(approval.status)) {
      throw new Error(`Approval ${approvalId} is already ${approval.status}`);
    }

    if (approval.status === 'pending') {
      await db.query(
        `UPDATE trade_approvals
         SET status = 'approved', approved_at = NOW()
         WHERE id = $1`,
        [approvalId]
      );
      approval.status = 'approved';
    }

    try {
      await this.executeTrade(approval);
    } catch (error) {
      await db.query(
        `UPDATE trade_approvals
         SET status = 'pending', approved_at = NULL
         WHERE id = $1 AND executed_at IS NULL`,
        [approvalId]
      );
      throw error;
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
      const marketOpen = await tradier.isMarketOpen().catch(() => false);
      const currentPrice = resolveMarketPrice(quote, { marketOpen, fallback: 0 });

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

        await this.createPositionLots(approval, result.order.id, {
          entryOrderId: result.order.id,
          protectiveOrderId: result.order.id,
          entryPrice: approval.entry_price
        });

        // Mark as executed
        await tradeApproval.markExecuted(approval.id, result.order.id);
        await this.syncExitAuditExecution(approval, approval.entry_price).catch(() => null);

        console.log(`   ✅ Short executed successfully`);

      } else {
        const managementPlan = this.buildManagementPlan(approval);
        const order = await this.placeApprovedLongOrder(approval, managementPlan, marketOpen);

        // Execute long trade
        // Log trade
        await db.logTrade({
          symbol: approval.symbol,
          action: approval.action,
          quantity: approval.quantity,
          price: order.entryPrice,
          orderId: order.id,
          status: order.status,
          reasoning: approval.reasoning
        });

        // Create position lots
        await this.createPositionLots(approval, order.id, {
          entryOrderId: order.id,
          protectiveOrderId: order.protectiveOrderId || null,
          entryPrice: order.entryPrice
        });

        // Mark as executed
        await tradeApproval.markExecuted(approval.id, order.id);
        await this.syncExitAuditExecution(approval, order.entryPrice).catch(() => null);

        console.log(`   ✅ Trade executed successfully`);
      }

      if (approval.status === 'executed' || approval.order_type !== 'limit' || approval.action === 'sell_short') {
        await orderReconciliation.syncPositionsFromBroker();
      }
      await orderReconciliation.syncPositionMetadataFromLots();

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


  async syncExitAuditExecution(approval, executedPrice) {
    await db.query(
      `UPDATE exit_audit_log
       SET status = 'executed',
           executed_price = COALESCE($2, executed_price),
           updated_at = NOW()
       WHERE approval_id = $1`,
      [approval.id, executedPrice ?? null]
    ).catch(() => null);
  }

  buildManagementPlan(approval) {
    return thesisManager.buildEntryManagementPlan({
      action: approval.action,
      quantity: approval.quantity,
      entryPrice: approval.entry_price,
      stopLoss: approval.stop_loss,
      takeProfit: approval.take_profit,
      strategyType: approval.strategy_type,
      pathway: approval.pathway,
      secondary_pathways: approval.secondary_pathways || [],
      pathway_selection_rule: approval.pathway_selection_rule || 'approval_primary_pathway',
      intent: approval.intent,
      thesisState: approval.thesis_state,
      targetType: approval.target_type,
      trailingStopPct: approval.trailing_stop_pct,
      rebalanceThresholdPct: approval.rebalance_threshold_pct,
      hasFixedTarget: approval.has_fixed_target
    });
  }

  async placeApprovedLongOrder(approval, managementPlan, marketOpen) {
    const hasFixedProtection = managementPlan.targetType !== 'flexible_fundamental'
      && Number.isFinite(Number(managementPlan.stopLoss))
      && Number.isFinite(Number(managementPlan.takeProfit));

    if (hasFixedProtection && approval.order_type === 'limit' && !marketOpen) {
      const otocoOrder = await tradier.placeOTOCOOrder(
        approval.symbol,
        approval.action,
        approval.quantity,
        approval.entry_price,
        Number(managementPlan.stopLoss).toFixed(2),
        Number(managementPlan.takeProfit).toFixed(2)
      );

      return {
        ...otocoOrder,
        id: otocoOrder.id,
        status: otocoOrder.status,
        protectiveOrderId: otocoOrder.id,
        entryPrice: approval.entry_price
      };
    }

    const entryOrder = await tradier.placeOrder(
      approval.symbol,
      approval.action,
      approval.quantity,
      approval.order_type,
      approval.entry_price
    );

    let protectiveOrderId = null;
    if (hasFixedProtection && marketOpen) {
      const filledOrder = await this.waitForOrderFill(entryOrder.id, 30000);
      const filledQuantity = Number(filledOrder?.exec_quantity || filledOrder?.quantity || approval.quantity);
      if (!filledQuantity) {
        throw new Error(`Entry order ${entryOrder.id} for ${approval.symbol} did not fill before protection placement`);
      }

      const closingSide = approval.action === 'buy' ? 'sell' : 'buy';
      const ocoOrder = await tradier.placeOCOOrder(
        approval.symbol,
        closingSide,
        filledQuantity,
        Number(managementPlan.stopLoss).toFixed(2),
        Number(managementPlan.takeProfit).toFixed(2)
      );
      protectiveOrderId = ocoOrder.id;
    }

    return {
      ...entryOrder,
      id: entryOrder.id,
      status: entryOrder.status,
      protectiveOrderId,
      entryPrice: approval.entry_price
    };
  }

  async waitForOrderFill(orderId, timeoutMs = 30000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const order = await tradier.getOrderStatus(orderId);
      if (order?.status === 'filled') return order;
      if (['canceled', 'rejected', 'expired'].includes(order?.status)) {
        throw new Error(`Order ${orderId} ended with status ${order.status}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error(`Order ${orderId} fill timeout`);
  }

  /**
   * Create position lots for executed trade
   */
  async createPositionLots(approval, orderId, executionDetails = {}) {
    const isShort = approval.action === 'sell_short';
    const positionType = isShort ? 'short' : 'long';
    const managementPlan = this.buildManagementPlan(approval);

    // Determine lot type based on intent
    let lotType = 'swing';
    if (approval.intent === 'value_momentum' || approval.intent === 'quality_dip' || approval.intent === 'fundamental_hold') {
      lotType = 'long-term';
    }

    const stopLoss = managementPlan.stopLoss ?? approval.stop_loss;
    const takeProfit = managementPlan.takeProfit;

    await db.createPositionLot({
      symbol: approval.symbol,
      lot_type: lotType,
      position_type: positionType,
      quantity: isShort ? -approval.quantity : approval.quantity,
      cost_basis: executionDetails.entryPrice ?? approval.entry_price,
      entry_date: new Date(),
      stop_loss: stopLoss,
      take_profit: takeProfit,
      oco_order_id: executionDetails.protectiveOrderId || orderId,
      thesis: approval.investment_thesis || approval.reasoning,
      original_intent: approval.intent,
      current_intent: approval.intent,
      pathway: approval.pathway,
      secondary_pathways: approval.secondary_pathways || [],
      pathway_selection_rule: approval.pathway_selection_rule || 'approval_primary_pathway',
      intent: approval.intent,
      strategy_type: approval.strategy_type,
      thesis_state: managementPlan.thesisState,
      holding_posture: approval.holding_posture || managementPlan.holdingPosture,
      holding_period: approval.holding_period,
      confidence: approval.confidence,
      growth_potential: approval.growth_potential,
      stop_type: approval.stop_type,
      target_type: managementPlan.targetType,
      trailing_stop_pct: managementPlan.trailingStopPct,
      rebalance_threshold_pct: managementPlan.rebalanceThresholdPct,
      max_holding_days: approval.max_holding_days,
      fundamental_stop_conditions: approval.fundamental_stop_conditions,
      catalysts: approval.catalysts,
      news_links: approval.news_links
    });

    // Also create aggregate position with pathway info
    await db.upsertPosition({
      symbol: approval.symbol,
      quantity: isShort ? -approval.quantity : approval.quantity,
      cost_basis: executionDetails.entryPrice ?? approval.entry_price,
      current_price: executionDetails.entryPrice ?? approval.entry_price,
      sector: null, // Will be populated by position reconciliation
      stock_type: positionType,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      pathway: approval.pathway,
      intent: approval.intent,
      peak_price: executionDetails.entryPrice ?? approval.entry_price,
      strategy_type: approval.strategy_type,
      thesis_state: managementPlan.thesisState,
      holding_posture: approval.holding_posture || managementPlan.holdingPosture,
      holding_period: approval.holding_period,
      confidence: approval.confidence,
      growth_potential: approval.growth_potential,
      stop_type: approval.stop_type,
      stop_reason: approval.stop_reason,
      target_type: managementPlan.targetType,
      has_fixed_target: managementPlan.hasFixedTarget,
      trailing_stop_pct: managementPlan.trailingStopPct,
      rebalance_threshold_pct: managementPlan.rebalanceThresholdPct,
      max_holding_days: approval.max_holding_days,
      fundamental_stop_conditions: approval.fundamental_stop_conditions,
      catalysts: approval.catalysts,
      news_links: approval.news_links
    });
  }
}

export default new TradeExecutor();
