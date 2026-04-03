import * as db from './db.js';
import tradier from './tradier.js';
import email from './email.js';

/**
 * Position Trimming Logic
 * Handles graduated trimming for long-term and swing positions
 */

/**
 * Check if a lot should be trimmed based on current price
 */
export async function checkTrimOpportunities() {
  try {
    const lots = await db.getAllPositionLots();
    const trimActions = [];

    for (const lot of lots) {
      if (lot.quantity === 0) continue;

      const currentPrice = lot.current_price;
      const costBasis = lot.cost_basis;
      const gainPercent = ((currentPrice - costBasis) / costBasis) * 100;

      let shouldTrim = false;
      let trimQuantity = 0;
      let newStopLoss = lot.stop_loss;
      let newTakeProfit = lot.take_profit;
      let reason = '';

      if (lot.lot_type === 'long-term') {
        // Long-term graduated trimming
        if (lot.trim_level === 0 && gainPercent >= 25) {
          // Trim 1: +25-30% - Sell 25%
          shouldTrim = true;
          trimQuantity = Math.floor(lot.quantity * 0.25);
          newStopLoss = costBasis * 1.07; // Breakeven + 7%
          newTakeProfit = costBasis * 1.50; // +50%
          reason = 'Long-term Trim 1: +25% gain reached';
        } else if (lot.trim_level === 1 && gainPercent >= 50) {
          // Trim 2: +50-60% - Sell 25%
          shouldTrim = true;
          trimQuantity = Math.floor(lot.quantity * 0.25);
          newStopLoss = costBasis * 1.33; // Entry + 33%
          newTakeProfit = costBasis * 1.80; // +80%
          reason = 'Long-term Trim 2: +50% gain reached';
        } else if (lot.trim_level === 2 && gainPercent >= 80) {
          // Trim 3: +80-100% - Sell 25%
          shouldTrim = true;
          trimQuantity = Math.floor(lot.quantity * 0.25);
          newStopLoss = costBasis * 1.50; // Entry + 50%
          newTakeProfit = null; // Let it run with trailing stop
          reason = 'Long-term Trim 3: +80% gain reached';
        }
      } else if (lot.lot_type === 'swing') {
        // Swing 2-step trimming
        if (lot.trim_level === 0 && gainPercent >= 15) {
          // Trim 1: +15% - Sell 50%
          shouldTrim = true;
          trimQuantity = Math.floor(lot.quantity * 0.50);
          newStopLoss = costBasis; // Breakeven
          newTakeProfit = costBasis * 1.25; // +25%
          reason = 'Swing Trim 1: +15% gain reached';
        } else if (lot.trim_level === 1 && gainPercent >= 25) {
          // Trim 2: +25% - Sell remaining 50%
          shouldTrim = true;
          trimQuantity = lot.quantity; // Sell all remaining
          newStopLoss = null;
          newTakeProfit = null;
          reason = 'Swing Trim 2: +25% gain reached - closing position';
        }
      }

      if (shouldTrim && trimQuantity > 0) {
        trimActions.push({
          lot,
          trimQuantity,
          currentPrice,
          gainPercent,
          newStopLoss,
          newTakeProfit,
          reason
        });
      }
    }

    return trimActions;
  } catch (error) {
    console.error('Error checking trim opportunities:', error);
    throw error;
  }
}

/**
 * Execute a trim action
 */
