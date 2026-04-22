/**
 * Partial Fill Handler
 * Handles partial order fills with retry logic
 */

import tradier from './tradier.js';
import * as db from './db.js';
import email from './email.js';

class PartialFillHandler {
  constructor() {
    this.MAX_RETRIES = 3;
    this.RETRY_DELAY_MS = 5000; // 5 seconds
  }

  /**
   * Execute order with partial fill handling
   */
  async executeWithRetry(symbol, action, quantity, orderType, price) {
    let remainingQty = quantity;
    let totalFilled = 0;
    let attempts = 0;

    while (remainingQty > 0 && attempts < this.MAX_RETRIES) {
      attempts++;

      try {
        const order = await tradier.placeOrder(symbol, action, remainingQty, orderType, price);

        // Wait for fill
        await this.waitForFill(order.order.id);

        // Check fill status
        const orderStatus = await tradier.getOrderStatus(order.order.id);
        const filled = orderStatus.quantity - (orderStatus.remaining_quantity || 0);

        totalFilled += filled;
        remainingQty -= filled;

        if (remainingQty > 0) {
          console.log(`⚠️ Partial fill: ${filled}/${quantity} shares. Retrying remaining ${remainingQty}...`);
          await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_MS));
        }

      } catch (error) {
        console.error(`Attempt ${attempts} failed:`, error.message);
        if (attempts >= this.MAX_RETRIES) {
          throw error;
        }
      }
    }

    // If still not fully filled after retries, adjust position size
    if (remainingQty > 0) {
      console.log(`⚠️ Could not fill complete order after ${this.MAX_RETRIES} attempts`);
      console.log(`   Filled: ${totalFilled}/${quantity} shares`);

      await email.sendAlert(
        `Partial Fill: ${symbol}`,
        `Only filled ${totalFilled}/${quantity} shares after ${this.MAX_RETRIES} attempts.\nAdjusting position size proportionally.`
      );
    }

    return { totalFilled, remainingQty };
  }

  /**
   * Wait for order to fill (with timeout)
   */
  async waitForFill(orderId, timeoutMs = 30000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const order = await tradier.getOrderStatus(orderId);

      if (order.status === 'filled' || order.status === 'partially_filled') {
        return order;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Order fill timeout');
  }
}

export default new PartialFillHandler();
