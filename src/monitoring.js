import * as db from './db.js';
import email from './email.js';

/**
 * Enhanced Error Logger
 * Tracks errors, patterns, and sends alerts for critical issues
 */

class ErrorLogger {
  constructor() {
    this.errorCounts = {};
    this.lastAlertTime = {};
    this.ALERT_COOLDOWN_MS = 3600000; // 1 hour between duplicate alerts
  }

  /**
   * Log error with context and pattern detection
   */
  async logError(error, context = {}) {
    const errorKey = `${context.module || 'unknown'}:${error.message}`;

    // Track error frequency
    if (!this.errorCounts[errorKey]) {
      this.errorCounts[errorKey] = 0;
    }
    this.errorCounts[errorKey]++;

    // Log to database
    try {
      await db.query(
        `INSERT INTO error_log (
          error_type, error_message, stack_trace, context,
          occurrence_count, created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          error.name || 'Error',
          error.message,
          error.stack || '',
          JSON.stringify(context),
          this.errorCounts[errorKey]
        ]
      );
    } catch (dbError) {
      console.error('Failed to log error to database:', dbError.message);
    }

    // Send alert for critical errors or repeated failures
    const shouldAlert = this.shouldSendAlert(errorKey, context);
    if (shouldAlert) {
      await this.sendErrorAlert(error, context);
      this.lastAlertTime[errorKey] = Date.now();
    }

    // Log to console
    console.error(`❌ Error in ${context.module || 'unknown'}:`, error.message);
    if (context.details) {
      console.error('   Details:', context.details);
    }
  }

  /**
   * Determine if error should trigger an alert
   */
  shouldSendAlert(errorKey, context) {
    // Always alert for critical errors
    if (context.severity === 'critical') {
      return true;
    }

    // Alert if error has occurred 3+ times
    if (this.errorCounts[errorKey] >= 3) {
      // Check cooldown
      const lastAlert = this.lastAlertTime[errorKey] || 0;
      const timeSinceLastAlert = Date.now() - lastAlert;
      return timeSinceLastAlert > this.ALERT_COOLDOWN_MS;
    }

    return false;
  }

  /**
   * Send error alert email
   */
  async sendErrorAlert(error, context) {
    try {
      await email.sendErrorAlert(error, context.module || 'Unknown module', {
        occurrenceCount: this.errorCounts[`${context.module}:${error.message}`],
        context: context.details
      });
    } catch (emailError) {
      console.error('Failed to send error alert:', emailError.message);
    }
  }

  /**
   * Get error statistics
   */
  getErrorStats() {
    const stats = {
      totalErrors: Object.values(this.errorCounts).reduce((sum, count) => sum + count, 0),
      uniqueErrors: Object.keys(this.errorCounts).length,
      topErrors: Object.entries(this.errorCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([key, count]) => ({ error: key, count }))
    };

    return stats;
  }
}

/**
 * Performance Monitor
 * Tracks operation durations and identifies bottlenecks
 */

class PerformanceMonitor {
  constructor() {
    this.metrics = {};
  }

  /**
   * Start timing an operation
   */
  startTimer(operationName) {
    return {
      operationName,
      startTime: Date.now()
    };
  }

  /**
   * End timing and record metric
   */
  async endTimer(timer, metadata = {}) {
    const duration = Date.now() - timer.startTime;

    // Track in memory
    if (!this.metrics[timer.operationName]) {
      this.metrics[timer.operationName] = {
        count: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0
      };
    }

    const metric = this.metrics[timer.operationName];
    metric.count++;
    metric.totalDuration += duration;
    metric.minDuration = Math.min(metric.minDuration, duration);
    metric.maxDuration = Math.max(metric.maxDuration, duration);

    // Log to database for historical tracking
    try {
      await db.query(
        `INSERT INTO performance_metrics (
          metric_name, metric_value, metadata, created_at
        ) VALUES ($1, $2, $3, NOW())`,
        [
          timer.operationName,
          duration,
          JSON.stringify(metadata)
        ]
      );
    } catch (error) {
      console.error('Failed to log performance metric:', error.message);
    }

    // Warn if operation is slow
    if (duration > 30000) { // 30 seconds
      console.warn(`⚠️ Slow operation: ${timer.operationName} took ${(duration / 1000).toFixed(1)}s`);
    }

    return duration;
  }

  /**
   * Get performance statistics
   */
  getStats() {
    const stats = {};

    for (const [operation, metric] of Object.entries(this.metrics)) {
      stats[operation] = {
        count: metric.count,
        avgDuration: (metric.totalDuration / metric.count).toFixed(0),
        minDuration: metric.minDuration,
        maxDuration: metric.maxDuration,
        totalDuration: metric.totalDuration
      };
    }

    return stats;
  }

  /**
   * Identify bottlenecks
   */
  getBottlenecks(threshold = 10000) {
    const bottlenecks = [];

    for (const [operation, metric] of Object.entries(this.metrics)) {
      const avgDuration = metric.totalDuration / metric.count;

      if (avgDuration > threshold) {
        bottlenecks.push({
          operation,
          avgDuration: avgDuration.toFixed(0),
          count: metric.count,
          totalTime: metric.totalDuration
        });
      }
    }

    return bottlenecks.sort((a, b) => b.avgDuration - a.avgDuration);
  }
}

export const errorLogger = new ErrorLogger();
export const performanceMonitor = new PerformanceMonitor();
