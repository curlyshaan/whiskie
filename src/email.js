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

  formatCurrency(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 'N/A';
    }
    return numeric.toLocaleString();
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
      <p><strong>Total Value:</strong> $${this.formatCurrency(trade.totalValue)}</p>
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
      <p><strong>Total Value:</strong> $${this.formatCurrency(trade.totalValue)}</p>
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
      <p><strong>Total Value:</strong> $${this.formatCurrency(summary.totalValue)}</p>
      <p><strong>Cash:</strong> $${this.formatCurrency(summary.cash)}</p>
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
  async sendAlert(subject, message) {
    const html = `
      <h2>${subject}</h2>
      <pre style="font-family: Menlo, Monaco, Consolas, 'Courier New', monospace; white-space: pre-wrap;">${String(message || '')}</pre>
      <hr>
      <p><em>Sent at ${new Date().toLocaleString()}</em></p>
    `;

    try {
      await this.sendEmail(this.alertEmail, subject, html);
      console.log(`📧 Alert email sent: ${subject}`);
    } catch (error) {
      console.error(`Failed to send alert email (${subject}):`, error);
      throw error;
    }
  }

  async sendPositionAlert(position, currentPrice, percentDown) {
    const subject = `⚠️ Position Alert: ${position.symbol} down ${percentDown.toFixed(1)}%`;
    const html = `
      <h2>Position Alert</h2>
      <p><strong>Symbol:</strong> ${position.symbol}</p>
      <p><strong>Current Price:</strong> $${Number(currentPrice || 0).toFixed(2)}</p>
      <p><strong>Cost Basis:</strong> $${Number(position.cost_basis || 0).toFixed(2)}</p>
      <p><strong>Drawdown:</strong> ${percentDown.toFixed(1)}%</p>
      <p><strong>Quantity:</strong> ${position.quantity}</p>
    `;

    await this.sendEmail(this.alertEmail, subject, html);
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
      <p><strong>Total Value:</strong> $${this.formatCurrency(review.totalValue)}</p>
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
    const subject = `⏰ Earnings Predictor: ${reminder.symbol} (${reminder.earnings_date})`;
    const direction = (reminder.predicted_direction || 'unknown').toUpperCase();
    const confidence = (reminder.predicted_confidence || 'unknown').toUpperCase();
    const directionColor = direction === 'UP' ? '#10b981' : direction === 'DOWN' ? '#ef4444' : '#f59e0b';
    const reasoningItems = String(reminder.prediction_reasoning || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.replace(/^[-•]\s*/, ''));
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#e2e8f0; background:#0f172a; padding:24px;">
        <div style="max-width:760px; margin:0 auto; background:#111827; border:1px solid #1f2937; border-radius:16px; overflow:hidden;">
          <div style="padding:24px; background:linear-gradient(135deg, #ec4899 0%, #7c3aed 100%); color:white;">
            <h2 style="margin:0 0 8px; font-size:28px;">Earnings Predictor</h2>
            <div style="font-size:16px; opacity:0.95;">${reminder.symbol} • ${reminder.earnings_date}</div>
          </div>
          <div style="padding:24px;">
            <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:18px;">
              <div style="flex:1; min-width:180px; padding:14px; border-radius:12px; background:#0b1220; border:1px solid #1f2937;">
                <div style="font-size:12px; color:#94a3b8; text-transform:uppercase;">Direction</div>
                <div style="font-size:28px; font-weight:800; color:${directionColor};">${direction}</div>
              </div>
              <div style="flex:1; min-width:180px; padding:14px; border-radius:12px; background:#0b1220; border:1px solid #1f2937;">
                <div style="font-size:12px; color:#94a3b8; text-transform:uppercase;">Confidence</div>
                <div style="font-size:28px; font-weight:800; color:white;">${confidence}</div>
              </div>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:18px;">
              <div style="padding:14px; border-radius:12px; background:#0b1220; border:1px solid #1f2937;"><div style="font-size:12px; color:#94a3b8; text-transform:uppercase;">Session</div><div style="font-weight:700; margin-top:6px;">${((reminder.earnings_session || reminder.session_normalized || 'unknown')).replace(/_/g, ' ')}</div></div>
              ${reminder.earnings_time_raw ? `<div style="padding:14px; border-radius:12px; background:#0b1220; border:1px solid #1f2937;"><div style="font-size:12px; color:#94a3b8; text-transform:uppercase;">Timing Detail</div><div style="font-weight:700; margin-top:6px;">${reminder.earnings_time_raw}</div></div>` : ''}
              ${reminder.primary_pathway ? `<div style="padding:14px; border-radius:12px; background:#0b1220; border:1px solid #1f2937;"><div style="font-size:12px; color:#94a3b8; text-transform:uppercase;">Primary Pathway</div><div style="font-weight:700; margin-top:6px;">${reminder.primary_pathway}</div></div>` : ''}
            </div>

            <h3 style="margin:0 0 10px; color:white;">Why</h3>
            ${reasoningItems.length ? `<ul style="margin:0 0 18px; padding-left:20px; color:#dbe4f0;">${reasoningItems.map(item => `<li style=\"margin-bottom:8px;\">${item}</li>`).join('')}</ul>` : '<div style="margin-bottom:18px; color:#dbe4f0;">No prediction reasoning available.</div>'}

            ${reminder.prediction_key_risk ? `<div style="margin-bottom:18px; padding:14px; border-radius:12px; background:rgba(245, 158, 11, 0.14); border:1px solid rgba(245, 158, 11, 0.35);"><div style="font-size:12px; color:#fbbf24; text-transform:uppercase; margin-bottom:6px;">Key Risk</div><div>${reminder.prediction_key_risk}</div></div>` : ''}

            <h3 style="margin:0 0 10px; color:white;">Latest Catalysts</h3>
            <div style="white-space:pre-wrap; background:#0b1220; border:1px solid #1f2937; border-radius:12px; padding:14px; color:#dbe4f0;">${reminder.prediction_catalyst_summary || reminder.catalyst_summary || 'No catalyst summary available.'}</div>
            ${reminder.notes ? `<h3 style="margin:18px 0 10px; color:white;">Notes</h3><div style="white-space:pre-wrap; background:#0b1220; border:1px solid #1f2937; border-radius:12px; padding:14px; color:#dbe4f0;">${reminder.notes}</div>` : ''}
          </div>
        </div>
      </div>
    `;

    try {
      await this.sendEmail(this.alertEmail, subject, html);
      console.log(`📧 Earnings predictor email sent for ${reminder.symbol}`);
    } catch (error) {
      console.error(`Failed to send earnings predictor email for ${reminder.symbol}:`, error);
      throw error;
    }
  }
}

export default new EmailAlerts();
