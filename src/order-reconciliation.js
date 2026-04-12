/**
 * Order Status Reconciliation
 * Verifies positions table matches broker state
 */

import tradier from './tradier.js';
import * as db from './db.js';
import email from './email.js';

class OrderReconciliation {
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
}

export default new OrderReconciliation();
