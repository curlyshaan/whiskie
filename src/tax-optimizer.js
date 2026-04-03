import * as db from './db.js';
import tradier from './tradier.js';
import email from './email.js';

/**
 * Tax Optimization Module
 * Handles tax-aware sell decisions and long-term capital gains optimization
 */

/**
 * Check if we should wait for long-term status before selling
 * Returns true if tax savings > 2x risk
 */
export async function shouldWaitForLongTerm(lot, currentPrice) {
  try {
    // Only applies to long-term lots
    if (lot.lot_type !== 'long-term') {
      return { shouldWait: false, reason: 'Not a long-term lot' };
    }

    // Already achieved long-term status
    if (lot.days_to_long_term === 0 || lot.days_held >= 365) {
      return { shouldWait: false, reason: 'Already long-term status' };
    }

    // More than 45 days away - not worth considering yet
    if (lot.days_to_long_term > 45) {
      return { shouldWait: false, reason: 'More than 45 days to long-term' };
    }

    // Position must be profitable
    const gain = currentPrice - lot.cost_basis;
    const gainPercent = (gain / lot.cost_basis) * 100;

    if (gainPercent <= 0) {
      return { shouldWait: false, reason: 'Position not profitable' };
    }

    // Calculate tax savings
    const shortTermTaxRate = 0.37; // Assume 37% short-term rate
    const longTermTaxRate = 0.20;  // 20% long-term rate
    const taxDifference = shortTermTaxRate - longTermTaxRate; // 17%

    const totalGain = gain * lot.quantity;
    const shortTermTax = totalGain * shortTermTaxRate;
    const longTermTax = totalGain * longTermTaxRate;
    const taxSavings = shortTermTax - longTermTax;

    // Calculate risk (distance to stop-loss)
    const riskPerShare = currentPrice - lot.stop_loss;
    const totalRisk = riskPerShare * lot.quantity;
    const riskPercent = (riskPerShare / currentPrice) * 100;

    // Decision: Wait if tax savings > 2x risk
    const shouldWait = taxSavings > (totalRisk * 2);

    console.log(`\n💰 Tax Analysis for ${lot.symbol} (Lot ${lot.id}):`);
    console.log(`   Days to long-term: ${lot.days_to_long_term}`);
    console.log(`   Current gain: +${gainPercent.toFixed(2)}% ($${totalGain.toFixed(2)})`);
    console.log(`   Tax savings if wait: $${taxSavings.toFixed(2)}`);
    console.log(`   Risk to stop-loss: $${totalRisk.toFixed(2)} (${riskPercent.toFixed(2)}%)`);
    console.log(`   Decision: ${shouldWait ? '⏳ WAIT' : '❌ DO NOT WAIT'}`);

    if (shouldWait) {
      return {
        shouldWait: true,
        reason: `Tax savings ($${taxSavings.toFixed(2)}) > 2x risk ($${(totalRisk * 2).toFixed(2)})`,
        taxSavings,
        totalRisk,
        daysToWait: lot.days_to_long_term,
        recommendedAction: 'tighten_stop'
      };
    } else {
      return {
        shouldWait: false,
        reason: `Tax savings ($${taxSavings.toFixed(2)}) < 2x risk ($${(totalRisk * 2).toFixed(2)})`,
        taxSavings,
        totalRisk
      };
    }

  } catch (error) {
    console.error('Error in tax analysis:', error);
    return { shouldWait: false, reason: 'Error in calculation' };
  }
}

/**
 * Tighten stop-loss to reduce risk while waiting for long-term status
 */
