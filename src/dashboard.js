import express from 'express';
import * as db from './db.js';
import { stripThinkingBlocks } from './utils.js';

const router = express.Router();

/**
 * Convert markdown to HTML for display
 */
function markdownToHtml(text) {
  if (!text) return '';

  let html = text;

  // Remove JSON code blocks (they're redundant with the formatted content above)
  html = html.replace(/```json[\s\S]*?```/g, '');

  // Convert horizontal rules
  html = html.replace(/^---+$/gm, '<hr style="border: none; border-top: 2px solid #2a2f4a; margin: 20px 0;">');

  // Convert EXECUTE_BUY/EXECUTE_SHORT to styled boxes
  html = html.replace(/EXECUTE_(BUY|SHORT):\s*([A-Z]+)\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/g,
    (match, action, symbol, qty, entry, stop, target) => {
      const color = action === 'BUY' ? '#10b981' : '#ef4444';
      return `<div style="background: #1a1f3a; border-left: 4px solid ${color}; padding: 15px; margin: 15px 0; border-radius: 5px;">
        <strong style="color: ${color}; font-size: 1.1rem;">${action} ${symbol}</strong><br>
        <span style="color: #d0d0d0;">Quantity: ${qty} | Entry: $${entry} | Stop: $${stop} | Target: $${target}</span>
      </div>`;
    }
  );

  // Convert markdown tables to HTML
  const tableRegex = /\|(.+)\|\n\|[-:\s|]+\|\n((?:\|.+\|\n?)+)/g;
  html = html.replace(tableRegex, (match, header, rows) => {
    const headers = header.split('|').map(h => h.trim()).filter(h => h);
    const rowData = rows.trim().split('\n').map(row =>
      row.split('|').map(cell => cell.trim()).filter(cell => cell)
    );

    let table = '<table style="width: 100%; border-collapse: collapse; margin: 15px 0; background: #1a1f3a;">';

    // Header
    table += '<thead><tr>';
    headers.forEach(h => {
      table += `<th style="border: 1px solid #2a2f4a; padding: 10px; background: #0f1425; text-align: left; color: #fff;">${h}</th>`;
    });
    table += '</tr></thead>';

    // Body
    table += '<tbody>';
    rowData.forEach(row => {
      table += '<tr>';
      row.forEach(cell => {
        table += `<td style="border: 1px solid #2a2f4a; padding: 10px; color: #d0d0d0;">${cell}</td>`;
      });
      table += '</tr>';
    });
    table += '</tbody></table>';

    return table;
  });

  // Convert headers
  html = html.replace(/^### (.*$)/gim, '<h3 style="color: #667eea; margin-top: 25px; margin-bottom: 10px; font-size: 1.1rem;">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 style="color: #667eea; margin-top: 30px; margin-bottom: 15px; font-size: 1.3rem;">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 style="color: #667eea; margin-top: 30px; margin-bottom: 15px; font-size: 1.5rem;">$1</h1>');

  // Convert bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #fff;">$1</strong>');

  // Convert bullet points
  html = html.replace(/^- (.*$)/gim, '<li style="margin-bottom: 8px; color: #d0d0d0;">$1</li>');
  html = html.replace(/(<li.*<\/li>\n?)+/g, '<ul style="margin: 10px 0 10px 20px;">$&</ul>');

  // Convert line breaks to paragraphs
  html = html.split('\n\n').map(para => {
    para = para.trim();
    if (para && !para.startsWith('<')) {
      return `<p style="margin-bottom: 12px; color: #d0d0d0; line-height: 1.6;">${para.replace(/\n/g, '<br>')}</p>`;
    }
    return para;
  }).join('\n');

  return html;
}

/**
 * Dashboard UI - View all analyses and recommendations
 */
router.get('/', async (req, res) => {
  try {
    // Get today's analyses (if table exists)
    const today = new Date().toISOString().split('T')[0];
    let analyses = { rows: [] };
    try {
      analyses = await db.query(
        `SELECT * FROM ai_decisions
         WHERE DATE(created_at) = $1
         ORDER BY created_at DESC`,
        [today]
      );
    } catch (err) {
      // Table doesn't exist yet - fresh start
    }

    // Get current portfolio (if table exists)
    let portfolio = { rows: [] };
    try {
      portfolio = await db.query(
        `SELECT * FROM positions WHERE quantity > 0 ORDER BY symbol`
      );
    } catch (err) {
      // Table doesn't exist yet
    }

    // Get recent trades (if table exists)
    let trades = { rows: [] };
    try {
      trades = await db.query(
        `SELECT * FROM trades
         ORDER BY executed_at DESC
         LIMIT 10`
      );
    } catch (err) {
      // Table doesn't exist yet
    }

    // Get portfolio snapshot (if table exists)
    let snapshot = { rows: [] };
    try {
      snapshot = await db.query(
        `SELECT * FROM portfolio_snapshots
         ORDER BY snapshot_date DESC
         LIMIT 1`
      );
    } catch (err) {
      // Table doesn't exist yet
    }

    const html = generateDashboardHTML(analyses.rows, portfolio.rows, trades.rows, snapshot.rows[0]);
    res.send(html);
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).send('Error loading dashboard');
  }
});

