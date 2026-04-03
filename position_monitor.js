/**
 * Position Monitor - Checks stop-loss and take-profit levels
 * Should be added to src/index.js
 */

/**
 * Monitor all positions for stop-loss and take-profit triggers
 */
async monitorPositions() {
  try {
    console.log('\n🔍 Monitoring positions for stop-loss/take-profit triggers...');

    const portfolio = await analysisEngine.getPortfolioState();

    if (portfolio.positions.length === 0) {
      console.log('   No positions to monitor');
      return;
    }

    // Fetch current prices for all positions
    const symbols = portfolio.positions.map(p => p.symbol);
    const quotes = await tradier.getQuotes(symbols.join(','));
    const quoteArray = Array.isArray(quotes) ? quotes : [quotes];

    const priceMap = {};
    quoteArray.forEach(q => {
      if (q && q.symbol) {
        priceMap[q.symbol] = q.last;
      }
    });

    // Check each position
    for (const position of portfolio.positions) {
      const currentPrice = priceMap[position.symbol];

      if (!currentPrice) {
        console.log(`   ⚠️ ${position.symbol}: No price data`);
        continue;
      }

      const gainLoss = ((currentPrice - position.cost_basis) / position.cost_basis) * 100;

      // Check stop-loss
      if (position.stop_loss && currentPrice <= position.stop_loss) {
        console.log(`   🚨 STOP-LOSS TRIGGERED: ${position.symbol}`);
        console.log(`      Entry: $${position.cost_basis}, Current: $${currentPrice}, Stop: $${position.stop_loss}`);
        console.log(`      Loss: ${gainLoss.toFixed(2)}%`);

        // Execute sell order
        await this.executeTrade(position.symbol, 'sell', position.quantity);

        // Send alert email
        await email.sendStopLossAlert({
          symbol: position.symbol,
          entryPrice: position.cost_basis,
          currentPrice: currentPrice,
          stopLoss: position.stop_loss,
          quantity: position.quantity,
          loss: gainLoss
        });

        continue;
      }

      // Check take-profit
      if (position.take_profit && currentPrice >= position.take_profit) {
        console.log(`   🎯 TAKE-PROFIT TRIGGERED: ${position.symbol}`);
        console.log(`      Entry: $${position.cost_basis}, Current: $${currentPrice}, Target: $${position.take_profit}`);
        console.log(`      Gain: ${gainLoss.toFixed(2)}%`);

        // Execute sell order
        await this.executeTrade(position.symbol, 'sell', position.quantity);

        // Send alert email
        await email.sendTakeProfitAlert({
          symbol: position.symbol,
          entryPrice: position.cost_basis,
          currentPrice: currentPrice,
          takeProfit: position.take_profit,
          quantity: position.quantity,
          gain: gainLoss
        });

        continue;
      }

      // Log status
      const stopLossDistance = position.stop_loss
        ? ((currentPrice - position.stop_loss) / currentPrice * 100).toFixed(1)
        : 'N/A';
      const takeProfitDistance = position.take_profit
        ? ((position.take_profit - currentPrice) / currentPrice * 100).toFixed(1)
        : 'N/A';

      console.log(`   ✅ ${position.symbol}: $${currentPrice} (${gainLoss >= 0 ? '+' : ''}${gainLoss.toFixed(2)}%)`);
      console.log(`      Stop-loss: ${stopLossDistance}% away, Take-profit: ${takeProfitDistance}% away`);
    }

    console.log('✅ Position monitoring complete\n');

  } catch (error) {
    console.error('❌ Error monitoring positions:', error.message);
    await email.sendErrorAlert(error, 'Position monitoring');
  }
}

/**
 * Schedule position monitoring every 15 minutes during market hours
 * Add this to the start() method in WhiskieBot class
 */
schedulePositionMonitoring() {
  // Monitor every 15 minutes from 9:30 AM to 4:00 PM ET (market hours)
  cron.schedule('*/15 9-15 * * 1-5', async () => {
    await this.monitorPositions();
  }, {
    timezone: 'America/New_York'
  });

  // Also monitor at 4:00 PM (market close)
  cron.schedule('0 16 * * 1-5', async () => {
    console.log('⏰ Final position check at market close');
    await this.monitorPositions();
  }, {
    timezone: 'America/New_York'
  });

  console.log('✅ Position monitoring scheduled (every 15 minutes during market hours)');
}
