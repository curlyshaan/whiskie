import * as db from './db.js';
import email from './email.js';

/**
 * Trade Intent Queue
 * Persists autonomous trade intents and optionally supports manual operator intervention
 *
 * Flow:
 * 1. Bot generates trade intents
 * 2. Trades are queued in trade_approvals for execution lifecycle tracking
 * 3. Autonomous flow can auto-approve intents immediately
 * 4. Optional operator UI can still inspect, approve, or reject edge cases
 * 5. Approved trades are executed
 *
 * Note: OCO/OTOCO orders only require a tracked entry intent for the initial entry order
 * Stop-loss and take-profit legs are automatically placed after entry fills
 */

class TradeApprovalManager {
  constructor() {
    this.AUTO_EXPIRE_HOURS = 24; // Auto-reject trades after 24 hours
  }

  /**
   * Initialize trade-intent queue table
   */
  async initDatabase() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS trade_approvals (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        action VARCHAR(20) NOT NULL,
        quantity INTEGER NOT NULL,
        entry_price DECIMAL(10, 2),
        stop_loss DECIMAL(10, 2),
        take_profit DECIMAL(10, 2),
        order_type VARCHAR(20),
        pathway VARCHAR(50),
        intent VARCHAR(50),
        reasoning TEXT,
        investment_thesis TEXT,
        strategy_type VARCHAR(50),
        thesis_state VARCHAR(20),
        holding_posture VARCHAR(30),
        catalysts JSONB,
        fundamentals JSONB,
        technical_setup TEXT,
        risk_factors TEXT,
        holding_period VARCHAR(50),
        confidence VARCHAR(20),
        growth_potential VARCHAR(50),
        news_links JSONB,
        stop_type VARCHAR(20),
        stop_reason TEXT,
        has_fixed_target BOOLEAN,
        target_type VARCHAR(20),
        trailing_stop_pct DECIMAL(5, 2),
        rebalance_threshold_pct DECIMAL(5, 2),
        max_holding_days INTEGER,
        fundamental_stop_conditions JSONB,
        override_phase2_decision VARCHAR(10),
        override_symbol VARCHAR(10),
        override_reason TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        approved_at TIMESTAMP,
        rejected_at TIMESTAMP,
        executed_at TIMESTAMP,
        rejection_reason TEXT
      )
    `);

    // Backfill columns for existing databases
    await db.query(`
      ALTER TABLE trade_approvals
      ADD COLUMN IF NOT EXISTS pathway VARCHAR(50),
      ADD COLUMN IF NOT EXISTS intent VARCHAR(50),
      ADD COLUMN IF NOT EXISTS investment_thesis TEXT,
      ADD COLUMN IF NOT EXISTS strategy_type VARCHAR(50),
      ADD COLUMN IF NOT EXISTS thesis_state VARCHAR(20),
      ADD COLUMN IF NOT EXISTS holding_posture VARCHAR(30),
      ADD COLUMN IF NOT EXISTS catalysts JSONB,
      ADD COLUMN IF NOT EXISTS fundamentals JSONB,
      ADD COLUMN IF NOT EXISTS technical_setup TEXT,
      ADD COLUMN IF NOT EXISTS risk_factors TEXT,
      ADD COLUMN IF NOT EXISTS holding_period VARCHAR(50),
      ADD COLUMN IF NOT EXISTS confidence VARCHAR(20),
      ADD COLUMN IF NOT EXISTS growth_potential VARCHAR(50),
      ADD COLUMN IF NOT EXISTS news_links JSONB,
      ADD COLUMN IF NOT EXISTS stop_type VARCHAR(20),
      ADD COLUMN IF NOT EXISTS stop_reason TEXT,
      ADD COLUMN IF NOT EXISTS has_fixed_target BOOLEAN,
      ADD COLUMN IF NOT EXISTS target_type VARCHAR(20),
      ADD COLUMN IF NOT EXISTS trailing_stop_pct DECIMAL(5, 2),
      ADD COLUMN IF NOT EXISTS rebalance_threshold_pct DECIMAL(5, 2),
      ADD COLUMN IF NOT EXISTS max_holding_days INTEGER,
      ADD COLUMN IF NOT EXISTS fundamental_stop_conditions JSONB,
      ADD COLUMN IF NOT EXISTS secondary_pathways JSONB,
      ADD COLUMN IF NOT EXISTS pathway_selection_rule TEXT,
      ADD COLUMN IF NOT EXISTS override_phase2_decision VARCHAR(10),
      ADD COLUMN IF NOT EXISTS override_symbol VARCHAR(10),
      ADD COLUMN IF NOT EXISTS override_reason TEXT,
      ADD COLUMN IF NOT EXISTS decision_run_id VARCHAR(64),
      ADD COLUMN IF NOT EXISTS source_phase VARCHAR(50),
      ADD COLUMN IF NOT EXISTS raw_model_quantity INTEGER,
      ADD COLUMN IF NOT EXISTS quantity_adjustment_note TEXT
    `);

    console.log('✅ Trade intent table initialized');
  }

  /**
   * Submit trade intent
   * Returns queue ID
   */
  async submitForApproval(trade, skipEmail = false) {
    const {
      symbol,
      action,
      quantity,
      entryPrice,
      stopLoss,
      takeProfit,
      orderType = 'limit',
      pathway,
      secondaryPathways,
      pathwaySelectionRule,
      intent,
      reasoning,
      investmentThesis,
      strategyType,
      thesisState,
      holdingPosture,
      catalysts,
      fundamentals,
      technicalSetup,
      riskFactors,
      holdingPeriod,
      confidence,
      growthPotential,
      newsLinks,
      stopType,
      stopReason,
      hasFixedTarget,
      targetType,
      trailingStopPct,
      rebalanceThresholdPct,
      maxHoldingDays,
      fundamentalStopConditions,
      overridePhase2Decision,
      overrideSymbol,
      overrideReason,
      decisionRunId,
      sourcePhase,
      rawModelQuantity,
      quantityAdjustmentNote
    } = trade;

    // Retain expiry for optional manual intervention workflows
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.AUTO_EXPIRE_HOURS);

    // Insert into database
    const result = await db.query(
      `INSERT INTO trade_approvals
       (symbol, action, quantity, entry_price, stop_loss, take_profit,
        order_type, pathway, intent, reasoning, investment_thesis, strategy_type,
        secondary_pathways, pathway_selection_rule,
        thesis_state, holding_posture, catalysts, fundamentals, technical_setup,
        risk_factors, holding_period, confidence, growth_potential, news_links,
        stop_type, stop_reason, has_fixed_target, target_type, trailing_stop_pct,
        rebalance_threshold_pct, max_holding_days, fundamental_stop_conditions,
        override_phase2_decision, override_symbol, override_reason,
        decision_run_id, source_phase, raw_model_quantity, quantity_adjustment_note, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40)
       RETURNING id`,
      [symbol, action, quantity, entryPrice, stopLoss, takeProfit,
       orderType, pathway, intent, reasoning, investmentThesis || null, strategyType || null,
       secondaryPathways ? JSON.stringify(secondaryPathways) : JSON.stringify([]),
       pathwaySelectionRule || (pathway ? 'approval_primary_pathway' : 'unclassified'),
       thesisState || null, holdingPosture || null,
       catalysts ? JSON.stringify(catalysts) : null,
       fundamentals ? JSON.stringify(fundamentals) : null,
       technicalSetup || null, riskFactors || null, holdingPeriod || null,
       confidence || null, growthPotential || null,
       newsLinks ? JSON.stringify(newsLinks) : null,
       stopType || null, stopReason || null, hasFixedTarget ?? null,
       targetType || null, trailingStopPct ?? null, rebalanceThresholdPct ?? null,
       maxHoldingDays ?? null,
       fundamentalStopConditions ? JSON.stringify(fundamentalStopConditions) : null,
       overridePhase2Decision || null,
       overrideSymbol || null,
       overrideReason || null,
       decisionRunId || null,
       sourcePhase || 'phase4',
       rawModelQuantity ?? quantity,
       quantityAdjustmentNote || null,
       expiresAt]
    );

    const approvalId = result.rows[0].id;

    // Send email notification (unless batching)
    if (!skipEmail) {
      await this.sendApprovalEmail(approvalId, trade);
    }

    console.log(`📥 Trade intent ${approvalId} queued for ${symbol}`);
    return approvalId;
  }

  async submitForExecution(trade, skipEmail = true) {
    const approvalId = await this.submitForApproval(trade, skipEmail);

    await db.query(
      `UPDATE trade_approvals
       SET status = 'approved',
           approved_at = NOW()
       WHERE id = $1
         AND status = 'pending'
       RETURNING id`,
      [approvalId]
    );

    console.log(`🤖 Trade intent ${approvalId} auto-approved for autonomous execution`);
    return approvalId;
  }

  /**
   * Submit multiple trade intents (batch)
   */
  async submitBatchForApproval(trades) {
    const approvalIds = [];

    for (const trade of trades) {
      const id = await this.submitForApproval(trade, true);
      approvalIds.push(id);
    }

    await this.sendBatchApprovalEmail(approvalIds, trades);

    console.log(`📥 Batch of ${trades.length} trade intents queued`);
    return approvalIds;
  }

  async approveBatch(approvalIds = [], userId = 'user') {
    const ids = [...new Set((approvalIds || []).map(id => Number(id)).filter(Number.isFinite))];
    if (!ids.length) {
      return { success: true, approvals: [] };
    }

    const approved = [];
    for (const approvalId of ids) {
      const result = await this.approveTrade(approvalId, userId);
      approved.push(result);
    }

    return { success: true, approvals: approved };
  }

  async rejectBatch(approvalIds = [], reason = 'User rejected batch', userId = 'user') {
    const ids = [...new Set((approvalIds || []).map(id => Number(id)).filter(Number.isFinite))];
    if (!ids.length) {
      return { success: true, approvals: [] };
    }

    const rejected = [];
    for (const approvalId of ids) {
      const result = await this.rejectTrade(approvalId, reason, userId);
      rejected.push(result);
    }

    return { success: true, approvals: rejected };
  }

  /**
   * Send email notification for single manual-review trade
   */
  async sendApprovalEmail(approvalId, trade) {
    const { symbol, action, quantity, entryPrice, stopLoss, takeProfit, reasoning } = trade;

    const subject = `Manual Trade Review Requested: ${action.toUpperCase()} ${quantity} ${symbol}`;

    const html = `
      <h2>Manual Trade Review Requested</h2>
      <p>The bot has identified a trading opportunity that was routed for operator review.</p>