/**
 * API endpoint - Get latest analysis as JSON
 */
router.get('/api/latest', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM ai_decisions
       ORDER BY created_at DESC
       LIMIT 1`
    );
    res.json(result.rows[0] || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * API endpoint - Get all today's analyses
 */
router.get('/api/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await db.query(
      `SELECT * FROM ai_decisions
       WHERE DATE(created_at) = $1
       ORDER BY created_at DESC`,
      [today]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * API endpoint - Get watchlist with earnings dates
 */
router.get('/api/watchlist', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
        w.*,
        e.earnings_date,
        e.earnings_time
       FROM watchlist w
       LEFT JOIN earnings_calendar e ON w.symbol = e.symbol
       WHERE w.status = 'watching'
       AND (e.earnings_date IS NULL OR e.earnings_date >= CURRENT_DATE)
       ORDER BY w.added_date DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Cron Jobs Status endpoint - View scheduled job execution history
 */
router.get('/cron-status', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const executions = await db.getCronJobExecutions(days);

    const html = generateCronStatusHTML(executions, days);
    res.send(html);
  } catch (error) {
    console.error('Cron status error:', error);
    res.status(500).send('Error loading cron status');
  }
});

/**
 * Logs endpoint - View detailed system logs
 */
router.get('/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;

    // Get recent AI decisions
    const analyses = await db.query(
      `SELECT * FROM ai_decisions ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );

    // Get recent trades
    const trades = await db.query(
      `SELECT * FROM trades ORDER BY executed_at DESC LIMIT $1`,
      [limit]
    );

    // Get recent alerts
    const alerts = await db.query(
      `SELECT * FROM alerts ORDER BY sent_at DESC LIMIT $1`,
      [limit]
    );

    const html = generateLogsHTML(analyses.rows, trades.rows, alerts.rows);
    res.send(html);
  } catch (error) {
    console.error('Logs error:', error);
    res.status(500).send('Error loading logs');
  }
});

