import express from 'express';
import db from './db.js';

const router = express.Router();

/**
 * Dashboard UI - View all analyses and recommendations
 */
router.get('/', async (req, res) => {
  try {
    // Get today's analyses
    const today = new Date().toISOString().split('T')[0];
    const analyses = await db.query(
      `SELECT * FROM ai_decisions
       WHERE DATE(created_at) = $1
       ORDER BY created_at DESC`,
      [today]
    );

    // Get current portfolio
    const portfolio = await db.query(
      `SELECT * FROM positions WHERE quantity > 0 ORDER BY symbol`
    );

    // Get recent trades
    const trades = await db.query(
      `SELECT * FROM trades
       ORDER BY executed_at DESC
       LIMIT 10`
    );

    // Get portfolio snapshot
    const snapshot = await db.query(
      `SELECT * FROM portfolio_snapshots
       ORDER BY snapshot_date DESC
       LIMIT 1`
    );

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
      white-space: pre-wrap;
      font-size: 0.95rem;
      line-height: 1.8;
      max-height: 600px;
      overflow-y: auto;
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

          return `
            <details>
              <summary>
                ${time} ET Analysis <span class="timestamp">(${date})</span>
                ${totalTokens > 0 ? `<span class="token-usage"> • ${totalTokens.toLocaleString()} tokens</span>` : ''}
              </summary>
              <div class="analysis-content">${a.recommendation || 'No recommendation'}</div>
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
                  <td>${stopLoss ? '$' + stopLoss.toFixed(2) : '-'}</td>
                  <td>${takeProfit ? '$' + takeProfit.toFixed(2) : '-'}</td>
                </tr>
              `;
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
        • 10:00 AM ET - Morning analysis<br>
        • 12:30 PM ET - Mid-day check<br>
        • 3:30 PM ET - Before close<br>
        • 4:30 PM ET - Daily summary email
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

    // Auto-refresh every 2 minutes
    setTimeout(() => location.reload(), 120000);
  </script>
</body>
</html>
  `;
}

export default router;