      <h3>Trade Details:</h3>
      <ul>
        <li><strong>Symbol:</strong> ${symbol}</li>
        <li><strong>Action:</strong> ${action.toUpperCase()}</li>
        <li><strong>Quantity:</strong> ${quantity} shares</li>
        <li><strong>Entry Price:</strong> $${entryPrice?.toFixed(2) || 'Market'}</li>
        ${stopLoss ? `<li><strong>Stop Loss:</strong> $${stopLoss.toFixed(2)}</li>` : ''}
        ${takeProfit ? `<li><strong>Take Profit:</strong> $${takeProfit.toFixed(2)}</li>` : ''}
      </ul>

      <h3>Reasoning:</h3>
      <p>${reasoning}</p>

      <h3>Action Required:</h3>
      <p>Please inspect this queued trade in the dashboard:</p>
      <p><a href="${process.env.DASHBOARD_URL || 'http://localhost:8080'}/approvals"
         style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
         Open Trade Queue
      </a></p>

      <p><em>This queued review expires in 24 hours if not acted on.</em></p>

      <hr>
      <p style="font-size: 12px; color: #666;">
        Queue ID: ${approvalId}<br>
        Note: For OCO/OTOCO orders, the queue tracks the entry order.
        Stop-loss and take-profit orders are automatically placed after entry fills.
      </p>
    `;

    await email.sendEmail(email.alertEmail, subject, html);
  }

  /**
   * Send batch email notification for multiple trades
   */
  async sendBatchApprovalEmail(approvalIds, trades) {
    const subject = `${trades.length} Trades Need Manual Review`;

    let tradesHtml = '';
    trades.forEach((trade, i) => {
      tradesHtml += `
        <div style="border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px;">
          <h4>${i + 1}. ${trade.action.toUpperCase()} ${trade.quantity} ${trade.symbol}</h4>
          ${trade.quantityAdjustmentNote ? `<p><strong>Sizing:</strong> ${trade.quantityAdjustmentNote}</p>` : ''}
          <ul>
            <li><strong>Entry:</strong> $${trade.entryPrice?.toFixed(2) || 'Market'}</li>
            ${trade.stopLoss ? `<li><strong>Stop Loss:</strong> $${trade.stopLoss.toFixed(2)}</li>` : ''}
            ${trade.takeProfit ? `<li><strong>Take Profit:</strong> $${trade.takeProfit.toFixed(2)}</li>` : ''}
          </ul>
          <p><strong>Reasoning:</strong> ${trade.reasoning}</p>
        </div>
      `;
    });

    const html = `
      <h2>${trades.length} Trades Need Manual Review</h2>
      <p>The bot has identified multiple trading opportunities that were routed for operator review.</p>

