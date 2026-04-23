/**
 * Order Status Reconciliation
 * Verifies positions table matches broker state
 */

import tradier from './tradier.js';
import * as db from './db.js';
import email from './email.js';
import analysisEngine from './analysis.js';

class OrderReconciliation {
  async ensurePositionMetadataColumns() {
    await db.query(`
      ALTER TABLE positions
      ADD COLUMN IF NOT EXISTS pathway VARCHAR(50),
      ADD COLUMN IF NOT EXISTS intent VARCHAR(50),
      ADD COLUMN IF NOT EXISTS strategy_type VARCHAR(50),
      ADD COLUMN IF NOT EXISTS thesis_state VARCHAR(20),
      ADD COLUMN IF NOT EXISTS holding_posture VARCHAR(30),
      ADD COLUMN IF NOT EXISTS holding_period VARCHAR(50),
      ADD COLUMN IF NOT EXISTS secondary_pathways JSONB,
      ADD COLUMN IF NOT EXISTS pathway_selection_rule TEXT,
      ADD COLUMN IF NOT EXISTS confidence VARCHAR(20),
      ADD COLUMN IF NOT EXISTS growth_potential VARCHAR(50),
      ADD COLUMN IF NOT EXISTS stop_type VARCHAR(20),
      ADD COLUMN IF NOT EXISTS stop_loss DECIMAL(10, 2),
      ADD COLUMN IF NOT EXISTS take_profit DECIMAL(10, 2),
      ADD COLUMN IF NOT EXISTS target_type VARCHAR(20),
      ADD COLUMN IF NOT EXISTS has_fixed_target BOOLEAN,
      ADD COLUMN IF NOT EXISTS trailing_stop_pct DECIMAL(5, 2),
      ADD COLUMN IF NOT EXISTS rebalance_threshold_pct DECIMAL(5, 2),
      ADD COLUMN IF NOT EXISTS max_holding_days INTEGER,
      ADD COLUMN IF NOT EXISTS fundamental_stop_conditions JSONB,
      ADD COLUMN IF NOT EXISTS catalysts JSONB,
      ADD COLUMN IF NOT EXISTS news_links JSONB;
    `);
  }

  /**
   * Reconcile positions with broker state
   */
  async reconcilePositions() {
    try {
      console.log('\n🔄 Reconciling positions with broker...');

      // Get positions from database
      const dbPositions = await db.getPositions();

      // Get positions from broker
      const brokerPositions = await tradier.getPositions();

      const discrepancies = [];

      // Check each DB position exists at broker
      for (const dbPos of dbPositions) {
        const brokerPos = brokerPositions.find(bp => bp.symbol === dbPos.symbol);

        if (!brokerPos) {
          discrepancies.push({
            symbol: dbPos.symbol,
            issue: 'Position in DB but not at broker',
            dbQty: dbPos.quantity,
            brokerQty: 0
          });
        } else if (Math.abs(dbPos.quantity) !== Math.abs(brokerPos.quantity)) {
          discrepancies.push({
            symbol: dbPos.symbol,
            issue: 'Quantity mismatch',
            dbQty: dbPos.quantity,
            brokerQty: brokerPos.quantity
          });
        }
      }

      // Check for positions at broker not in DB
      for (const brokerPos of brokerPositions) {
        const dbPos = dbPositions.find(dp => dp.symbol === brokerPos.symbol);
        if (!dbPos) {
          discrepancies.push({
            symbol: brokerPos.symbol,
            issue: 'Position at broker but not in DB',
            dbQty: 0,
            brokerQty: brokerPos.quantity
          });
        }
      }

      if (discrepancies.length > 0) {
        console.log(`⚠️ Found ${discrepancies.length} discrepancies`);
        await this.handleDiscrepancies(discrepancies);
      } else {
        console.log('✅ All positions reconciled');
      }

      return { discrepancies };

    } catch (error) {
      console.error('Error reconciling positions:', error);
      return { discrepancies: [], error: error.message };
    }
  }

  async syncPositionsFromBroker() {
    try {
      console.log('\n📦 Syncing positions from Tradier into local portfolio state...');

      const portfolio = await analysisEngine.getPortfolioState();
      const dbPositions = await db.getPositions();
      const tradierSymbols = new Set((portfolio.positions || []).map(p => p.symbol));
      const dbSymbols = new Set(dbPositions.map(p => p.symbol));

      const removed = [];
      const updated = [];
      const added = [];

      for (const dbPos of dbPositions) {
        if (!tradierSymbols.has(dbPos.symbol)) {
          await db.query('DELETE FROM positions WHERE symbol = $1', [dbPos.symbol]);
          await db.query('DELETE FROM position_lots WHERE symbol = $1', [dbPos.symbol]);
          removed.push(dbPos.symbol);
        }
      }

      for (const pos of portfolio.positions || []) {
        await db.upsertPosition({
          symbol: pos.symbol,
          quantity: pos.quantity,
          cost_basis: pos.cost_basis,
          current_price: pos.currentPrice,
          sector: pos.sector,
          stock_type: pos.stock_type
        });

        await db.query(
          `UPDATE position_lots SET current_price = $1 WHERE symbol = $2`,
          [pos.currentPrice, pos.symbol]
        );

        if (dbSymbols.has(pos.symbol)) {
          updated.push(pos.symbol);
        } else {
          added.push(pos.symbol);
        }
      }

      console.log(`✅ Portfolio sync complete (${added.length} added, ${updated.length} updated, ${removed.length} removed)`);

      return {
        success: true,
        added,
        updated,
        removed,
        totalBrokerPositions: (portfolio.positions || []).length
      };
    } catch (error) {
      console.error('Error syncing positions from broker:', error);
      return {
        success: false,
        error: error.message,
        added: [],
        updated: [],
        removed: []
      };
    }
  }

