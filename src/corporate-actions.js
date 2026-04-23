/**
 * Corporate Action Handler
 * Monitors and handles stock splits, dividends, mergers, delistings, spin-offs, rights offerings, and special cash distributions.
 */

import * as db from './db.js';
import email from './email.js';
import fmp from './fmp.js';

class CorporateActionHandler {
  async checkCorporateActions() {
    try {
      const positions = await db.getPositions();
      const actions = [];

      for (const position of positions) {
        const positionActions = await this.getCorporateActions(position.symbol);
        positionActions.forEach(action => actions.push({ position, action }));
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

  async getCorporateActions(symbol) {
    const now = new Date();
    const recentCutoff = new Date(now);
    recentCutoff.setDate(recentCutoff.getDate() - 10);

    const [splits, dividends, profile] = await Promise.all([
      fmp.getStockSplits(symbol).catch(() => []),
      fmp.getDividends(symbol).catch(() => []),
      fmp.getProfile(symbol).catch(() => null)
    ]);

    const actions = [];
    const recentSplit = (splits || []).find(split => {
      const splitDate = new Date(split.date || split.paymentDate || split.recordDate || 0);
      return !Number.isNaN(splitDate.getTime()) && splitDate >= recentCutoff && splitDate <= now;
    });

    if (recentSplit) {
      const numerator = Number(recentSplit.numerator || recentSplit.ratioNumerator || 0);
      const denominator = Number(recentSplit.denominator || recentSplit.ratioDenominator || 0);
      const ratio = numerator > 0 && denominator > 0 ? numerator / denominator : Number(recentSplit.splitFactor || 0);
      if (Number.isFinite(ratio) && ratio > 0 && Math.abs(ratio - 1) > 0.0001) {
        actions.push({
          type: 'split',
          details: {
            ratio,
            date: recentSplit.date || recentSplit.paymentDate || recentSplit.recordDate || null
          }
        });
      }
    }

    const recentDividends = (dividends || []).filter(dividend => {
      const exDate = new Date(dividend.date || dividend.exDate || 0);
      return !Number.isNaN(exDate.getTime()) && exDate >= recentCutoff && exDate <= now && Number(dividend.dividend || dividend.amount || 0) > 0;
    });

    for (const dividend of recentDividends) {
      const amount = Number(dividend.dividend || dividend.amount || 0);
      actions.push({
        type: amount >= 1 ? 'special_dividend' : 'dividend',
        details: {
          amount,
          exDate: dividend.date || dividend.exDate || null,
          payDate: dividend.paymentDate || dividend.payDate || null,
          label: amount >= 1 ? 'special dividend' : 'dividend'
        }
      });
    }

    if (profile) {
      const exchangeShortName = String(profile.exchangeShortName || '').toUpperCase();
      const isActivelyTrading = !['OTC', 'PINK'].includes(exchangeShortName) && String(profile.isActivelyTrading || 'true') !== 'false';
      if (!isActivelyTrading) {
        actions.push({
          type: 'delisting',
          details: {
            date: now.toISOString().split('T')[0],
            exchange: profile.exchangeShortName || null,
            reason: 'Profile indicates inactive or non-primary listing status'
          }
        });
      }
    }

    return this.deduplicateActions(actions);
  }

  deduplicateActions(actions = []) {
    const seen = new Set();
    return (actions || []).filter(action => {
      const key = `${action.type}:${JSON.stringify(action.details || {})}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async handleActions(actions) {
    for (const { position, action } of actions) {
      switch (action.type) {
        case 'split':
          await this.handleSplit(position, action.details);
          break;
        case 'dividend':
        case 'special_dividend':
          await this.handleDividend(position, action.details, action.type === 'special_dividend');
          break;
        case 'spin_off':
          await this.handleSpinOff(position, action.details);
          break;
        case 'rights_offering':
          await this.handleRightsOffering(position, action.details);
          break;
        case 'merger':
          await this.handleMerger(position, action.details);
          break;
        case 'delisting':
          await this.handleDelisting(position, action.details);
          break;
        default:
          break;
      }
    }
  }

  async handleSplit(position, details) {
    const ratio = Number(details.ratio || 0);
    if (!(ratio > 0)) return;
    const newQuantity = Number(position.quantity || 0) * ratio;
    const newCostBasis = Number(position.cost_basis || 0) / ratio;

    await db.query(
      `UPDATE positions
       SET quantity = $1, cost_basis = $2
       WHERE symbol = $3`,
      [newQuantity, newCostBasis, position.symbol]
    );

    await db.query(
      `UPDATE position_lots
       SET quantity = ROUND(quantity * $1),
           remaining_quantity = ROUND(COALESCE(remaining_quantity, quantity) * $1),
           cost_basis = cost_basis / $1,
           last_reviewed = CURRENT_TIMESTAMP
       WHERE symbol = $2`,
      [ratio, position.symbol]
    );

    await email.sendAlert(
      `Stock Split: ${position.symbol}`,
      `${position.symbol} split ${ratio}:1
Adjusted position: ${newQuantity} shares @ $${newCostBasis.toFixed(2)}`
    );
  }

  async handleDividend(position, details, isSpecialDividend = false) {
    await db.query(
      `INSERT INTO dividend_log (symbol, amount, ex_date, pay_date)
       VALUES ($1, $2, $3, $4)`,
      [position.symbol, details.amount, details.exDate, details.payDate]
    );

    if (isSpecialDividend) {
      await email.sendAlert(
        `Special Dividend: ${position.symbol}`,
        `${position.symbol} declared a special dividend of $${Number(details.amount || 0).toFixed(2)} per share. Review cost basis and tax impact manually.`
      );
    }
  }

  async handleSpinOff(position, details) {
    await email.sendAlert(
      `Spin-off Review Needed: ${position.symbol}`,
      `${position.symbol} may have a spin-off event (${details.childSymbol || 'new security'}). Manual review required to add the new shares and reallocate basis.`
    );
  }

  async handleRightsOffering(position, details) {
    await email.sendAlert(
      `Rights Offering Review: ${position.symbol}`,
      `${position.symbol} has a rights offering. Terms: ${details.terms || 'review filing manually'}. Manual action required before expiry.`
    );
  }

  async handleMerger(position, details) {
    await email.sendAlert(
      `Merger Alert: ${position.symbol}`,
      `${position.symbol} is being acquired by ${details.acquirer || 'another company'}
Manual review required`
    );
  }

  async handleDelisting(position, details) {
    await email.sendAlert(
      `Delisting Alert: ${position.symbol}`,
      `${position.symbol} may be delisting or inactive on ${details.date || 'the latest review date'} (${details.exchange || 'unknown exchange'}). Close or manually reconcile the position.`
    );
  }
}

export default new CorporateActionHandler();
