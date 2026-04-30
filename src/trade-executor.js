import tradeApproval from './trade-approval.js';
import shortManager from './short-manager.js';
import * as db from './db.js';
import tradier from './tradier.js';
import riskManager from './risk-manager.js';
import analysisEngine from './analysis.js';
import email from './email.js';
import earningsGuard from './earnings-guard.js';
import correlationAnalysis from './correlation-analysis-enhanced.js';
import exitLiquidity from './exit-liquidity.js';
import thesisManager from './thesis-manager.js';
import orderReconciliation from './order-reconciliation.js';
import { resolveMarketPrice } from './utils.js';

/**
 * Trade Execution Service
 * Processes autonomous trades staged in the execution queue
 */

class TradeExecutor {
  isWorkingOrderError(error) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('fill timeout');
  }

  shouldReturnToApproved(error, approval) {
    if (!approval) return false;
    if (approval.status === 'approved') return true;
    return Boolean(approval.approved_at);
  }

  isExecutionRaceError(error) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('already executed')
      || message.includes('already processing')
      || message.includes('could not be locked for execution')
      || message.includes('is already executing');
  }

  /**
   * Process all approved autonomous trade intents
   */
  async processApprovedTrades() {
    try {
      // Get all approved queue items
      const result = await db.query(
        `SELECT * FROM trade_approvals
         WHERE status = 'approved' AND executed_at IS NULL
         ORDER BY approved_at ASC`
      );

      const approvedTrades = result.rows || [];

      if (approvedTrades.length === 0) {
        return;
      }

      console.log(`\n💼 Processing ${approvedTrades.length} approved trade intents...`);

      for (const trade of approvedTrades) {
        try {
          await this.executeApprovalById(trade.id);
        } catch (error) {
          if (this.isExecutionRaceError(error)) {
            console.warn(`⚠️ Skipping duplicate execution attempt for trade intent ${trade.id}: ${error.message}`);
            continue;
          }
          console.error(`❌ Failed to execute trade ${trade.id}:`, error.message);
          await email.sendErrorAlert(error, `Trade execution failed: ${trade.symbol}`);
        }
      }

      console.log(`✅ Approved trade intents processed`);

    } catch (error) {
      console.error('❌ Error processing approved trade intents:', error);
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
      throw new Error(`Trade intent ${approvalId} not found`);
    }

    if (approval.status === 'executing') {
      throw new Error(`Trade intent ${approvalId} is already processing`);
    }

    if (approval.status === 'executed') {
      throw new Error(`Trade intent ${approvalId} is already executed`);
    }

    if (!['approved', 'pending'].includes(approval.status)) {
      throw new Error(`Trade intent ${approvalId} is already ${approval.status}`);
    }

    if (approval.status === 'pending') {
      await db.query(
        `UPDATE trade_approvals
         SET status = 'approved', approved_at = NOW()
         WHERE id = $1 AND status = 'pending'`,
        [approvalId]
      );

      const refreshed = await db.query(
        `SELECT * FROM trade_approvals
         WHERE id = $1`,
        [approvalId]
      );
      const refreshedApproval = refreshed.rows?.[0];
      if (!refreshedApproval || refreshedApproval.status !== 'approved') {
        throw new Error(`Trade intent ${approvalId} could not be moved to approved state`);
      }

      Object.assign(approval, refreshedApproval);
    }

    const lockResult = await db.query(
      `UPDATE trade_approvals
       SET status = 'executing'
       WHERE id = $1 AND status = 'approved' AND executed_at IS NULL
       RETURNING *`,
      [approvalId]
    );

    const lockedApproval = lockResult.rows?.[0];
    if (!lockedApproval) {
      const current = await db.query(
        `SELECT status, executed_at
         FROM trade_approvals
         WHERE id = $1`,
        [approvalId]
      );
      const currentStatus = current.rows?.[0]?.status || 'unknown';
      throw new Error(`Trade intent ${approvalId} could not be locked for execution (status: ${currentStatus})`);
    }

    try {
      await this.executeTrade(lockedApproval);
    } catch (error) {
      if (this.isWorkingOrderError(error)) {
        await db.query(
          `UPDATE trade_approvals
           SET status = 'approved'
           WHERE id = $1 AND status = 'executing' AND executed_at IS NULL`,
          [approvalId]
        );
        throw new Error(`Trade intent ${approvalId} has a working broker order pending fill`);
      }

      const returnToApproved = this.shouldReturnToApproved(error, lockedApproval);
      await db.query(
        `UPDATE trade_approvals
         SET status = $2,
             approved_at = CASE WHEN $2 = 'approved' THEN COALESCE(approved_at, NOW()) ELSE NULL END
         WHERE id = $1 AND status = 'executing' AND executed_at IS NULL`,
        [approvalId, returnToApproved ? 'approved' : 'pending']
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

      // Check if price is still within acceptable range (±5% from queued entry price)
      const priceChange = Math.abs((currentPrice - approval.entry_price) / approval.entry_price);
      if (priceChange > 0.05) {
        console.log(`   ⚠️ Price moved ${(priceChange * 100).toFixed(1)}% since queueing - skipping`);
        await db.query(
          `UPDATE trade_approvals
           SET status = 'expired', rejection_reason = 'Price moved >5% since approval'
           WHERE id = $1`,
          [approval.id]
        );
        return;
      }

      let shouldSyncPositions = approval.action === 'sell_short';

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

        if (approval.order_type === 'limit' && marketOpen && String(order.status || '').toLowerCase() !== 'filled') {
          console.log(`   ⏳ Limit order submitted and left working (${order.status})`);
          return;
        }

        shouldSyncPositions = true;

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

      if (shouldSyncPositions) {
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
      if (this.isWorkingOrderError(error)) {
        console.warn(`   ⏳ Entry order still working for ${approval.symbol}: ${error.message}`);
      }
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
