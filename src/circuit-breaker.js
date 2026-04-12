/**
 * Circuit Breaker System
 * Prevents runaway trading with hard limits
 *
 * RULES:
 * - Max 5 trades per day
 * - Max 5% weekly loss
 * - Pause trading if triggered
 */

import * as db from './db.js';
import email from './email.js';

class CircuitBreaker {
  constructor() {
    this.MAX_DAILY_TRADES = 5;
    this.MAX_WEEKLY_LOSS_PCT = 0.05;
    this.isTripped = false;
    this.tripReason = null;
  }

  /**
   * Check if circuit breaker is tripped
   */
  async checkCircuitBreaker(portfolioValue) {
    // Check daily trade limit
    const dailyTrades = await this.getDailyTradeCount();
    if (dailyTrades >= this.MAX_DAILY_TRADES) {
      this.trip(`Daily trade limit reached (${dailyTrades}/${this.MAX_DAILY_TRADES})`);
      return { tripped: true, reason: this.tripReason };
    }

    // Check weekly loss limit
    const weeklyLoss = await this.getWeeklyLoss(portfolioValue);
    if (weeklyLoss >= this.MAX_WEEKLY_LOSS_PCT) {
      this.trip(`Weekly loss limit reached (${(weeklyLoss * 100).toFixed(1)}%)`);
      return { tripped: true, reason: this.tripReason };
    }

    return { tripped: false };
  }

  /**
   * Trip the circuit breaker
   */
  async trip(reason) {
    if (this.isTripped) return;

    this.isTripped = true;
    this.tripReason = reason;

    console.log(`🚨 CIRCUIT BREAKER TRIPPED: ${reason}`);

    // Log to database
    await db.query(
      `INSERT INTO circuit_breaker_events (reason, tripped_at)
       VALUES ($1, NOW())`,
      [reason]
    );

    // Send alert email
    await email.sendAlert(
      'Circuit Breaker Tripped',
      `Trading has been paused: ${reason}\n\nNo new trades will be executed until manually reset.`
    );
  }

  /**
   * Reset circuit breaker (manual only)
   */
  async reset() {
    this.isTripped = false;
    this.tripReason = null;
    console.log('✅ Circuit breaker reset');

    await db.query(
      `UPDATE circuit_breaker_events
       SET reset_at = NOW()
       WHERE reset_at IS NULL`
    );
  }

  /**
   * Get daily trade count
   */
  async getDailyTradeCount() {
    const result = await db.query(
      `SELECT COUNT(*) as count
       FROM trades
       WHERE DATE(executed_at) = CURRENT_DATE`
    );
    return parseInt(result.rows[0]?.count || 0);
  }

  /**
   * Get weekly loss percentage
   */
  async getWeeklyLoss(currentPortfolioValue) {
    try {
      // Get portfolio value from 7 days ago
      const result = await db.query(
        `SELECT total_value
         FROM portfolio_snapshots
         WHERE snapshot_date >= NOW() - INTERVAL '7 days'
         ORDER BY snapshot_date ASC
         LIMIT 1`
      );

      if (result.rows.length === 0) return 0;

      const startValue = parseFloat(result.rows[0].total_value);
      const loss = (startValue - currentPortfolioValue) / startValue;

      return Math.max(0, loss); // Only count losses, not gains
    } catch (error) {
      console.error('Error calculating weekly loss:', error);
      return 0;
    }
  }

  /**
   * Get circuit breaker status
   */
  getStatus() {
    return {
      isTripped: this.isTripped,
      reason: this.tripReason,
      maxDailyTrades: this.MAX_DAILY_TRADES,
      maxWeeklyLoss: `${(this.MAX_WEEKLY_LOSS_PCT * 100).toFixed(0)}%`
    };
  }
}

export default new CircuitBreaker();
