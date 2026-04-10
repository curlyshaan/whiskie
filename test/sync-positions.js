import tradier from './src/tradier.js';
import * as db from './src/db.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Sync positions from Tradier to database with correct cost_basis calculation
 */
async function syncPositions() {
  try {
    console.log('📊 Syncing positions from Tradier...\n');

    // Get positions from Tradier
    const tradierPositions = await tradier.getPositions();

    if (!tradierPositions || tradierPositions.length === 0) {
      console.log('✅ No positions to sync');
      return;
    }

    const positions = Array.isArray(tradierPositions) ? tradierPositions : [tradierPositions];

    for (const tp of positions) {
      if (!tp || !tp.symbol) continue;

      const tradierTotalCost = parseFloat(tp.cost_basis);
      const quantity = parseInt(tp.quantity);
      const currentPrice = parseFloat(tp.last);

      // CRITICAL: Guard against division by zero
      if (quantity === 0) {
        console.warn(`⚠️ Skipping ${tp.symbol}: quantity is zero`);
        continue;
      }

      // Calculate per-share cost basis (Tradier returns TOTAL cost)
      const perShareCost = tradierTotalCost / Math.abs(quantity);

      console.log(`📦 ${tp.symbol}:`);
      console.log(`   Quantity: ${quantity}`);
      console.log(`   Total Cost: $${tradierTotalCost.toFixed(2)}`);
      console.log(`   Per-Share Cost: $${perShareCost.toFixed(2)}`);
      console.log(`   Current Price: $${currentPrice.toFixed(2)}`);
      console.log(`   Gain/Loss: ${(((currentPrice - perShareCost) / perShareCost) * 100).toFixed(2)}%`);

      // Save to database
      await db.upsertPosition({
        symbol: tp.symbol,
        quantity: quantity,
        cost_basis: perShareCost, // Per-share cost
        current_price: currentPrice,
        sector: 'Unknown',
        stock_type: 'large-cap'
      });

      console.log(`   ✅ Synced to database\n`);
    }

    console.log('🎉 Position sync complete!');

  } catch (error) {
    console.error('❌ Error syncing positions:', error);
    throw error;
  }
}

syncPositions()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