function generateDashboardHTML(analyses, positions, trades, snapshot) {
  const totalValue = snapshot?.total_value || 100000;
  const cash = snapshot?.cash || snapshot?.cash_balance || 100000;
  const invested = totalValue - cash;
  const gainLoss = snapshot?.total_gain_loss || 0;
  const gainLossPercent = ((gainLoss / 100000) * 100).toFixed(2);

  return `
<!DOCTYPE html>
<html>
<head>
  <title>Whiskie Dashboard</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0e27;
      color: #e0e0e0;
      padding: 20px;
      line-height: 1.6;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 10px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle {
      color: #888;
      margin-bottom: 30px;
      font-size: 1.1rem;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: #1a1f3a;
      padding: 20px;
      border-radius: 12px;
      border: 1px solid #2a2f4a;
    }
    .stat-label {
      color: #888;
      font-size: 0.9rem;
      margin-bottom: 5px;
    }
    .stat-value {
      font-size: 1.8rem;
      font-weight: bold;
      color: #fff;
    }
    .stat-value.positive { color: #10b981; }
    .stat-value.negative { color: #ef4444; }
    .section {
      background: #1a1f3a;
      padding: 25px;
      border-radius: 12px;
      margin-bottom: 25px;
      border: 1px solid #2a2f4a;
    }
    .section-title {
      font-size: 1.5rem;
      margin-bottom: 20px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .approval-card {
      background: #1a2332;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 15px;
      border-left: 4px solid #f59e0b;
    }
    .approval-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }
    .approval-title {
      font-size: 1.2rem;
      font-weight: bold;
      color: #f59e0b;
    }
    .approval-expires {
      color: #888;
      font-size: 0.85rem;
    }
    .approval-details {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin-bottom: 15px;
    }
    .approval-detail {
      color: #d0d0d0;
    }
    .approval-detail strong {
      color: #fff;
      display: block;
      margin-bottom: 5px;
    }
    .approval-reasoning {
      background: #0f1425;
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 15px;
      color: #d0d0d0;
      font-size: 0.9rem;
      max-height: 150px;
      overflow-y: auto;
    }
    .approval-actions {
      display: flex;
      gap: 10px;
    }
    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.95rem;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.8; }
    .btn-approve {
      background: #10b981;
      color: white;
    }
    .btn-reject {
      background: #ef4444;
      color: white;
    }
    details {
      margin-bottom: 15px;
    }
    summary {
      background: #0f1425;
      padding: 15px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
      color: #667eea;
      border-left: 4px solid #667eea;
      user-select: none;
    }
    summary:hover {
      background: #151a2e;
    }
    .analysis-content {
      background: #0f1425;
      padding: 20px;
      margin-top: 10px;
      border-radius: 8px;
      color: #d0d0d0;
      font-size: 0.95rem;
      line-height: 1.8;
      max-height: 600px;
      overflow-y: auto;
    }
    .analysis-content h1, .analysis-content h2, .analysis-content h3 {
      color: #fff;
      margin-top: 20px;
      margin-bottom: 10px;
    }
    .analysis-content h1 { font-size: 1.5rem; }
    .analysis-content h2 { font-size: 1.3rem; }
    .analysis-content h3 { font-size: 1.1rem; }
    .analysis-content strong { color: #fff; font-weight: 600; }
    .analysis-content ul, .analysis-content ol {
      margin-left: 20px;
      margin-top: 10px;
      margin-bottom: 10px;
    }
    .analysis-content li { margin-bottom: 5px; }
    .analysis-content p { margin-bottom: 10px; }
    .analysis-content code {
      background: #1a1f3a;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
      color: #10b981;
    }
    .analysis-content pre {
      background: #1a1f3a;
      padding: 15px;
      border-radius: 5px;
      overflow-x: auto;
      margin: 10px 0;
    }
    .token-usage {
      color: #888;
      font-size: 0.85rem;
      margin-top: 10px;
    }
    .no-data {
      color: #666;
      text-align: center;
      padding: 40px;
      font-style: italic;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      background: #0f1425;
      padding: 12px;
      text-align: left;
      color: #888;
      font-weight: 600;
      font-size: 0.9rem;
      text-transform: uppercase;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid #2a2f4a;
    }
    tr:hover {
      background: #0f1425;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .badge.buy { background: #10b98120; color: #10b981; }
    .badge.sell { background: #ef444420; color: #ef4444; }
    .badge.hold { background: #f59e0b20; color: #f59e0b; }
    .refresh-btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .refresh-btn:hover {
      opacity: 0.9;
    }
    .analyze-btn {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      border: none;
      padding: 15px 30px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 20px;
      margin-left: 10px;
    }
    .analyze-btn:hover {
      opacity: 0.9;
    }
    .analyze-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .timestamp {
      color: #666;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🥃 Whiskie Dashboard</h1>
    <p class="subtitle">AI-Powered Portfolio Manager • Paper Trading Mode</p>

    <button class="refresh-btn" onclick="location.reload()">🔄 Refresh</button>
    <button class="analyze-btn" onclick="triggerAnalysis()" id="analyzeBtn">🤖 Analyze Now</button>
    <a href="/approvals" style="display:inline-block; padding: 10px 20px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin-left: 10px;" id="approvalsBtn">
      ⚖️ Trade Approvals
    </a>
    <a href="/adhoc-analyzer" style="display:inline-block; padding: 10px 20px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin-left: 10px;">
      🔍 Adhoc Analyzer
    </a>
    <a href="/cron-status" style="display:inline-block; padding: 10px 20px; background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin-left: 10px;">
      ⏰ Cron Jobs
    </a>

    <div class="stats">
      <div class="stat-card">
        <div class="stat-label">Total Portfolio Value</div>
        <div class="stat-value">$${totalValue.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Cash Available</div>
        <div class="stat-value">$${cash.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Invested</div>
        <div class="stat-value">$${invested.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Gain/Loss</div>
        <div class="stat-value ${gainLoss >= 0 ? 'positive' : 'negative'}">
          ${gainLoss >= 0 ? '+' : ''}$${gainLoss.toLocaleString()} (${gainLossPercent}%)
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Positions</div>
        <div class="stat-value">${positions.length}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">📊 Today's Analyses</div>
      ${analyses.length === 0 ?
        '<div class="no-data">No analyses yet today. Next run at 10:00 AM ET.</div>' :
        analyses.map(a => {
          const time = new Date(a.created_at).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/New_York'
          });
          const date = new Date(a.created_at).toLocaleDateString();
          const inputTokens = a.input_tokens || 0;
          const outputTokens = a.output_tokens || 0;
          const totalTokens = a.total_tokens || (inputTokens + outputTokens);

          // Determine phase label
          let phaseLabel = 'Analysis';
          let phaseEmoji = '📊';
          if (a.decision_type === 'phase2-long-analysis') {
            phaseLabel = 'Phase 2: Long Analysis';
            phaseEmoji = '📈';
          } else if (a.decision_type === 'phase3-short-analysis') {
            phaseLabel = 'Phase 3: Short Analysis';
            phaseEmoji = '📉';
          } else if (a.decision_type === 'deep-analysis') {
            phaseLabel = 'Phase 4: Portfolio Construction';
            phaseEmoji = '🎯';
          }

          const cleanedRecommendation = stripThinkingBlocks(a.recommendation || 'No recommendation');
          const htmlContent = markdownToHtml(cleanedRecommendation);
          return `
            <details>
              <summary>
                ${phaseEmoji} ${time} ET ${phaseLabel} <span class="timestamp">(${date})</span>
                ${totalTokens > 0 ? `<span class="token-usage"> • ${totalTokens.toLocaleString()} tokens</span>` : ''}
              </summary>
              <div class="analysis-content">${htmlContent}</div>
            </details>
          `;
        }).join('')
      }
    </div>

    <div class="section">
      <div class="section-title">💼 Current Positions</div>
      ${positions.length === 0 ?
        '<div class="no-data">No positions yet. Waiting for Opus recommendations.</div>' :
        `<table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Shares</th>
              <th>Entry Price</th>
              <th>Current Price</th>
              <th>Gain/Loss</th>
              <th>Pathway</th>
              <th>Intent</th>
              <th>Stop Loss</th>
              <th>Take Profit</th>
            </tr>
          </thead>
          <tbody>
            ${positions.map(p => {
              const costBasis = parseFloat(p.cost_basis) || 0;
              const currentPrice = parseFloat(p.current_price) || 0;
              const stopLoss = parseFloat(p.stop_loss) || null;
              const takeProfit = parseFloat(p.take_profit) || null;
              const gainLoss = costBasis > 0 ? ((currentPrice - costBasis) / costBasis * 100).toFixed(2) : '0.00';
              return `
                <tr>
                  <td><strong>${p.symbol}</strong></td>
                  <td>${p.quantity}</td>
                  <td>$${costBasis.toFixed(2)}</td>
                  <td>$${currentPrice.toFixed(2)}</td>
                  <td class="${gainLoss >= 0 ? 'positive' : 'negative'}">
                    ${gainLoss >= 0 ? '+' : ''}${gainLoss}%
                  </td>
                  <td>${p.pathway || '-'}</td>
                  <td>${p.intent || '-'}</td>
                  <td>${stopLoss ? '$' + stopLoss.toFixed(2) : '-'}</td>
                  <td>${takeProfit ? '$' + takeProfit.toFixed(2) : '-'}</td>
                </tr>
              `;
            }).join('')}
            }).join('')}
          </tbody>
        </table>`
      }
    </div>

    <div class="section">
      <div class="section-title">📈 Recent Trades</div>
      ${trades.length === 0 ?
        '<div class="no-data">No trades executed yet.</div>' :
        `<table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Action</th>
              <th>Symbol</th>
              <th>Shares</th>
              <th>Price</th>
              <th>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${trades.map(t => {
              const price = parseFloat(t.price) || 0;
              const quantity = parseInt(t.quantity) || 0;
              return `
              <tr>
                <td>${new Date(t.executed_at).toLocaleDateString()}</td>
                <td><span class="badge ${t.action}">${t.action.toUpperCase()}</span></td>
                <td><strong>${t.symbol}</strong></td>
                <td>${quantity}</td>
                <td>$${price.toFixed(2)}</td>
                <td>$${(quantity * price).toFixed(2)}</td>
                <td>${t.status}</td>
              </tr>
            `;
            }).join('')}
          </tbody>
        </table>`
      }
    </div>

    <div class="section">
      <div class="section-title">⚙️ Bot Status</div>
      <p style="color: #10b981; font-weight: bold;">✅ Running in Paper Trading Mode</p>
      <p style="margin-top: 10px;">
        <strong>Analysis Schedule (Mon-Fri):</strong><br>
        • 9:00 AM ET - Pre-market gap scan<br>
        • 10:00 AM ET - Morning analysis (4-phase)<br>
        • 2:00 PM ET - Afternoon analysis<br>
        • 6:00 PM ET - Daily summary email
      </p>
      <p style="margin-top: 15px; color: #888;">
        Last updated: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET
      </p>
    </div>
  </div>

  <script>
    async function triggerAnalysis() {
      const btn = document.getElementById('analyzeBtn');
      btn.disabled = true;
      btn.textContent = '⏳ Analyzing... (3-7 min)';

      try {
        const response = await fetch('/analyze', { method: 'POST' });
        const data = await response.json();
        alert(data.message + '\\n\\nCheck back in 3-7 minutes for results.');
        setTimeout(() => location.reload(), 5000);
      } catch (error) {
        alert('Error triggering analysis: ' + error.message);
        btn.disabled = false;
        btn.textContent = '🤖 Analyze Now';
      }
    }

    // Auto-refresh every 5 minutes
    setTimeout(() => location.reload(), 300000);
  </script>
</body>
</html>
  `;
}

