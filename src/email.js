import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Email Alert System
 * Sends notifications for trades, alerts, and reports
 * Supports both Gmail and SendGrid
 */
class EmailAlerts {
  constructor() {
    // Use SendGrid if API key is provided, otherwise fall back to Gmail
    if (process.env.SENDGRID_API_KEY) {
      this.transporter = nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        secure: false,
        auth: {
          user: 'apikey',
          pass: process.env.SENDGRID_API_KEY
        },
        connectionTimeout: 60000, // 60 seconds
        greetingTimeout: 30000,
        socketTimeout: 60000
      });
      console.log('📧 Email configured with SendGrid');
    } else {
      this.transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false, // Use STARTTLS
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        },
        connectionTimeout: 60000, // 60 seconds
        greetingTimeout: 30000,
        socketTimeout: 60000
      });
      console.log('📧 Email configured with Gmail');
    }

    this.fromEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER;
    this.alertEmail = process.env.ALERT_EMAIL;
  }

  /**
   * Send trade recommendation email
   */
  async sendTradeRecommendation(trade) {
    const subject = `🤖 Whiskie: ${trade.action.toUpperCase()} ${trade.quantity} ${trade.symbol} at $${trade.price}`;

    const dashboardUrl = process.env.DASHBOARD_URL || 'https://whiskie-production.up.railway.app';

    const html = `
      <h2>🤖 Trade Recommendation from Whiskie</h2>

      <h3>Trade Details:</h3>
      <p><strong>Action:</strong> ${trade.action.toUpperCase()}</p>
      <p><strong>Symbol:</strong> ${trade.symbol}</p>
      <p><strong>Quantity:</strong> ${trade.quantity} shares</p>
      <p><strong>Entry Price:</strong> $${trade.price}</p>
      <p><strong>Total Value:</strong> $${(trade.quantity * trade.price).toFixed(2)}</p>

      <h3>Risk Management:</h3>
      <p><strong>Stop-Loss:</strong> ${trade.stopLoss ? '$' + trade.stopLoss : 'Not set'}</p>
      <p><strong>Take-Profit:</strong> ${trade.takeProfit ? '$' + trade.takeProfit : 'Not set'}</p>

      <h3>AI Reasoning:</h3>
      <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px; white-space: pre-wrap;">${trade.reasoning}</pre>

      <hr>
      <p><strong>⚠️ Action Required:</strong></p>
      <p>Visit the dashboard to approve or reject this trade:</p>
      <p><a href="${dashboardUrl}" style="background: #667eea; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Open Dashboard</a></p>

      <p style="color: #666; font-size: 0.9em; margin-top: 20px;">This recommendation will expire in 10 minutes.</p>
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
    const subject = `✅ Trade Executed: ${trade.action.toUpperCase()} ${trade.quantity} ${trade.symbol} @ $${trade.price}`;

    const html = `
      <h2>✅ Trade Executed Successfully</h2>

      <h3>Trade Details:</h3>
      <p><strong>Action:</strong> ${trade.action.toUpperCase()}</p>
      <p><strong>Symbol:</strong> ${trade.symbol}</p>
      <p><strong>Quantity:</strong> ${trade.quantity} shares</p>
      <p><strong>Price:</strong> $${trade.price}</p>
      <p><strong>Total Value:</strong> $${(trade.quantity * trade.price).toFixed(2)}</p>
      <p><strong>Time:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</p>

      <h3>Risk Management:</h3>
      <p><strong>Stop-Loss:</strong> ${trade.stopLoss ? '$' + trade.stopLoss : 'Not set'}</p>
      <p><strong>Take-Profit:</strong> ${trade.takeProfit ? '$' + trade.takeProfit : 'Not set'}</p>

      <h3>AI Reasoning:</h3>
      <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px; white-space: pre-wrap;">${trade.reasoning || 'No reasoning provided'}</pre>

      <hr>
      <p style="color: #666; font-size: 0.9em;">This trade was executed automatically by Whiskie AI.</p>
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
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 5000; // 5 seconds

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const info = await this.transporter.sendMail({
          from: `"Whiskie Bot" <${this.fromEmail}>`,
          to: this.alertEmail,
          subject,
          html
        });

        console.log('Email sent:', info.messageId);
        return info;
      } catch (error) {
        const isLastAttempt = attempt === MAX_RETRIES;

        if (isLastAttempt) {
          console.error(`Email failed after ${MAX_RETRIES} attempts:`, error.message);
          // Don't throw - log and continue (email failure shouldn't stop analysis)
          return null;
        }

        console.warn(`Email attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
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