export async function executeTrim(trimAction) {
  try {
    const { lot, trimQuantity, currentPrice, gainPercent, newStopLoss, newTakeProfit, reason } = trimAction;

    console.log(`\n🔄 Executing trim for ${lot.symbol}:`);
    console.log(`   Lot ID: ${lot.id}`);
    console.log(`   Type: ${lot.lot_type}`);
    console.log(`   Trim: ${trimQuantity} shares @ $${currentPrice}`);
    console.log(`   Gain: +${gainPercent.toFixed(2)}%`);
    console.log(`   Reason: ${reason}`);

    // Place sell order
    const order = await tradier.placeOrder(lot.symbol, 'sell', trimQuantity, 'market');

    if (order.status === 'ok' || order.status === 'filled') {
      console.log(`✅ Trim order placed: ${order.id}`);

      // Update lot in database
      const newQuantity = lot.quantity - trimQuantity;
      const newTrimLevel = lot.trim_level + 1;

      await db.updatePositionLot(lot.id, {
        quantity: newQuantity,
        trim_level: newTrimLevel,
        stop_loss: newStopLoss,
        take_profit: newTakeProfit
      });

      // Cancel old OCO order if exists
      if (lot.oco_order_id) {
        try {
          await tradier.cancelOrder(lot.oco_order_id);
          console.log(`✅ Canceled old OCO order: ${lot.oco_order_id}`);
        } catch (error) {
          console.error(`⚠️ Failed to cancel old OCO: ${error.message}`);
        }
      }

      // Place new OCO order if quantity remains
      if (newQuantity > 0 && newStopLoss && newTakeProfit) {
        try {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 sec
          const newOCO = await tradier.placeOCOOrder(lot.symbol, newQuantity, newStopLoss, newTakeProfit);
          await db.updatePositionLot(lot.id, { oco_order_id: newOCO.id });
          console.log(`✅ New OCO order placed: ${newOCO.id}`);
        } catch (error) {
          console.error(`⚠️ Failed to place new OCO: ${error.message}`);
        }
      }

      // Update aggregate position
      await updateAggregatePosition(lot.symbol);

      // Log trade
      await db.logTrade({
        symbol: lot.symbol,
        action: 'sell',
        quantity: trimQuantity,
        price: currentPrice,
        orderId: order.id,
        status: 'filled',
        reasoning: reason
      });

      // Send email notification
      await email.sendTradeConfirmation({
        action: 'sell',
        symbol: lot.symbol,
        quantity: trimQuantity,
        price: currentPrice,
        stopLoss: newStopLoss,
        takeProfit: newTakeProfit,
        reasoning: reason
      });

      console.log(`✅ Trim executed successfully for ${lot.symbol}`);
      return { success: true, order };
    } else {
      console.error(`❌ Trim order failed: ${order.status}`);
      return { success: false, error: order.status };
    }
  } catch (error) {
    console.error('Error executing trim:', error);
    await email.sendErrorAlert(error, `Trim execution failed for ${trimAction.lot.symbol}`);
    throw error;
  }
}

/**
 * Update aggregate position after trim
 */
async function updateAggregatePosition(symbol) {
  try {
    const lots = await db.getPositionLots(symbol);

    if (lots.length === 0) {
      // No lots remaining, delete position
      await db.deletePosition(symbol);
      return;
    }

    // Calculate aggregate values
    const totalQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
    const totalCost = lots.reduce((sum, lot) => sum + (lot.quantity * lot.cost_basis), 0);
    const avgCostBasis = totalCost / totalQuantity;
    const longTermLots = lots.filter(l => l.lot_type === 'long-term').length;
    const swingLots = lots.filter(l => l.lot_type === 'swing').length;

    let investmentType = 'long-term';
    if (longTermLots > 0 && swingLots > 0) {
      investmentType = 'hybrid';
    } else if (swingLots > 0) {
      investmentType = 'swing';
    }

    // Update aggregate position
    await db.upsertPosition({
      symbol,
      quantity: totalQuantity,
      cost_basis: avgCostBasis,
      current_price: lots[0].current_price,
      investment_type: investmentType,
      total_lots: lots.length,
      long_term_lots: longTermLots,
      swing_lots: swingLots
    });
  } catch (error) {
    console.error(`Error updating aggregate position for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Check and execute all trim opportunities
 */
export async function runTrimCheck() {
  try {
    console.log('\n🔍 Checking for trim opportunities...');

    const trimActions = await checkTrimOpportunities();

    if (trimActions.length === 0) {
      console.log('✅ No trim opportunities found');
      return { trimmed: 0, actions: [] };
    }

    console.log(`\n📊 Found ${trimActions.length} trim opportunities:`);
    trimActions.forEach(action => {
      console.log(`   • ${action.lot.symbol}: ${action.reason}`);
    });

    const results = [];
    for (const action of trimActions) {
      const result = await executeTrim(action);
      results.push(result);

      // Wait 2 seconds between trims
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`\n✅ Trim check complete: ${successCount}/${trimActions.length} successful`);

    return { trimmed: successCount, actions: trimActions };
  } catch (error) {
    console.error('Error running trim check:', error);
    throw error;
  }
}

export default {
  checkTrimOpportunities,
  executeTrim,
  runTrimCheck
};