export async function tightenStopForTaxHold(lot, currentPrice) {
  try {
    const riskAmount = currentPrice - lot.stop_loss;
    const newStopLoss = currentPrice - (riskAmount * 0.5); // Tighten by 50%

    console.log(`\n🔒 Tightening stop-loss for ${lot.symbol} (Lot ${lot.id}):`);
    console.log(`   Old stop: $${lot.stop_loss.toFixed(2)}`);
    console.log(`   New stop: $${newStopLoss.toFixed(2)}`);
    console.log(`   Risk reduced by 50%`);

    // Update lot in database
    await db.updatePositionLot(lot.id, {
      stop_loss: newStopLoss
    });

    // Cancel old OCO order
    if (lot.oco_order_id) {
      try {
        await tradier.cancelOrder(lot.oco_order_id);
        console.log(`✅ Canceled old OCO order: ${lot.oco_order_id}`);
      } catch (error) {
        console.error(`⚠️ Failed to cancel old OCO: ${error.message}`);
      }
    }

    // Place new OCO order with tighter stop
    try {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 sec
      const newOCO = await tradier.placeOCOOrder(lot.symbol, lot.quantity, newStopLoss, lot.take_profit);
      await db.updatePositionLot(lot.id, { oco_order_id: newOCO.id });
      console.log(`✅ New OCO order placed: ${newOCO.id}`);
    } catch (error) {
      console.error(`⚠️ Failed to place new OCO: ${error.message}`);
    }

    // Send email notification
    await email.sendEmail(
      `🔒 Tax Hold: Stop Tightened for ${lot.symbol}`,
      `
        <h2>Tax Optimization: Stop-Loss Tightened</h2>
        <p><strong>Symbol:</strong> ${lot.symbol}</p>
        <p><strong>Days to long-term:</strong> ${lot.days_to_long_term}</p>
        <p><strong>Old stop:</strong> $${lot.stop_loss.toFixed(2)}</p>
        <p><strong>New stop:</strong> $${newStopLoss.toFixed(2)}</p>
        <p><strong>Reason:</strong> Reducing risk while waiting for long-term capital gains status</p>
      `
    );

    return { success: true, newStopLoss };

  } catch (error) {
    console.error('Error tightening stop:', error);
    throw error;
  }
}

/**
 * Check all lots for tax optimization opportunities
 */
export async function runTaxOptimizationCheck() {
  try {
    console.log('\n💰 Running tax optimization check...');

    const lots = await db.getAllPositionLots();
    const taxHoldActions = [];

    for (const lot of lots) {
      if (lot.quantity === 0) continue;
      if (lot.lot_type !== 'long-term') continue;
      if (lot.days_to_long_term > 45 || lot.days_to_long_term === 0) continue;

      const currentPrice = lot.current_price;
      const analysis = await shouldWaitForLongTerm(lot, currentPrice);

      if (analysis.shouldWait && analysis.recommendedAction === 'tighten_stop') {
        taxHoldActions.push({ lot, analysis, currentPrice });
      }
    }

    if (taxHoldActions.length === 0) {
      console.log('✅ No tax optimization actions needed');
      return { actionsCount: 0, actions: [] };
    }

    console.log(`\n📊 Found ${taxHoldActions.length} tax optimization opportunities:`);
    for (const action of taxHoldActions) {
      console.log(`   • ${action.lot.symbol}: ${action.analysis.reason}`);
    }

    // Execute tightening actions
    const results = [];
    for (const action of taxHoldActions) {
      try {
        const result = await tightenStopForTaxHold(action.lot, action.currentPrice);
        results.push({ success: true, lot: action.lot, result });
      } catch (error) {
        console.error(`❌ Failed to tighten stop for ${action.lot.symbol}:`, error);
        results.push({ success: false, lot: action.lot, error: error.message });
      }

      // Wait 2 seconds between actions
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`\n✅ Tax optimization complete: ${successCount}/${taxHoldActions.length} successful`);

    return { actionsCount: successCount, actions: taxHoldActions };

  } catch (error) {
    console.error('Error running tax optimization check:', error);
    throw error;
  }
}

/**
 * Flag positions approaching long-term status (for reporting)
 */
export async function getPositionsApproachingLongTerm() {
  try {
    const lots = await db.getAllPositionLots();

    const approaching = lots.filter(lot =>
      lot.lot_type === 'long-term' &&
      lot.days_to_long_term > 0 &&
      lot.days_to_long_term <= 45 &&
      lot.quantity > 0
    );

    return approaching.map(lot => ({
      symbol: lot.symbol,
      lotId: lot.id,
      daysToLongTerm: lot.days_to_long_term,
      daysHeld: lot.days_held,
      quantity: lot.quantity,
      costBasis: lot.cost_basis,
      currentPrice: lot.current_price,
      gainPercent: ((lot.current_price - lot.cost_basis) / lot.cost_basis * 100).toFixed(2)
    }));

  } catch (error) {
    console.error('Error getting positions approaching long-term:', error);
    return [];
  }
}

export default {
  shouldWaitForLongTerm,
  tightenStopForTaxHold,
  runTaxOptimizationCheck,
  getPositionsApproachingLongTerm
};
