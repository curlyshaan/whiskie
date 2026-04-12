/**
 * Corporate Action Handler
 * Monitors and handles stock splits, dividends, mergers, delistings
 */

import * as db from './db.js';
import email from './email.js';

class CorporateActionHandler {
  /**
   * Check for corporate actions affecting positions
   */
  async checkCorporateActions() {
    try {
      const positions = await db.getPositions();
      const actions = [];

      for (const position of positions) {
        // Check for pending corporate actions
        const action = await this.getCorporateAction(position.symbol);
        if (action) {
          actions.push({ position, action });
        }
      }

      if (actions.length > 0) {
        await this.handleActions(actions);
      }

      return actions;

    } catch (error) {
      console.error('Error checking corporate actions:', error);
      return [];
    }
  }

  /**
   * Get corporate action for symbol (placeholder - would integrate with data provider)
   */
  async getCorporateAction(symbol) {
    // Placeholder - would fetch from FMP or similar
    // Returns: { type: 'split|dividend|merger|delisting', details: {...} }
    return null;
  }

  /**
   * Handle corporate actions
   */
  async handleActions(actions) {
    for (const { position, action } of actions) {
      switch (action.type) {
        case 'split':
          await this.handleSplit(position, action.details);
          break;
        case 'dividend':
          await this.handleDividend(position, action.details);
          break;
        case 'merger':
          await this.handleMerger(position, action.details);
          break;
        case 'delisting':
          await this.handleDelisting(position, action.details);
          break;
      }
    }
  }

  /**
   * Handle stock split
   */
  async handleSplit(position, details) {
    const { ratio } = details; // e.g., 2:1 split
    const newQuantity = position.quantity * ratio;
    const newCostBasis = position.cost_basis / ratio;

    await db.query(
      `UPDATE positions
       SET quantity = $1, cost_basis = $2
       WHERE symbol = $3`,
      [newQuantity, newCostBasis, position.symbol]
    );

    await email.sendAlert(
      `Stock Split: ${position.symbol}`,
      `${position.symbol} split ${ratio}:1\nAdjusted position: ${newQuantity} shares @ $${newCostBasis.toFixed(2)}`
    );
  }

  /**
   * Handle dividend
   */
  async handleDividend(position, details) {
    // Log dividend receipt
    await db.query(
      `INSERT INTO dividend_log (symbol, amount, ex_date, pay_date)
       VALUES ($1, $2, $3, $4)`,
      [position.symbol, details.amount, details.exDate, details.payDate]
    );
  }

  /**
   * Handle merger
   */
  async handleMerger(position, details) {
    await email.sendAlert(
      `Merger Alert: ${position.symbol}`,
      `${position.symbol} is being acquired by ${details.acquirer}\nManual review required`
    );
  }

  /**
   * Handle delisting
   */
  async handleDelisting(position, details) {
    await email.sendAlert(
      `Delisting Alert: ${position.symbol}`,
      `${position.symbol} is being delisted on ${details.date}\nClose position immediately`
    );
  }
}

export default new CorporateActionHandler();
