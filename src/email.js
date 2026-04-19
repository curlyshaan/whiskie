import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Email Alert System using Resend
 * Sends notifications for trades, alerts, and reports
 */
class EmailAlerts {
  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
    this.fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
    this.alertEmail = process.env.ALERT_EMAIL || 'shanoorsai@gmail.com';
    console.log('📧 Email configured with Resend');
  }

  /**
   * Send email with retry logic
   */
  async sendEmail(to, subject, html, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const { data, error } = await this.resend.emails.send({
          from: this.fromEmail,
          to: [to],
          subject,
          html
        });

        if (error) {
          throw new Error(error.message);
        }

        return data;
      } catch (error) {
        if (attempt === retries) {
          console.error(`Email failed after ${retries} attempts:`, error.message);
          throw error;
        }
        console.error(`Email attempt ${attempt} failed, retrying in 5000ms...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  /**
   * Send trade recommendation email
   */
  async sendTradeRecommendation(trade) {
    const subject = `🤖 Whiskie Trade: ${trade.action.toUpperCase()} ${trade.symbol}`;
    const html = `
      <h2>Trade Recommendation</h2>
      <p><strong>Action:</strong> ${trade.action.toUpperCase()}</p>
      <p><strong>Symbol:</strong> ${trade.symbol}</p>
      <p><strong>Quantity:</strong> ${trade.quantity}</p>
      <p><strong>Price:</strong> $${trade.price}</p>
      <p><strong>Total Value:</strong> $${trade.totalValue.toLocaleString()}</p>
      <hr>
      <h3>Reasoning</h3>
      <p>${trade.reasoning}</p>
    `;

    try {
      await this.sendEmail(this.alertEmail, subject, html);
      console.log('📧 Trade recommendation email sent');
    } catch (error) {
      console.error('Failed to send trade recommendation email:', error);
    }
  }

  /**
   * Send trade confirmation email
   */
  async sendTradeConfirmation(trade) {
    const subject = `✅ Trade Executed: ${trade.action.toUpperCase()} ${trade.symbol}`;

    // Add short position warning if applicable
    const shortWarning = trade.action === 'sell_short'
      ? `<p style="color: #ff6b6b;"><strong>⚠️ SHORT POSITION</strong> - Borrow fees apply. Check with broker for current rate.</p>`
      : '';

    const html = `
      <h2>Trade Confirmation</h2>
      ${shortWarning}
      <p><strong>Action:</strong> ${trade.action.toUpperCase()}</p>
      <p><strong>Symbol:</strong> ${trade.symbol}</p>
      <p><strong>Quantity:</strong> ${trade.quantity}</p>
      <p><strong>Price:</strong> $${trade.price}</p>
      <p><strong>Total Value:</strong> $${trade.totalValue.toLocaleString()}</p>
      <p><strong>Order ID:</strong> ${trade.orderId}</p>
      <p><strong>Status:</strong> ${trade.status}</p>
      <hr>
      <p><em>Executed at ${new Date().toLocaleString()}</em></p>
    `;

    try {
      await this.sendEmail(this.alertEmail, subject, html);
      console.log('📧 Trade confirmation email sent');
    } catch (error) {
      console.error('Failed to send trade confirmation email:', error);
    }
  }

  /**
   * Send daily summary email
   */
  async sendDailySummary(summary) {
    const subject = `📊 Daily Summary - ${new Date().toLocaleDateString()}`;
    const html = `
      <h2>Daily Portfolio Summary</h2>
      <p><strong>Total Value:</strong> $${summary.totalValue.toLocaleString()}</p>
      <p><strong>Cash:</strong> $${summary.cash.toLocaleString()}</p>
      <p><strong>Daily Change:</strong> ${summary.dailyChange >= 0 ? '+' : ''}${(summary.dailyChange * 100).toFixed(2)}%</p>
      <p><strong>Total Return:</strong> ${summary.totalReturn >= 0 ? '+' : ''}${(summary.totalReturn * 100).toFixed(2)}%</p>
      <hr>
      <h3>Positions (${summary.positions.length})</h3>
      <ul>
        ${summary.positions.map(p => `
          <li>
            <strong>${p.symbol}</strong>: ${p.quantity} shares @ $${p.currentPrice}
            (${p.gainLoss >= 0 ? '+' : ''}${(p.gainLoss * 100).toFixed(2)}%)
          </li>
        `).join('')}
      </ul>
      <hr>
      <h3>Today's Trades (${summary.trades.length})</h3>
      <ul>
        ${summary.trades.map(t => `
          <li>${t.action.toUpperCase()} ${t.quantity} ${t.symbol} @ $${t.price}</li>
        `).join('')}
      </ul>
    `;

    try {
      await this.sendEmail(this.alertEmail, subject, html);
      console.log('📧 Daily summary email sent');
    } catch (error) {
      console.error('Failed to send daily summary email:', error);
    }
  }

  /**
   * Send error alert email
   */
  async sendErrorAlert(error, context) {
    const subject = `🚨 Whiskie Error Alert`;
    const html = `
      <h2>Error Alert</h2>
      <p><strong>Context:</strong> ${context}</p>
      <p><strong>Error:</strong> ${error.message}</p>
      <pre>${error.stack}</pre>
      <hr>
      <p><em>Occurred at ${new Date().toLocaleString()}</em></p>
    `;

    try {
      await this.sendEmail(this.alertEmail, subject, html);
      console.log('📧 Error alert email sent');
    } catch (error) {
      console.error('Failed to send error alert email:', error);
    }
  }

  /**
   * Send weekly review email
   */
  async sendWeeklyReview(review) {
    const subject = `📈 Weekly Review - ${new Date().toLocaleDateString()}`;
    const html = `
      <h2>Weekly Portfolio Review</h2>
      <p><strong>Total Value:</strong> $${review.totalValue.toLocaleString()}</p>
      <p><strong>Weekly Change:</strong> ${review.weeklyChange >= 0 ? '+' : ''}${(review.weeklyChange * 100).toFixed(2)}%</p>
      <p><strong>Total Return:</strong> ${review.totalReturn >= 0 ? '+' : ''}${(review.totalReturn * 100).toFixed(2)}%</p>
      <hr>
      <h3>Analysis</h3>
      <pre>${review.analysis}</pre>
      <hr>
      <h3>Recommendations</h3>
      <pre>${review.recommendations}</pre>
    `;

    try {
      await this.sendEmail(this.alertEmail, subject, html);
      console.log('📧 Weekly review email sent');
    } catch (error) {
      console.error('Failed to send weekly review email:', error);
    }
  }

  async sendEarningsReminderEmail(reminder) {
    const subject = `⏰ Earnings Reminder: ${reminder.symbol} (${reminder.earnings_date})`;
    const html = `
      <h2>Earnings Reminder</h2>
      <p><strong>Symbol:</strong> ${reminder.symbol}</p>
      <p><strong>Earnings Date:</strong> ${reminder.earnings_date}</p>
      <p><strong>Session:</strong> ${(reminder.earnings_session || 'unknown').replace(/_/g, ' ')}</p>
      ${reminder.earnings_time_raw ? `<p><strong>Timing Detail:</strong> ${reminder.earnings_time_raw}</p>` : ''}
      <hr>
      <h3>Latest Catalysts</h3>
      <pre>${reminder.prediction_catalyst_summary || reminder.catalyst_summary || 'No catalyst summary available.'}</pre>
      ${reminder.notes ? `<h3>Notes</h3><p>${reminder.notes}</p>` : ''}
      <hr>
      <h3>Reaction Predictor</h3>
      <p><strong>Direction:</strong> ${(reminder.predicted_direction || 'unknown').toUpperCase()}</p>
      <p><strong>Confidence:</strong> ${(reminder.predicted_confidence || 'unknown').toUpperCase()}</p>
      <pre>${reminder.prediction_reasoning || 'No prediction reasoning available.'}</pre>
    `;

    try {
      await this.sendEmail(this.alertEmail, subject, html);
      console.log(`📧 Earnings reminder email sent for ${reminder.symbol}`);
    } catch (error) {
      console.error(`Failed to send earnings reminder email for ${reminder.symbol}:`, error);
      throw error;
    }
  }
}

export default new EmailAlerts();
