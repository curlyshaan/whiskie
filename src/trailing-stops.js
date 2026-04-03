import * as db from './db.js';
import tradier from './tradier.js';
import email from './email.js';

/**
 * Trailing Stop Module
 * Activates and manages trailing stops for winning positions
 */

/**
 * Check if a lot should activate trailing stop
 */
export function shouldActivateTrailingStop(lot, currentPrice) {
  // Already active
  if (lot.trailing_stop_active) {
    return { shouldActivate: false, reason: 'Already active' };
  }

  const costBasis = lot.cost_basis;
  const gainPercent = ((currentPrice - costBasis) / costBasis) * 100;

  // Long-term: Activate at +50% gain
  if (lot.lot_type === 'long-term' && gainPercent >= 50) {
    return {
      shouldActivate: true,
      reason: `Long-term position at +${gainPercent.toFixed(2)}% (threshold: +50%)`,
      trailPercent: 12, // 12% trailing stop for long-term
      newStopLoss: currentPrice * 0.88 // 12% below current
    };
  }

  // Swing: Activate at +20% gain
  if (lot.lot_type === 'swing' && gainPercent >= 20) {
    return {
      shouldActivate: true,
      reason: `Swing position at +${gainPercent.toFixed(2)}% (threshold: +20%)`,
      trailPercent: 10, // 10% trailing stop for swing
      newStopLoss: currentPrice * 0.90 // 10% below current
    };
  }

  return { shouldActivate: false, reason: 'Gain threshold not met' };
}

/**
 * Activate trailing stop for a lot
 */
export async function activateTrailingStop(lot, currentPrice) {
  try {
    const analysis = shouldActivateTrailingStop(lot, currentPrice);

    if (!analysis.shouldActivate) {
      return { success: false, reason: analysis.reason };
    }

    console.log(`\n📈 Activating trailing stop for ${lot.symbol} (Lot ${lot.id}):`);
    console.log(`   Reason: ${analysis.reason}`);
    console.log(`   Trail: ${analysis.trailPercent}%`);
    console.log(`   New stop: $${analysis.newStopLoss.toFixed(2)}`);

    // Update lot in database
    await db.updatePositionLot(lot.id, {
      trailing_stop_active: true,
      stop_loss: analysis.newStopLoss,
      take_profit: null // Remove take-profit, let it run
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

    // Place new stop order (no take-profit, just trailing stop)
    // Note: Tradier may not support true trailing stops via API
    // We'll use a regular stop order and update it manually during analysis
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const stopOrder = await tradier.placeStopOrder(lot.symbol, 'sell', lot.quantity, analysis.newStopLoss);
      await db.updatePositionLot(lot.id, { oco_order_id: stopOrder.id });
      console.log(`✅ Trailing stop order placed: ${stopOrder.id}`);
    } catch (error) {
      console.error(`⚠️ Failed to place trailing stop: ${error.message}`);
    }

    // Send email notification
    await email.sendEmail(
      `📈 Trailing Stop Activated: ${lot.symbol}`,
      `
        <h2>Trailing Stop Activated</h2>
        <p><strong>Symbol:</strong> ${lot.symbol}</p>
        <p><strong>Lot Type:</strong> ${lot.lot_type}</p>
        <p><strong>Entry:</strong> $${lot.cost_basis.toFixed(2)}</p>
        <p><strong>Current:</strong> $${currentPrice.toFixed(2)}</p>
        <p><strong>Gain:</strong> +${((currentPrice - lot.cost_basis) / lot.cost_basis * 100).toFixed(2)}%</p>
        <p><strong>Trail Percent:</strong> ${analysis.trailPercent}%</p>
        <p><strong>Initial Stop:</strong> $${analysis.newStopLoss.toFixed(2)}</p>
        <p><em>Stop will be updated automatically as price rises.</em></p>
      `
    );

    return { success: true, analysis };

  } catch (error) {
    console.error('Error activating trailing stop:', error);
    throw error;
  }
}

/**
 * Update trailing stops based on current prices
 */
export async function updateTrailingStops() {
  try {
    console.log('\n📊 Updating trailing stops...');

    const lots = await db.getAllPositionLots();
    const activeTrailingStops = lots.filter(lot =>
      lot.trailing_stop_active &&
      lot.quantity > 0
    );

    if (activeTrailingStops.length === 0) {
      console.log('✅ No active trailing stops to update');
      return { updated: 0 };
    }

    console.log(`Found ${activeTrailingStops.length} active trailing stops`);

    let updatedCount = 0;

    for (const lot of activeTrailingStops) {
      const currentPrice = lot.current_price;
      const currentStop = lot.stop_loss;

      // Determine trail percent
      const trailPercent = lot.lot_type === 'long-term' ? 0.12 : 0.10;
      const newStop = currentPrice * (1 - trailPercent);

      // Only update if new stop is higher than current stop
      if (newStop > currentStop) {
        console.log(`   ${lot.symbol}: Raising stop from $${currentStop.toFixed(2)} to $${newStop.toFixed(2)}`);

        // Update database
        await db.updatePositionLot(lot.id, { stop_loss: newStop });

        // Cancel old stop order
        if (lot.oco_order_id) {
          try {
            await tradier.cancelOrder(lot.oco_order_id);
          } catch (error) {
            console.error(`⚠️ Failed to cancel old stop: ${error.message}`);
          }
        }

        // Place new stop order
        try {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const stopOrder = await tradier.placeStopOrder(lot.symbol, 'sell', lot.quantity, newStop);
          await db.updatePositionLot(lot.id, { oco_order_id: stopOrder.id });
          console.log(`   ✅ New stop order placed: ${stopOrder.id}`);
        } catch (error) {
          console.error(`   ⚠️ Failed to place new stop: ${error.message}`);
        }

        updatedCount++;

        // Wait 2 seconds between updates
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log(`✅ Updated ${updatedCount} trailing stops`);
    return { updated: updatedCount };

  } catch (error) {
    console.error('Error updating trailing stops:', error);
    throw error;
  }
}

/**
 * Check and activate trailing stops for eligible positions
 */
export async function runTrailingStopCheck() {
  try {
    console.log('\n📈 Checking for trailing stop activation...');

    const lots = await db.getAllPositionLots();
    const activationActions = [];

    for (const lot of lots) {
      if (lot.quantity === 0) continue;
      if (lot.trailing_stop_active) continue; // Already active

      const currentPrice = lot.current_price;
      const analysis = shouldActivateTrailingStop(lot, currentPrice);

      if (analysis.shouldActivate) {
        activationActions.push({ lot, currentPrice, analysis });
      }
    }

    if (activationActions.length === 0) {
      console.log('✅ No trailing stops to activate');
      return { activated: 0 };
    }

    console.log(`\n📊 Found ${activationActions.length} positions ready for trailing stops:`);
    for (const action of activationActions) {
      console.log(`   • ${action.lot.symbol}: ${action.analysis.reason}`);
    }

    // Execute activations
    let activatedCount = 0;
    for (const action of activationActions) {
      try {
        const result = await activateTrailingStop(action.lot, action.currentPrice);
        if (result.success) {
          activatedCount++;
        }
      } catch (error) {
        console.error(`❌ Failed to activate trailing stop for ${action.lot.symbol}:`, error);
      }

      // Wait 2 seconds between activations
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`\n✅ Activated ${activatedCount} trailing stops`);
    return { activated: activatedCount };

  } catch (error) {
    console.error('Error running trailing stop check:', error);
    throw error;
  }
}

export default {
  shouldActivateTrailingStop,
  activateTrailingStop,
  updateTrailingStops,
  runTrailingStopCheck
};