  /**
   * Handle discrepancies
   */
  async handleDiscrepancies(discrepancies) {
    // Log to database
    await db.query(
      `INSERT INTO reconciliation_log (discrepancies, created_at)
       VALUES ($1, NOW())`,
      [JSON.stringify(discrepancies)]
    );

    // Send alert email
    let message = 'Position discrepancies detected:\n\n';
    for (const d of discrepancies) {
      message += `${d.symbol}: ${d.issue}\n`;
      message += `  DB: ${d.dbQty} shares\n`;
      message += `  Broker: ${d.brokerQty} shares\n\n`;
    }
    message += 'Please review and manually reconcile.';

    await email.sendAlert('Position Reconciliation Alert', message);
  }

  async syncPositionMetadataFromLots() {
    try {
      await this.ensurePositionMetadataColumns();

      const symbolsResult = await db.query(
        `SELECT DISTINCT symbol
         FROM position_lots`
      );

      for (const row of symbolsResult.rows || []) {
        const symbol = row.symbol;
        const lotResult = await db.query(
          `SELECT pathway, current_intent, strategy_type, thesis_state, holding_posture,
                  holding_period, secondary_pathways, pathway_selection_rule, confidence,
                  growth_potential, stop_type, target_type, trailing_stop_pct,
                  rebalance_threshold_pct, max_holding_days, stop_loss, take_profit,
                  has_fixed_target, fundamental_stop_conditions, catalysts, news_links
           FROM position_lots
           WHERE symbol = $1
           ORDER BY entry_date DESC NULLS LAST, id DESC
           LIMIT 1`,
          [symbol]
        );

        const lot = lotResult.rows?.[0];
        if (!lot) continue;

        await db.query(
          `UPDATE positions
           SET pathway = COALESCE($2, pathway),
               intent = COALESCE($3, intent),
               strategy_type = COALESCE($4, strategy_type),
               thesis_state = COALESCE($5, thesis_state),
               holding_posture = COALESCE($6, holding_posture),
               holding_period = COALESCE($7, holding_period),
               secondary_pathways = CASE
                 WHEN $8::jsonb IS NOT NULL AND (secondary_pathways IS NULL OR secondary_pathways = '[]'::jsonb) THEN $8::jsonb
                 ELSE secondary_pathways
               END,
               pathway_selection_rule = CASE
                 WHEN $9 IS NOT NULL AND (pathway_selection_rule IS NULL OR pathway_selection_rule = 'unclassified') THEN $9
                 ELSE pathway_selection_rule
               END,
               confidence = COALESCE($10, confidence),
               growth_potential = COALESCE($11, growth_potential),
               stop_type = COALESCE($12, stop_type),
               target_type = COALESCE($13, target_type),
               trailing_stop_pct = COALESCE($14, trailing_stop_pct),
               rebalance_threshold_pct = COALESCE($15, rebalance_threshold_pct),
               max_holding_days = COALESCE($16, max_holding_days),
               stop_loss = COALESCE($17, stop_loss),
               take_profit = COALESCE($18, take_profit),
               has_fixed_target = COALESCE($19, has_fixed_target),
               fundamental_stop_conditions = COALESCE($20::jsonb, fundamental_stop_conditions),
               catalysts = COALESCE($21::jsonb, catalysts),
               news_links = COALESCE($22::jsonb, news_links),
               updated_at = CURRENT_TIMESTAMP
           WHERE symbol = $1`,
          [
            symbol,
            lot.pathway || null,
            lot.current_intent || null,
            lot.strategy_type || null,
            lot.thesis_state || null,
            lot.holding_posture || null,
            lot.holding_period || null,
            JSON.stringify(lot.secondary_pathways || []),
            lot.pathway_selection_rule || (lot.pathway ? 'lot_primary_pathway' : 'unclassified'),
            lot.confidence || null,
            lot.growth_potential || null,
            lot.stop_type || null,
            lot.target_type || null,
            lot.trailing_stop_pct ?? null,
            lot.rebalance_threshold_pct ?? null,
            lot.max_holding_days ?? null,
            lot.stop_loss ?? null,
            lot.take_profit ?? null,
            lot.has_fixed_target ?? null,
            lot.fundamental_stop_conditions ? JSON.stringify(lot.fundamental_stop_conditions) : null,
            lot.catalysts ? JSON.stringify(lot.catalysts) : null,
            lot.news_links ? JSON.stringify(lot.news_links) : null
          ]
        );
      }

      return { success: true };
    } catch (error) {
      console.error('Error syncing position metadata from lots:', error);
      return { success: false, error: error.message };
    }
  }
}

export default new OrderReconciliation();