function generateLogsHTML(analyses, trades, alerts) {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Whiskie Logs</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0e27;
      color: #e0e0e0;
      padding: 20px;
      line-height: 1.6;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 10px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle {
      color: #888;
      margin-bottom: 30px;
      font-size: 1.1rem;
    }
    .section {
      background: #1a1f3a;
      padding: 25px;
      border-radius: 12px;
      margin-bottom: 25px;
      border: 1px solid #2a2f4a;
    }
    .section-title {
      font-size: 1.5rem;
      margin-bottom: 20px;
      color: #fff;
    }
    .log-entry {
      background: #0f1425;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 10px;
      border-left: 4px solid #667eea;
    }
    .log-entry.trade { border-left-color: #10b981; }
    .log-entry.alert { border-left-color: #f59e0b; }
    .log-entry.error { border-left-color: #ef4444; }
    .log-time {
      color: #888;
      font-size: 0.85rem;
      margin-bottom: 5px;
    }
    .log-type {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-right: 10px;
    }
    .log-type.analysis { background: #667eea20; color: #667eea; }
    .log-type.trade { background: #10b98120; color: #10b981; }
    .log-type.alert { background: #f59e0b20; color: #f59e0b; }
    .log-content {
      color: #d0d0d0;
      margin-top: 10px;
      font-size: 0.9rem;
    }
    .back-btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 20px;
      text-decoration: none;
      display: inline-block;
    }
    .back-btn:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📋 System Logs</h1>
    <p class="subtitle">Detailed activity logs from Whiskie AI</p>

    <a href="/" class="back-btn">← Back to Dashboard</a>

    <div class="section">
      <div class="section-title">AI Decisions & Analysis</div>
      ${analyses.length === 0 ? '<p style="color: #666;">No analyses logged yet.</p>' :
        analyses.map(a => `
          <div class="log-entry">
            <div class="log-time">${new Date(a.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</div>
            <span class="log-type analysis">${a.decision_type}</span>
            ${a.symbol ? `<strong>${a.symbol}</strong>` : ''}
            <div class="log-content">
              <strong>Recommendation:</strong> ${a.recommendation.substring(0, 200)}${a.recommendation.length > 200 ? '...' : ''}
              ${a.model_used ? `<br><em>Model: ${a.model_used}</em>` : ''}
              ${a.total_tokens ? `<br><em>Tokens: ${a.total_tokens.toLocaleString()}</em>` : ''}
            </div>
          </div>
        `).join('')
      }
    </div>

    <div class="section">
      <div class="section-title">Trade Executions</div>
      ${trades.length === 0 ? '<p style="color: #666;">No trades executed yet.</p>' :
        trades.map(t => `
          <div class="log-entry trade">
            <div class="log-time">${new Date(t.executed_at).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</div>
            <span class="log-type trade">${t.action.toUpperCase()}</span>
            <strong>${t.symbol}</strong> - ${t.quantity} shares @ $${t.price}
            <div class="log-content">
              <strong>Total Value:</strong> $${t.total_value}
              <br><strong>Status:</strong> ${t.status}
              ${t.order_id ? `<br><strong>Order ID:</strong> ${t.order_id}` : ''}
              ${t.reasoning ? `<br><strong>Reasoning:</strong> ${t.reasoning.substring(0, 150)}...` : ''}
            </div>
          </div>
        `).join('')
      }
    </div>

    <div class="section">
      <div class="section-title">Alerts & Notifications</div>
      ${alerts.length === 0 ? '<p style="color: #666;">No alerts sent yet.</p>' :
        alerts.map(a => `
          <div class="log-entry alert ${a.severity === 'high' ? 'error' : ''}">
            <div class="log-time">${new Date(a.sent_at).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</div>
            <span class="log-type alert">${a.alert_type}</span>
            ${a.symbol ? `<strong>${a.symbol}</strong>` : ''}
            <div class="log-content">
              ${a.message}
              ${a.severity ? `<br><em>Severity: ${a.severity}</em>` : ''}
            </div>
          </div>
        `).join('')
      }
    </div>

    <p style="color: #666; text-align: center; margin-top: 30px;">
      Showing last 100 entries per category • Auto-refresh every 5 minutes
    </p>
  </div>

  <script>
    // Auto-refresh every 5 minutes
    setTimeout(() => location.reload(), 300000);
  </script>
</body>
</html>
  `;
}

// Trade Approval Routes
router.get('/approvals', async (req, res) => {
  try {
    const tradeApproval = (await import('./trade-approval.js')).default;
    const pending = await tradeApproval.getPendingApprovals();
    const stats = await tradeApproval.getApprovalStats();

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trade Approvals - Whiskie</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0f1425 0%, #1a1f3a 100%);
      color: #fff;
      padding: 20px;
      min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 2.5rem; margin-bottom: 10px; }
    .subtitle { color: #a0a0a0; margin-bottom: 30px; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: #1a1f3a;
      padding: 20px;
      border-radius: 10px;
      border: 1px solid #2a2f4a;
    }
    .stat-value { font-size: 2rem; font-weight: bold; color: #667eea; }
    .stat-label { color: #a0a0a0; font-size: 0.9rem; margin-top: 5px; }
    .trade-card {
      background: #1a1f3a;
      border: 2px solid #2a2f4a;
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .trade-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }
    .trade-symbol {
      font-size: 1.5rem;
      font-weight: bold;
      color: #667eea;
    }
    .trade-action {
      padding: 5px 15px;
      border-radius: 5px;
      font-weight: 600;
      font-size: 0.9rem;
    }
    .action-buy { background: #10b98120; color: #10b981; }
    .action-sell { background: #ef444420; color: #ef4444; }
    .trade-details {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 15px;
    }
    .detail-item {
      background: #0f1425;
      padding: 10px;
      border-radius: 5px;
    }
    .detail-label { color: #a0a0a0; font-size: 0.85rem; }
    .detail-value { color: #fff; font-size: 1.1rem; font-weight: 600; margin-top: 5px; }
    .reasoning {
      background: #0f1425;
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 15px;
      color: #d0d0d0;
      line-height: 1.6;
    }
    .detail-block {
      background: #0f1425;
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 15px;
      color: #d0d0d0;
      line-height: 1.5;
    }
    .detail-block ul {
      margin-left: 18px;
      margin-top: 8px;
    }
    .actions {
      display: flex;
      gap: 10px;
    }
    .btn {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.8; }
    .btn-approve {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      flex: 1;
    }
    .btn-reject {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      color: white;
      flex: 1;
    }
    .btn-back {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-decoration: none;
      display: inline-block;
      margin-bottom: 20px;
      margin-right: 10px;
    }
    .btn-clear-all {
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      color: white;
      margin-bottom: 20px;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #a0a0a0;
    }
    .expires { color: #f59e0b; font-size: 0.85rem; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>⚖️ Trade Approvals</h1>
    <p class="subtitle">Review and approve pending trades</p>

    <a href="/" class="btn btn-back">← Back to Dashboard</a>
    ${pending.length > 0 ? `<button class="btn btn-clear-all" onclick="clearAllPending()">🗑️ Clear All Pending</button>` : ''}

    <div class="stats">
      <div class="stat-card">
        <div class="stat-value">${pending.length}</div>
        <div class="stat-label">Pending</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.approved}</div>
        <div class="stat-label">Approved (30d)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.rejected}</div>
        <div class="stat-label">Rejected (30d)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.executed}</div>
        <div class="stat-label">Executed (30d)</div>
      </div>
    </div>

    ${pending.length === 0 ? `
      <div class="empty-state">
        <h2>✅ No pending approvals</h2>
        <p>All trades have been reviewed</p>
      </div>
    ` : pending.map(trade => `
      <div class="trade-card">
        <div class="trade-header">
          <div class="trade-symbol">${trade.symbol}</div>
          <div class="trade-action ${trade.action.includes('buy') ? 'action-buy' : 'action-sell'}">
            ${trade.action.toUpperCase()}
          </div>
        </div>

        <div class="trade-details">
          <div class="detail-item">
            <div class="detail-label">Quantity</div>
            <div class="detail-value">${trade.quantity} shares</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Entry Price</div>
            <div class="detail-value">$${trade.entry_price ? parseFloat(trade.entry_price).toFixed(2) : 'Market'}</div>
          </div>
          ${trade.stop_loss ? `
          <div class="detail-item">
            <div class="detail-label">Stop Loss</div>
            <div class="detail-value">$${parseFloat(trade.stop_loss).toFixed(2)}</div>
          </div>
          ` : ''}
          ${trade.take_profit ? `
          <div class="detail-item">
            <div class="detail-label">Take Profit</div>
            <div class="detail-value">$${parseFloat(trade.take_profit).toFixed(2)}</div>
          </div>
          ` : ''}
          ${trade.pathway ? `
          <div class="detail-item">
            <div class="detail-label">Pathway</div>
            <div class="detail-value">${trade.pathway}</div>
          </div>
          ` : ''}
          ${trade.intent ? `
          <div class="detail-item">
            <div class="detail-label">Intent</div>
            <div class="detail-value">${trade.intent}</div>
          </div>
          ` : ''}
        </div>

        <div class="reasoning">
          <strong>Reasoning:</strong><br>
          ${trade.reasoning}
        </div>

        ${(trade.investment_thesis || trade.strategy_type || trade.holding_period || trade.confidence || trade.growth_potential || trade.stop_type || trade.target_type) ? `
        <div class="detail-block">
          <strong>Trade Thesis & Plan</strong>
          <ul>
            ${trade.investment_thesis ? `<li><strong>Thesis:</strong> ${trade.investment_thesis}</li>` : ''}
            ${trade.strategy_type ? `<li><strong>Strategy:</strong> ${trade.strategy_type}</li>` : ''}
            ${trade.holding_period ? `<li><strong>Holding Period:</strong> ${trade.holding_period}</li>` : ''}
            ${trade.confidence ? `<li><strong>Confidence:</strong> ${trade.confidence}</li>` : ''}
            ${trade.growth_potential ? `<li><strong>Growth Potential:</strong> ${trade.growth_potential}</li>` : ''}
            ${trade.stop_type ? `<li><strong>Stop Type:</strong> ${trade.stop_type}</li>` : ''}
            ${trade.stop_reason ? `<li><strong>Stop Reason:</strong> ${trade.stop_reason}</li>` : ''}
            ${trade.target_type ? `<li><strong>Target Type:</strong> ${trade.target_type}</li>` : ''}
            ${trade.trailing_stop_pct ? `<li><strong>Trailing Stop %:</strong> ${trade.trailing_stop_pct}%</li>` : ''}
            ${trade.rebalance_threshold_pct ? `<li><strong>Rebalance Threshold %:</strong> ${trade.rebalance_threshold_pct}%</li>` : ''}
            ${trade.max_holding_days ? `<li><strong>Max Hold Days:</strong> ${trade.max_holding_days}</li>` : ''}
          </ul>
        </div>
        ` : ''}

        ${(trade.catalysts || trade.news_links || trade.fundamentals || trade.risk_factors || trade.technical_setup) ? `
        <div class="detail-block">
          <strong>Supporting Detail</strong>
          <ul>
            ${trade.technical_setup ? `<li><strong>Technical:</strong> ${trade.technical_setup}</li>` : ''}
            ${trade.risk_factors ? `<li><strong>Risks:</strong> ${trade.risk_factors}</li>` : ''}
            ${trade.fundamentals ? `<li><strong>Fundamentals:</strong> ${typeof trade.fundamentals === 'string' ? trade.fundamentals : JSON.stringify(trade.fundamentals)}</li>` : ''}
            ${trade.catalysts ? `<li><strong>Catalysts:</strong> ${Array.isArray(trade.catalysts) ? trade.catalysts.join('; ') : JSON.stringify(trade.catalysts)}</li>` : ''}
            ${trade.news_links ? `<li><strong>News:</strong> ${Array.isArray(trade.news_links) ? trade.news_links.join(', ') : JSON.stringify(trade.news_links)}</li>` : ''}
          </ul>
        </div>
        ` : ''}

        <div class="actions">
          <button class="btn btn-approve" onclick="approveTrade(${trade.id})">
            ✓ Approve Trade
          </button>
          <button class="btn btn-reject" onclick="rejectTrade(${trade.id})">
            ✗ Reject Trade
          </button>
        </div>

        <div class="expires">
          Expires: ${new Date(trade.expires_at).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET
        </div>
      </div>
    `).join('')}
  </div>

  <script>
    async function approveTrade(id) {
      if (!confirm('Approve this trade?')) return;

      try {
        const res = await fetch(\`/api/approvals/\${id}/approve\`, { method: 'POST' });
        const data = await res.json();

        if (data.success) {
          alert('Trade approved!');
          location.reload();
        } else {
          alert('Error: ' + data.error);
        }
      } catch (error) {
        alert('Error approving trade: ' + error.message);
      }
    }

    async function rejectTrade(id) {
      const reason = prompt('Reason for rejection (optional):');
      if (reason === null) return;

      try {
        const res = await fetch(\`/api/approvals/\${id}/reject\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason || 'User rejected' })
        });
        const data = await res.json();

        if (data.success) {
          alert('Trade rejected');
          location.reload();
        } else {
          alert('Error: ' + data.error);
        }
      } catch (error) {
        alert('Error rejecting trade: ' + error.message);
      }
    }

    async function clearAllPending() {
      if (!confirm('Clear all pending approvals? This will reject all pending trades.')) return;

      try {
        const res = await fetch('/api/approvals/clear-all', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
          alert(\`Cleared \${data.count} pending trade(s)\`);
          location.reload();
        } else {
          alert('Error: ' + data.error);
        }
      } catch (error) {
        alert('Error clearing approvals: ' + error.message);
      }
    }

    // Auto-refresh every 30 seconds
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>
    `);
  } catch (error) {
    res.status(500).send('Error loading approvals: ' + error.message);
  }
});

// API endpoints for approval actions
router.post('/api/approvals/:id/approve', async (req, res) => {
  try {
    const tradeApproval = (await import('./trade-approval.js')).default;
    const result = await tradeApproval.approveTrade(parseInt(req.params.id));
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/api/approvals/:id/reject', async (req, res) => {
  try {
    const tradeApproval = (await import('./trade-approval.js')).default;
    const { reason } = req.body;
    const result = await tradeApproval.rejectTrade(parseInt(req.params.id), reason);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/api/approvals/clear-all', async (req, res) => {
  try {
    const tradeApproval = (await import('./trade-approval.js')).default;
    const result = await tradeApproval.clearAllPending();
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

function generateCronStatusHTML(executions, days) {
  // Group executions by job name
  const jobGroups = {};
  executions.forEach(exec => {
    if (!jobGroups[exec.job_name]) {
      jobGroups[exec.job_name] = [];
    }
    jobGroups[exec.job_name].push(exec);
  });

  // Define expected jobs
  const expectedJobs = [
    { name: 'Pre-Market Scan', type: 'daily', schedule: '9:00 AM ET Mon-Fri', endpoint: '/api/trigger-premarket-scan' },
    { name: 'Morning Analysis', type: 'daily', schedule: '10:00 AM ET Mon-Fri', endpoint: '/api/trigger-daily-analysis' },
    { name: 'Afternoon Analysis', type: 'daily', schedule: '2:00 PM ET Mon-Fri', endpoint: '/api/trigger-daily-analysis' },
    { name: 'Daily Summary', type: 'daily', schedule: '6:00 PM ET Mon-Fri', endpoint: '/api/trigger-eod-summary' },
    { name: 'Trade Executor', type: 'manual', schedule: 'Every 30 min (9:30am-4pm ET)', endpoint: '/api/trigger-trade-executor' },
    { name: 'Weekly Earnings Refresh', type: 'weekly', schedule: 'Friday 3:00 PM ET', endpoint: null },
    { name: 'Stock Universe Refresh', type: 'weekly', schedule: 'Saturday 10:00 AM ET', endpoint: null },
    { name: 'Saturday Screening', type: 'weekly', schedule: 'Saturday 3:00 PM ET', endpoint: '/api/trigger-saturday-screening' },
    { name: 'Weekly Portfolio Review', type: 'weekly', schedule: 'Sunday 1:00 PM ET', endpoint: '/weekly-review' },
    { name: 'Profile Building', type: 'weekly', schedule: 'Sunday 3:00 PM ET', endpoint: null },
    { name: 'Weekly Opus Review', type: 'weekly', schedule: 'Sunday 9:00 PM ET', endpoint: '/api/trigger-weekly-opus-review' }
  ];

  return `
<!DOCTYPE html>
<html>
<head>
  <title>Cron Job Status - Whiskie</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0e27;
      color: #e0e0e0;
      padding: 20px;
      line-height: 1.6;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 10px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle {
      color: #888;
      margin-bottom: 30px;
      font-size: 1.1rem;
    }
    .back-btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 20px;
      text-decoration: none;
      display: inline-block;
    }
    .back-btn:hover { opacity: 0.9; }
    .section {
      background: #1a1f3a;
      padding: 25px;
      border-radius: 12px;
      margin-bottom: 25px;
      border: 1px solid #2a2f4a;
    }
    .section-title {
      font-size: 1.5rem;
      margin-bottom: 20px;
      color: #fff;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      background: #0f1425;
      padding: 12px;
      text-align: left;
      color: #888;
      font-weight: 600;
      font-size: 0.9rem;
      text-transform: uppercase;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid #2a2f4a;
    }
    tr:hover {
      background: #0f1425;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .status-completed { background: #10b98120; color: #10b981; }
    .status-failed { background: #ef444420; color: #ef4444; }
    .status-running { background: #f59e0b20; color: #f59e0b; }
    .status-pending { background: #6b728020; color: #9ca3af; }
    .job-type-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .type-daily { background: #3b82f620; color: #3b82f6; }
    .type-weekly { background: #8b5cf620; color: #8b5cf6; }
    .error-message {
      color: #ef4444;
      font-size: 0.85rem;
      margin-top: 5px;
    }
    .btn-run-now {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1rem;
      font-weight: 600;
      margin-left: 15px;
      display: inline-block;
    }
    .btn-run-now:hover { opacity: 0.9; }
    .btn-run-now:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>⏰ Cron Job Status</h1>
    <p class="subtitle">Scheduled job execution history (last ${days} days)</p>

    <a href="/" class="back-btn">← Back to Dashboard</a>

    <div class="section">
      <div class="section-title">📋 Expected Jobs</div>
      <table>
        <thead>
          <tr>
            <th>Job Name</th>
            <th>Type</th>
            <th>Schedule</th>
            <th>Last Run</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${expectedJobs.map(job => {
            const executions = jobGroups[job.name] || [];
            const lastExec = executions[0];
            const lastRunTime = lastExec ? new Date(lastExec.scheduled_time).toLocaleString('en-US', { timeZone: 'America/New_York' }) : 'Never';
            const status = lastExec ? lastExec.status : 'pending';
            return `
              <tr>
                <td><strong>${job.name}</strong></td>
                <td><span class="job-type-badge type-${job.type}">${job.type.toUpperCase()}</span></td>
                <td>${job.schedule}</td>
                <td>${lastRunTime}</td>
                <td><span class="status-badge status-${status}">${status.toUpperCase()}</span></td>
                <td>
                  <button class="btn-run-now" style="margin: 0; padding: 8px 16px; font-size: 0.85rem;"
                          onclick="runJob('${job.endpoint}', '${job.name}', this)">
                    ▶️ Run Now
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">📊 Execution History</div>
      ${executions.length === 0 ?
        '<p style="color: #666; text-align: center; padding: 40px;">No executions recorded yet.</p>' :
        `<table>
          <thead>
            <tr>
              <th>Job Name</th>
              <th>Scheduled Time</th>
              <th>Started</th>
              <th>Completed</th>
              <th>Duration</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${executions.map(exec => {
              const scheduledTime = new Date(exec.scheduled_time).toLocaleString('en-US', { timeZone: 'America/New_York' });
              const startedTime = exec.started_at ? new Date(exec.started_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York' }) : '-';
              const completedTime = exec.completed_at ? new Date(exec.completed_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York' }) : '-';
              const duration = exec.duration_seconds ? `${Math.floor(exec.duration_seconds / 60)}m ${exec.duration_seconds % 60}s` : '-';
              return `
                <tr>
                  <td><strong>${exec.job_name}</strong></td>
                  <td>${scheduledTime}</td>
                  <td>${startedTime}</td>
                  <td>${completedTime}</td>
                  <td>${duration}</td>
                  <td>
                    <span class="status-badge status-${exec.status}">${exec.status.toUpperCase()}</span>
                    ${exec.error_message ? `<div class="error-message">${exec.error_message}</div>` : ''}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>`
      }
    </div>
  </div>

  <script>
    async function runJob(endpoint, jobName, btn) {
      const originalText = btn.textContent;

      try {
        btn.disabled = true;
        btn.textContent = '⏳ Starting...';

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (data.success) {
          btn.textContent = '✅ Started!';
          // Show message below the button
          const tr = btn.closest('tr');
          const existingMsg = tr.querySelector('.run-msg');
          if (existingMsg) existingMsg.remove();
          const msg = document.createElement('div');
          msg.className = 'run-msg';
          msg.style = 'color: #10b981; font-size: 0.8rem; margin-top: 4px;';
          msg.textContent = data.message;
          btn.parentElement.appendChild(msg);

          setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
          }, 5000);
        } else {
          throw new Error(data.error || 'Failed to start job');
        }
      } catch (error) {
        btn.textContent = '❌ Error';
        alert('Error starting ' + jobName + ': ' + error.message);
        setTimeout(() => {
          btn.textContent = originalText;
          btn.disabled = false;
        }, 3000);
      }
    }
  </script>
</body>
</html>
  `;
}

export default router;
