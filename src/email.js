import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Email Alert System
 * Sends notifications for trades, alerts, and reports
 */
class EmailAlerts {
  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    this.alertEmail = process.env.ALERT_EMAIL;
  }

  /**
   * Send trade recommendation email
   */
  async sendTradeRecommendation(trade) {
    const subject = `🤖 Whiskie Trade Recommendation: ${trade.action.toUpperCase()} ${trade.symbol}`;

    const html = `
      <h2>Trade Recommendation</h2>
      <p><strong>Action:</strong> ${trade.action.toUpperCase()}</p>
      <p><strong>Symbol:</strong> ${trade.symbol}</p>
      <p><strong>Quantity:</strong> ${trade.quantity} shares</p>
      <p><strong>Price:</strong> $${trade.price}</p>
      <p><strong>Total Value:</strong> $${(trade.quantity * trade.price).toFixed(2)}</p>
      <p><strong>Position Size:</strong> ${trade.positionSize}% of portfolio</p>

      <h3>AI Reasoning:</h3>
      <pre>${trade.reasoning}</pre>

      <h3>Risk Assessment:</h3>
      <p><strong>Stop-Loss:</strong> $${trade.stopLoss}</p>
      <p><strong>Take-Profit Target:</strong> $${trade.takeProfit}</p>

      <p><em>Reply to this email with APPROVE or REJECT</em></p>
    `;

    return await this.sendEmail(subject, html);
  }

  /**
   * Send alert for position down 20%+
   */
  async sendPositionAlert(position, currentPrice, percentDown) {
    const subject = `⚠️ Whiskie Alert: ${position.symbol} Down ${percentDown.toFixed(1)}%`;

    const html = `
      <h2>Position Alert</h2>
      <p><strong>Symbol:</strong> ${position.symbol}</p>
      <p><strong>Entry Price:</strong> $${position.cost_basis}</p>
      <p><strong>Current Price:</strong> $${currentPrice}</p>
      <p><strong>Loss:</strong> ${percentDown.toFixed(2)}%</p>
      <p><strong>Shares:</strong> ${position.quantity}</p>
      <p><strong>Total Loss:</strong> $${((currentPrice - position.cost_basis) * position.quantity).toFixed(2)}</p>

      <h3>AI Analysis:</h3>
      <p><em>Analyzing position... Check dashboard for recommendation.</em></p>

      <p><strong>Action Required:</strong> Review this position and decide whether to hold or sell.</p>
    `;

    return await this.sendEmail(subject, html);
  }

  /**
   * Send daily portfolio summary
   */
  async sendDailySummary(summary) {
    const subject = `📊 Whiskie Daily Summary - ${new Date().toLocaleDateString()}`;

    const changeEmoji = summary.dailyChange >= 0 ? '📈' : '📉';
    const changeColor = summary.dailyChange >= 0 ? 'green' : 'red';

    const html = `
      <h2>Daily Portfolio Summary</h2>

      <h3>Portfolio Value</h3>
      <p><strong>Total Value:</strong> $${summary.totalValue.toLocaleString()}</p>
      <p><strong>Daily Change:</strong> <span style="color: ${changeColor}">${changeEmoji} ${summary.dailyChange >= 0 ? '+' : ''}${summary.dailyChange.toFixed(2)}%</span></p>
      <p><strong>Total Return:</strong> ${summary.totalReturn >= 0 ? '+' : ''}${summary.totalReturn.toFixed(2)}%</p>

      <h3>Top Performers Today</h3>
      <ul>
        ${summary.topPerformers.map(p => `<li>${p.symbol}: +${p.change.toFixed(2)}%</li>`).join('')}
      </ul>

      <h3>Positions Needing Attention</h3>
      ${summary.alerts.length > 0
        ? `<ul>${summary.alerts.map(a => `<li>${a}</li>`).join('')}</ul>`
        : '<p>No alerts today ✅</p>'
      }

      <h3>AI Recommendations</h3>
      <p>${summary.aiRecommendation}</p>

      <p><em>View full dashboard for detailed analysis.</em></p>
    `;

    return await this.sendEmail(subject, html);
  }

  /**
   * Send weekly performance report
   */
  async sendWeeklyReport(report) {
    const subject = `📈 Whiskie Weekly Report - Week of ${report.weekStart}`;

    const html = `
      <h2>Weekly Performance Report</h2>

      <h3>Performance</h3>
      <p><strong>Weekly Return:</strong> ${report.weeklyReturn >= 0 ? '+' : ''}${report.weeklyReturn.toFixed(2)}%</p>
      <p><strong>S&P 500 Return:</strong> ${report.sp500Return >= 0 ? '+' : ''}${report.sp500Return.toFixed(2)}%</p>
      <p><strong>Outperformance:</strong> ${(report.weeklyReturn - report.sp500Return).toFixed(2)}%</p>

      <h3>Trades Executed</h3>
      <p><strong>Total Trades:</strong> ${report.tradesExecuted}</p>
      <p><strong>Win Rate:</strong> ${report.winRate.toFixed(1)}%</p>

      <h3>Sector Performance</h3>
      <ul>
        ${Object.entries(report.sectorPerformance).map(([sector, perf]) =>
          `<li>${sector}: ${perf >= 0 ? '+' : ''}${perf.toFixed(2)}%</li>`
        ).join('')}
      </ul>

      <h3>AI Insights</h3>
      <p>${report.aiInsights}</p>

      <h3>Next Week Strategy</h3>
      <p>${report.nextWeekStrategy}</p>
    `;

    return await this.sendEmail(subject, html);
  }

  /**
   * Send trade execution confirmation
   */
  async sendTradeConfirmation(trade) {
    const subject = `✅ Trade Executed: ${trade.side.toUpperCase()} ${trade.quantity} ${trade.symbol}`;

    const html = `
      <h2>Trade Confirmation</h2>
      <p><strong>Order ID:</strong> ${trade.orderId}</p>
      <p><strong>Symbol:</strong> ${trade.symbol}</p>
      <p><strong>Action:</strong> ${trade.side.toUpperCase()}</p>
      <p><strong>Quantity:</strong> ${trade.quantity} shares</p>
      <p><strong>Price:</strong> $${trade.price}</p>
      <p><strong>Total:</strong> $${(trade.quantity * trade.price).toFixed(2)}</p>
      <p><strong>Status:</strong> ${trade.status}</p>
      <p><strong>Time:</strong> ${new Date(trade.timestamp).toLocaleString()}</p>

      <p><em>Trade logged to database.</em></p>
    `;

    return await this.sendEmail(subject, html);
  }

  /**
   * Send error alert
   */
  async sendErrorAlert(error, context) {
    const subject = `🚨 Whiskie Error Alert`;

    const html = `
      <h2>Error Alert</h2>
      <p><strong>Context:</strong> ${context}</p>
      <p><strong>Error:</strong> ${error.message}</p>
      <pre>${error.stack}</pre>
      <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>

      <p><em>Check logs for more details.</em></p>
    `;

    return await this.sendEmail(subject, html);
  }

  /**
   * Generic email sender
   */
  async sendEmail(subject, html) {
    try {
      const info = await this.transporter.sendMail({
        from: `"Whiskie Bot" <${process.env.EMAIL_USER}>`,
        to: this.alertEmail,
        subject,
        html
      });

      console.log('Email sent:', info.messageId);
      return info;
    } catch (error) {
      console.error('Email error:', error.message);
      throw error;
    }
  }

  /**
   * Test email configuration
   */
  async testEmail() {
    const subject = '✅ Whiskie Email Test';
    const html = `
      <h2>Email Configuration Test</h2>
      <p>If you're reading this, email alerts are working correctly! 🎉</p>
      <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
    `;

    return await this.sendEmail(subject, html);
  }
}

export default new EmailAlerts();