      ${tradesHtml}

      <h3>Action Required:</h3>
      <p>Please inspect these queued trades in the dashboard:</p>
      <p><a href="${process.env.DASHBOARD_URL || 'http://localhost:8080'}/approvals"
         style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
         Open Trade Queue
      </a></p>

      <p><em>These queued reviews expire in 24 hours.</em></p>
    `;

    await email.sendEmail(email.alertEmail, subject, html);
  }

  /**
   * Get all pending manual-review trade intents
   */
  async getPendingApprovals() {
    const result = await db.query(
      `SELECT * FROM trade_approvals
       WHERE status = 'pending' AND expires_at > NOW()
       ORDER BY created_at DESC`
    );

    return result.rows || [];
  }

  /**
   * Get trade intent by ID
   */
  async getApproval(approvalId) {
    const result = await db.query(
      `SELECT * FROM trade_approvals WHERE id = $1`,
      [approvalId]
    );

    return result.rows[0] || null;
  }

  /**
   * Approve trade
   */
  async approveTrade(approvalId, userId = 'user') {
    const approval = await this.getApproval(approvalId);

    if (!approval) {
      throw new Error(`Trade intent ${approvalId} not found`);
    }

    if (approval.status !== 'pending') {
      throw new Error(`Trade intent ${approvalId} is already ${approval.status}`);
    }

    // Check if expired
    if (new Date(approval.expires_at) < new Date()) {
      await db.query(
        `UPDATE trade_approvals
         SET status = 'expired',
             rejected_at = NOW(),
             rejection_reason = COALESCE(rejection_reason, 'Approval expired')
         WHERE id = $1`,
        [approvalId]
      );
      throw new Error(`Trade intent ${approvalId} has expired`);
    }

    // Mark as approved
    await db.query(
      `UPDATE trade_approvals
       SET status = 'approved', approved_at = NOW()
       WHERE id = $1`,
      [approvalId]
    );

    console.log(`✅ Trade intent ${approvalId} approved by ${userId}`);

    return {
      success: true,
      message: 'Trade intent approved and ready for execution',
      approvalId
    };
  }

  /**
   * Reject trade
   */
  async rejectTrade(approvalId, reason = 'User rejected', userId = 'user') {
    const approval = await this.getApproval(approvalId);

    if (!approval) {
      throw new Error(`Trade intent ${approvalId} not found`);
    }

    if (approval.status !== 'pending') {
      throw new Error(`Trade intent ${approvalId} is already ${approval.status}`);
    }

    // Mark as rejected
    await db.query(
      `UPDATE trade_approvals
       SET status = 'rejected', rejected_at = NOW(), rejection_reason = $2
       WHERE id = $1`,
      [approvalId, reason]
    );

    console.log(`❌ Trade intent ${approvalId} rejected by ${userId}: ${reason}`);

    return {
      success: true,
      message: 'Trade intent rejected',
      approvalId
    };
  }

  /**
   * Mark trade as executed (called after successful order placement)
   */
  async markExecuted(approvalId, orderId) {
    await db.query(
      `UPDATE trade_approvals
       SET status = 'executed', executed_at = NOW()
       WHERE id = $1`,
      [approvalId]
    );

    console.log(`✅ Trade intent ${approvalId} executed (order ${orderId})`);
  }

  /**
   * Auto-expire old pending manual-review trade intents
   * Run this periodically (e.g., hourly cron)
   */
  async expirePendingApprovals() {
    const result = await db.query(
      `UPDATE trade_approvals
       SET status = 'expired',
           rejected_at = NOW(),
           rejection_reason = COALESCE(rejection_reason, 'Approval expired')
       WHERE status = 'pending' AND expires_at < NOW()
       RETURNING id, symbol`
    );

    const expired = result.rows || [];

    if (expired.length > 0) {
      console.log(`⏰ Expired ${expired.length} pending trade intents`);
      expired.forEach(t => console.log(`   - ${t.symbol} (ID: ${t.id})`));
    }

    return expired;
  }

  /**
   * Clear all pending manual-review trade intents
   * Marks all pending trades as rejected with reason "Cleared by user"
   */
  async clearAllPending() {
    const result = await db.query(
      `UPDATE trade_approvals
       SET status = 'rejected', rejected_at = NOW(), rejection_reason = 'Cleared by user'
       WHERE status = 'pending'
       RETURNING id, symbol`
    );

    const cleared = result.rows || [];

    if (cleared.length > 0) {
      console.log(`🗑️ Cleared ${cleared.length} pending trade intents`);
      cleared.forEach(t => console.log(`   - ${t.symbol} (ID: ${t.id})`));
    }

    return {
      success: true,
      count: cleared.length,
      trades: cleared
    };
  }

  /**
   * Get trade-intent queue statistics
   */
  async getApprovalStats() {
    const result = await db.query(`
      SELECT
        status,
        COUNT(*) as count
      FROM trade_approvals
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY status
    `);

    const stats = {
      pending: 0,
      approved: 0,
      rejected: 0,
      expired: 0,
      executed: 0
    };

    result.rows.forEach(row => {
      stats[row.status] = parseInt(row.count);
    });

    return stats;
  }

  async getApprovalAnalytics() {
    const result = await db.query(`
      SELECT
        COALESCE(source_phase, 'unknown') AS source_phase,
        status,
        COUNT(*) AS count,
        AVG(EXTRACT(EPOCH FROM (COALESCE(approved_at, rejected_at, executed_at, NOW()) - created_at))) AS avg_decision_seconds
      FROM trade_approvals
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY COALESCE(source_phase, 'unknown'), status
      ORDER BY source_phase ASC, status ASC
    `);

    return result.rows || [];
  }
}

export default new TradeApprovalManager();
