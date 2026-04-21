import express from 'express';
import * as db from './db.js';
import { stripThinkingBlocks } from './utils.js';
import earningsReminders from './earnings-reminders.js';

const router = express.Router();

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    if (typeof value.summary === 'string') return value.summary.trim();
    return JSON.stringify(value, null, 2);
  }
  return String(value).trim();
}

function parseListValue(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(item => normalizeText(item)).filter(Boolean);
  }

  const text = normalizeText(value);
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map(item => normalizeText(item)).filter(Boolean);
    }
  } catch {}

  return text
    .split(/\s*[;\n]\s*/)
    .map(item => item.replace(/^\-\s*/, '').trim())
    .filter(Boolean);
}

function formatStructuredText(value) {
  const text = normalizeText(value);
  if (!text) return '';

  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `<div>${escapeHtml(line)}</div>`)
    .join('');
}

function renderList(items, type = 'bullet') {
  if (!items.length) return '';

  if (type === 'links') {
    return `<div class="detail-chips">${items.map(item => {
      const safe = escapeHtml(item);
      const isUrl = /^https?:\/\//i.test(item);
      return isUrl
        ? `<a class="news-link" href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`
        : `<span class="detail-chip">${safe}</span>`;
    }).join('')}</div>`;
  }

  return `<ul class="detail-list">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderMetricGrid(items) {
  const validItems = items.filter(item => normalizeText(item.value));
  if (!validItems.length) return '';

  return `<div class="metric-grid">${validItems.map(item => `
    <div class="metric-card">
      <div class="metric-label">${escapeHtml(item.label)}</div>
      <div class="metric-value">${escapeHtml(normalizeText(item.value))}</div>
    </div>
  `).join('')}</div>`;
}

function renderDetailSection(title, content) {
  if (!content) return '';
  return `
    <div class="detail-section">
      <div class="detail-section-title">${escapeHtml(title)}</div>
      <div class="detail-section-body">${content}</div>
    </div>
  `;
}

function formatTargetType(value) {
  const normalized = normalizeText(value);
  if (!normalized) return '-';

  return normalized
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function renderPositionManagementPills(position) {
  const items = [
    position.thesis_state && `Thesis: ${position.thesis_state}`,
    position.holding_posture && `Posture: ${position.holding_posture}`,
    position.target_type && `Target: ${formatTargetType(position.target_type)}`
  ].filter(Boolean);

  if (!items.length) return '-';

  return `<div class="detail-chips">${items.map(item => `<span class="detail-chip">${escapeHtml(item)}</span>`).join('')}</div>`;
}

/**
 * Convert markdown to HTML for display
 */
function markdownToHtml(text) {
  if (!text) return '';

  let html = escapeHtml(text);

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

function formatTradeAction(action) {
  return String(action || '')
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function formatDashboardSession(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'Unknown';
  if (normalized === 'bmo') return 'Pre-market';
  if (normalized === 'amc') return 'Post-market';
  return normalized
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function formatCurrency(value) {
  const num = Number(value);
  return Number.isFinite(num) ? `$${num.toFixed(2)}` : 'Market';
}

function renderPhase4Analysis(text) {
  const cleaned = stripThinkingBlocks(text || '');
  if (!cleaned) return '';

  const escaped = escapeHtml(cleaned);
  const sections = [];

  const portfolioSummaryMatch = cleaned.match(/\*\*PORTFOLIO SUMMARY:\*\*([\s\S]*?)(?=\n\*\*[A-Z ]+:\*\*|$)/i);
  if (portfolioSummaryMatch) {
    const metrics = portfolioSummaryMatch[1]
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('- '))
      .map(line => {
        const content = line.slice(2);
        const idx = content.indexOf(':');
        if (idx === -1) return null;
        return { label: content.slice(0, idx).trim(), value: content.slice(idx + 1).trim() };
      })
      .filter(Boolean);

    if (metrics.length) {
      sections.push(renderDetailSection('Portfolio Summary', renderMetricGrid(metrics)));
    }
  }

  const riskMetricsMatch = cleaned.match(/\*\*RISK METRICS:\*\*([\s\S]*?)(?=\n\*\*[A-Z ]+:\*\*|$)/i);
  if (riskMetricsMatch) {
    const metrics = riskMetricsMatch[1]
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('- '))
      .map(line => {
        const content = line.slice(2);
        const idx = content.indexOf(':');
        if (idx === -1) return null;
        return { label: content.slice(0, idx).trim(), value: content.slice(idx + 1).trim() };
      })
      .filter(Boolean);

    if (metrics.length) {
      sections.push(renderDetailSection('Risk Metrics', renderMetricGrid(metrics)));
    }
  }

  const commandPattern = /EXECUTE_(BUY|SHORT):\s*([A-Z]{1,5})\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)(?:\s*\|\s*([^\|\n]+)\s*\|\s*([^\n]+))?/g;
  const trades = [];
  let match;
  while ((match = commandPattern.exec(cleaned)) !== null) {
    trades.push({
      type: match[1] === 'BUY' ? 'buy' : 'short',
      symbol: match[2],
      quantity: match[3],
      entry: match[4],
      stop: match[5],
      target: match[6],
      pathway: match[7]?.trim(),
      intent: match[8]?.trim()
    });
  }

  if (trades.length) {
    const tradeCards = trades.map(trade => {
      const escapedSymbol = trade.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const blockPattern = new RegExp(`EXECUTE_${trade.type === 'buy' ? 'BUY' : 'SHORT'}:\\s*${escapedSymbol}[^\n]*\n([\s\S]*?)(?=\nEXECUTE_(?:BUY|SHORT):|$)`);
      const blockMatch = cleaned.match(blockPattern);
      const block = blockMatch ? blockMatch[1] : '';
      const extract = (label) => {
        const fieldMatch = block.match(new RegExp(`${label}:\\s*(.+)`, 'i'));
        return fieldMatch ? fieldMatch[1].trim() : '';
      };
      const overrideDecision = extract('OVERRIDE_PHASE2_DECISION');
      const overrideSymbol = extract('OVERRIDE_SYMBOL');
      const overrideReason = extract('OVERRIDE_REASON');

      return `
      <div class="compact-trade-card ${trade.type}">
        <div class="compact-trade-header">
          <div class="compact-trade-title">${trade.type === 'buy' ? 'Buy' : 'Short'} ${escapeHtml(trade.symbol)}</div>
          <div class="compact-trade-badge">${trade.pathway ? escapeHtml(trade.pathway) : 'unclassified'}</div>
        </div>
        ${overrideDecision && overrideDecision.toUpperCase() === 'YES' ? `
          <div class="override-banner">
            <div class="override-label">Phase 4 Override</div>
            ${renderMetricGrid([
              { label: 'Override Decision', value: overrideDecision },
              { label: 'Replaced Symbol', value: overrideSymbol && overrideSymbol.toUpperCase() !== 'NONE' ? overrideSymbol : 'None' }
            ])}
            ${overrideReason && overrideReason.toUpperCase() !== 'NONE' ? `<div class="detail-section-body">${formatStructuredText(overrideReason)}</div>` : ''}
          </div>
        ` : ''}
        <div class="compact-trade-metrics">
          <div>
            <div class="compact-trade-metric-label">Quantity</div>
            <div class="compact-trade-metric-value">${escapeHtml(trade.quantity)}</div>
          </div>
          <div>
            <div class="compact-trade-metric-label">Entry</div>
            <div class="compact-trade-metric-value">$${escapeHtml(trade.entry)}</div>
          </div>
          <div>
            <div class="compact-trade-metric-label">Stop</div>
            <div class="compact-trade-metric-value">$${escapeHtml(trade.stop)}</div>
          </div>
          <div>
            <div class="compact-trade-metric-label">Target</div>
            <div class="compact-trade-metric-value">$${escapeHtml(trade.target)}</div>
          </div>
          <div>
            <div class="compact-trade-metric-label">Intent</div>
            <div class="compact-trade-metric-value">${escapeHtml(trade.intent || 'n/a')}</div>
          </div>
        </div>
      </div>
    `;
    }).join('');

    sections.push(`
      <div class="phase4-section">
        <div class="phase4-section-title">Execution Commands</div>
        ${tradeCards}
      </div>
    `);
  }

  const rationaleMatch = cleaned.match(/\*\*RATIONALE:\*\*([\s\S]*?)$/i);
  if (rationaleMatch) {
    sections.push(renderDetailSection('Rationale', formatStructuredText(rationaleMatch[1])));
  }

  return sections.length ? sections.join('') : `<pre style="white-space: pre-wrap; color: #d0d0d0;">${escaped}</pre>`;
}

function buildTradeBlockLookup(text) {
  const cleaned = stripThinkingBlocks(text || '');
  const lookup = new Map();
  const blockPattern = /(EXECUTE_(?:BUY|SHORT):[^\n]+)([\s\S]*?)(?=EXECUTE_(?:BUY|SHORT):|$)/g;
  let match;
  while ((match = blockPattern.exec(cleaned)) !== null) {
    const command = match[1].trim();
    const body = match[2].trim();
    const symbolMatch = command.match(/EXECUTE_(?:BUY|SHORT):\s*([A-Z]{1,5})\b/i);
    if (!symbolMatch) continue;
    const symbol = symbolMatch[1].toUpperCase();
    if (!lookup.has(symbol)) {
      lookup.set(symbol, { command, body });
    }
  }
  return lookup;
}

function renderExecutableTradesFromApprovals(approvals, analysisText) {
  if (!approvals?.length) return '';

  const blockLookup = buildTradeBlockLookup(analysisText);
  const tradeCards = approvals.map(trade => {
    const block = blockLookup.get(String(trade.symbol || '').toUpperCase())?.body || '';
    const extract = (label) => {
      const fieldMatch = block.match(new RegExp(`${label}:\\s*(.+)`, 'i'));
      return fieldMatch ? fieldMatch[1].trim() : '';
    };
    const overrideDecision = extract('OVERRIDE_PHASE2_DECISION') || trade.override_phase2_decision || '';
    const overrideSymbol = extract('OVERRIDE_SYMBOL') || trade.override_symbol || '';
    const overrideReason = extract('OVERRIDE_REASON') || trade.override_reason || '';

    return `
      <div class="compact-trade-card ${trade.action === 'sell_short' ? 'short' : 'buy'}">
        <div class="compact-trade-header">
          <div class="compact-trade-title">${trade.action === 'sell_short' ? 'Short' : 'Buy'} ${escapeHtml(trade.symbol)}</div>
          <div class="compact-trade-badge">${trade.pathway ? escapeHtml(trade.pathway) : 'unclassified'}</div>
        </div>
        ${overrideDecision && String(overrideDecision).toUpperCase() === 'YES' ? `
          <div class="override-banner">
            <div class="override-label">Phase 4 Override</div>
            ${renderMetricGrid([
              { label: 'Override Decision', value: overrideDecision },
              { label: 'Replaced Symbol', value: overrideSymbol && String(overrideSymbol).toUpperCase() !== 'NONE' ? overrideSymbol : 'None' }
            ])}
            ${overrideReason && String(overrideReason).toUpperCase() !== 'NONE' ? `<div class="detail-section-body">${formatStructuredText(overrideReason)}</div>` : ''}
          </div>
        ` : ''}
        <div class="compact-trade-metrics">
          <div>
            <div class="compact-trade-metric-label">Quantity</div>
            <div class="compact-trade-metric-value">${escapeHtml(trade.quantity)}</div>
          </div>
          <div>
            <div class="compact-trade-metric-label">Entry</div>
            <div class="compact-trade-metric-value">$${escapeHtml(trade.entry_price)}</div>
          </div>
          <div>
            <div class="compact-trade-metric-label">Stop</div>
            <div class="compact-trade-metric-value">$${escapeHtml(trade.stop_loss)}</div>
          </div>
          <div>
            <div class="compact-trade-metric-label">Target</div>
            <div class="compact-trade-metric-value">$${escapeHtml(trade.take_profit)}</div>
          </div>
          <div>
            <div class="compact-trade-metric-label">Intent</div>
            <div class="compact-trade-metric-value">${escapeHtml(trade.intent || 'n/a')}</div>
          </div>
        </div>
        ${trade.quantity_adjustment_note ? `
          <div class="detail-section-body" style="margin-top: 12px;">
            ${escapeHtml(trade.quantity_adjustment_note)}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  return `
    <div class="phase4-section">
      <div class="phase4-section-title">Final Executable Trades</div>
      ${tradeCards}
    </div>
  `;
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

    let dailyState = { rows: [] };
    try {
      dailyState = await db.query(
        `SELECT *
         FROM daily_symbol_state
         WHERE run_date = CURRENT_DATE
         ORDER BY updated_at DESC
         LIMIT 50`
      );
    } catch (err) {
      // Table doesn't exist yet
    }

    let promotedDiscovery = { rows: [] };
    try {
      promotedDiscovery = await db.query(
        `SELECT symbol, pathway, promotion_reason, promoted_at, score, reasons
         FROM saturday_watchlist
         WHERE promotion_status = 'promoted'
         ORDER BY promoted_at DESC NULLS LAST, score DESC NULLS LAST
         LIMIT 20`
      );
    } catch (err) {
      // Table doesn't exist yet
    }

    let todaysApprovals = { rows: [] };
    try {
      todaysApprovals = await db.query(
        `SELECT *
         FROM trade_approvals
         WHERE DATE(created_at) = $1
         ORDER BY created_at DESC`,
        [today]
      );
    } catch (err) {
      // Table doesn't exist yet
    }

    const html = generateDashboardHTML(
      analyses.rows,
      portfolio.rows,
      trades.rows,
      snapshot.rows[0],
      dailyState.rows,
      promotedDiscovery.rows,
      todaysApprovals.rows
    );
    res.send(html);
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).send('Error loading dashboard');
  }
});

/**
 * Deprecated dashboard helper endpoint.
 * Prefer server-rendered dashboard data unless an external client still depends on this JSON shape.
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
 * Deprecated dashboard helper endpoint.
 * Prefer server-rendered dashboard data unless an external client still depends on this JSON shape.
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
 * Deprecated legacy watchlist endpoint.
 * This reads from the old watchlist table rather than the saturday_watchlist workflow.
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

router.get('/earnings-reminders', async (req, res) => {
  try {
    const reminders = await db.getAllActiveEarningsReminders();
    res.send(generateEarningsRemindersHTML(reminders));
  } catch (error) {
    console.error('Earnings reminders page error:', error);
    res.status(500).send('Error loading earnings reminders');
  }
});

router.get('/api/earnings-reminders/search', async (req, res) => {
  try {
    const q = String(req.query.q || '');
    const results = await earningsReminders.searchEarningsReminderSymbols(q, 12);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/earnings-reminders/:symbol', async (req, res) => {
  try {
    const details = await earningsReminders.getEarningsReminderDetails(req.params.symbol);
    if (!details) {
      res.status(404).json({ error: 'No upcoming earnings found for symbol' });
      return;
    }
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/earnings-reminders/:symbol/preview', async (req, res) => {
  try {
    const preview = await earningsReminders.buildLiveReminderPreview(req.params.symbol);
    if (!preview) {
      res.status(404).json({ error: 'No upcoming earnings found for symbol' });
      return;
    }
    res.json(preview);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/options-analyzer', async (req, res) => {
  try {
    const runs = await db.getRecentOptionsAnalysisRuns(12);
    res.send(generateOptionsAnalyzerHTML(runs, req.query || {}));
  } catch (error) {
    console.error('Options analyzer page error:', error);
    res.status(500).send('Error loading options analyzer');
  }
});

router.post('/api/options-analyzer', async (req, res) => {
  try {
    const optionsAnalyzer = (await import('./options-analyzer.js')).default;
    const result = await optionsAnalyzer.analyzeSymbol(req.body || {});
    res.json({ success: true, result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/api/earnings-reminders/save', async (req, res) => {
  try {
    const reminder = await earningsReminders.saveEarningsReminder(req.body || {});
    res.json({ success: true, reminder });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

function generateDashboardHTML(analyses, positions, trades, snapshot, dailyState = [], promotedDiscovery = [], todaysApprovals = []) {
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
    .position-management-cell {
      min-width: 230px;
    }
    .position-summary-note {
      color: #8b93b5;
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
    .nav-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
      margin: 22px 0 28px;
    }
    .nav-card {
      display: block;
      text-decoration: none;
      color: white;
      padding: 16px 18px;
      border-radius: 12px;
      border: 1px solid #2a2f4a;
      background: #1a1f3a;
      transition: transform 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
    }
    .nav-card:hover {
      transform: translateY(-1px);
      border-color: #46507a;
      opacity: 0.96;
    }
    .nav-card-title {
      font-weight: 700;
      font-size: 1rem;
      margin-bottom: 6px;
      color: #fff;
    }
    .nav-card-copy {
      color: #94a3b8;
      font-size: 0.88rem;
      line-height: 1.45;
    }
    .nav-card.approvals { background: linear-gradient(135deg, rgba(245, 158, 11, 0.18) 0%, rgba(217, 119, 6, 0.14) 100%); }
    .nav-card.adhoc { background: linear-gradient(135deg, rgba(16, 185, 129, 0.18) 0%, rgba(5, 150, 105, 0.14) 100%); }
    .nav-card.options { background: linear-gradient(135deg, rgba(6, 182, 212, 0.18) 0%, rgba(15, 118, 110, 0.14) 100%); }
    .nav-card.predictor { background: linear-gradient(135deg, rgba(236, 72, 153, 0.18) 0%, rgba(190, 24, 93, 0.14) 100%); }
    .nav-card.cron { background: linear-gradient(135deg, rgba(139, 92, 246, 0.18) 0%, rgba(109, 40, 217, 0.14) 100%); }
    .timestamp {
      color: #666;
      font-size: 0.85rem;
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
    .detail-block strong {
      color: #fff;
    }
    .compact-trade-card {
      background: #11182b;
      border: 1px solid #2a2f4a;
      border-left-width: 4px;
      border-radius: 8px;
      padding: 14px 16px;
      margin: 14px 0;
    }
    .compact-trade-card.buy { border-left-color: #10b981; }
    .compact-trade-card.short { border-left-color: #ef4444; }
    .compact-trade-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .compact-trade-title {
      font-weight: 700;
      color: #fff;
      font-size: 1rem;
    }
    .compact-trade-badge {
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 4px 8px;
      border-radius: 999px;
      background: rgba(102, 126, 234, 0.15);
      color: #a5b4fc;
    }
    .compact-trade-metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 10px;
    }
    .compact-trade-metric-label {
      color: #8b93b5;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 4px;
    }
    .compact-trade-metric-value {
      color: #e5e7eb;
      font-weight: 600;
      word-break: break-word;
    }
    .phase4-section {
      background: #0f1425;
      border: 1px solid #2a2f4a;
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
    }
    .phase4-section-title {
      color: #fff;
      font-weight: 700;
      margin-bottom: 10px;
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin: 10px 0 16px;
    }
    .metric-card {
      background: #11182b;
      border: 1px solid #2a2f4a;
      border-radius: 8px;
      padding: 12px;
    }
    .metric-label {
      color: #8b93b5;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 6px;
    }
    .metric-value {
      color: #fff;
      font-weight: 600;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .detail-section {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid #2a2f4a;
    }
    .detail-section-title {
      color: #fff;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .detail-section-body {
      color: #d0d0d0;
      line-height: 1.6;
    }
    .detail-list {
      margin: 0 0 0 18px;
      padding: 0;
    }
    .detail-list li {
      margin-bottom: 6px;
    }
    .detail-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .detail-chip, .news-link {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      padding: 6px 10px;
      border-radius: 999px;
      background: #11182b;
      border: 1px solid #2a2f4a;
      color: #cbd5e1;
      text-decoration: none;
      font-size: 0.9rem;
      word-break: break-all;
    }
    .news-link:hover {
      border-color: #667eea;
      color: #fff;
    }
    .override-banner {
      background: rgba(245, 158, 11, 0.14);
      border: 1px solid rgba(245, 158, 11, 0.35);
      border-radius: 8px;
      padding: 12px 14px;
      margin-bottom: 15px;
    }
    .override-label {
      color: #fbbf24;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .reasoning-copy {
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🥃 Whiskie Dashboard</h1>
    <p class="subtitle">AI-Powered Portfolio Manager • Paper Trading Mode</p>

    <button class="refresh-btn" onclick="location.reload()">🔄 Refresh</button>
    <button class="analyze-btn" onclick="triggerAnalysis()" id="analyzeBtn">🤖 Analyze Now</button>

    <div class="nav-grid">
      <a href="/approvals" class="nav-card approvals" id="approvalsBtn">
        <div class="nav-card-title">⚖️ Trade Approvals</div>
        <div class="nav-card-copy">Review queued trades before execution.</div>
      </a>
      <a href="/adhoc-analyzer" class="nav-card adhoc">
        <div class="nav-card-title">🔍 Adhoc Analyzer</div>
        <div class="nav-card-copy">Run one-off stock analysis outside the scheduled flow.</div>
      </a>
      <a href="/options-analyzer" class="nav-card options">
        <div class="nav-card-title">🧩 Options Analyzer</div>
        <div class="nav-card-copy">Analyze standard and earnings-mode options setups.</div>
      </a>
      <a href="/earnings-reminders" class="nav-card predictor">
        <div class="nav-card-title">⏰ Earnings Predictor</div>
        <div class="nav-card-copy">Track upcoming earnings, predictor context, and launch earnings options mode.</div>
      </a>
      <a href="/cron-status" class="nav-card cron">
        <div class="nav-card-title">⏰ Cron Jobs</div>
        <div class="nav-card-copy">Inspect schedules, run history, and manual job triggers.</div>
      </a>
    </div>

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
          let htmlContent;
          if (a.decision_type === 'deep-analysis') {
            const relatedApprovals = todaysApprovals.filter(row => row.decision_run_id && row.decision_run_id === a.run_id);
            const executableTradesHtml = renderExecutableTradesFromApprovals(relatedApprovals, cleanedRecommendation);
            htmlContent = `${executableTradesHtml}${renderPhase4Analysis(cleanedRecommendation)}`;
          } else {
            htmlContent = markdownToHtml(cleanedRecommendation);
          }
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
      <div class="section-title">🧠 Daily Symbol State</div>
      ${dailyState.length === 0 ?
        '<div class="no-data">No daily symbol state recorded yet for today.</div>' :
        `<table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Run</th>
              <th>Depth</th>
              <th>Reason</th>
              <th>Source</th>
              <th>Pathway Model</th>
              <th>What Changed</th>
              <th>Next Review</th>
            </tr>
          </thead>
          <tbody>
            ${dailyState.map(state => `
              <tr>
                <td><strong>${escapeHtml(state.symbol)}</strong></td>
                <td>${escapeHtml(`${state.run_time || '-'} / ${state.run_type || '-'}`)}</td>
                <td>${escapeHtml(state.review_depth || '-')}</td>
                <td>${escapeHtml(state.review_reason_code || state.escalation_reason || '-')}</td>
                <td>${escapeHtml(state.source || '-')}</td>
                <td>${escapeHtml(state.primary_pathway || '-')}</td>
                <td>${escapeHtml(state.what_changed || '-')}</td>
                <td>${escapeHtml(formatDashboardDateTime(state.next_review_due))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`
      }
    </div>

    <div class="section">
      <div class="section-title">🚀 Promoted Discovery Candidates</div>
      ${promotedDiscovery.length === 0 ?
        '<div class="no-data">No promoted discovery candidates right now.</div>' :
        `<table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Pathway</th>
              <th>Score</th>
              <th>Selection Source</th>
              <th>Promotion Reason</th>
              <th>Promoted At</th>
            </tr>
          </thead>
          <tbody>
            ${promotedDiscovery.map(row => `
              <tr>
                <td><strong>${escapeHtml(row.symbol)}</strong></td>
                  <td>${escapeHtml(row.primary_pathway || row.pathway || '-')}<br><span class="timestamp">secondary: ${escapeHtml(((row.secondary_pathways || []).join(', ')) || 'none')}</span></td>
                <td>${escapeHtml(row.score ?? '-')}</td>
                <td>${escapeHtml(row.selection_source || row.source || '-')}</td>
                <td title="${escapeHtml(row.reasons || '')}">${escapeHtml(row.promotion_reason || '-')}</td>
                <td>${escapeHtml(formatDashboardDateTime(row.promoted_at))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`
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
              <th>Pathway Model</th>
              <th>Intent</th>
              <th>Management</th>
              <th>Stop Loss</th>
              <th>Take Profit</th>
              <th>Rebalance</th>
              <th>Trail</th>
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
                  <td>${escapeHtml(p.pathway || '-')}<br><span class="timestamp">secondary: ${escapeHtml(((p.secondary_pathways || []).join(', ')) || 'none')}</span></td>
                  <td>${p.intent || '-'}</td>
                  <td class="position-management-cell">${renderPositionManagementPills(p)}</td>
                  <td>${stopLoss ? '$' + stopLoss.toFixed(2) : '-'}</td>
                  <td>${takeProfit ? '$' + takeProfit.toFixed(2) : (p.target_type === 'flexible_fundamental' ? 'Flexible' : '-')}</td>
                  <td>${p.rebalance_threshold_pct ? p.rebalance_threshold_pct + '%' : '-'}</td>
                  <td>${p.trailing_stop_pct ? p.trailing_stop_pct + '%' : '-'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
        <div class="position-summary-note">Flexible fundamental targets show as <strong>Flexible</strong> instead of a fixed take-profit so the UI matches thesis-driven management.</div>`
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

function generateOptionsAnalyzerHTML(runs = [], query = {}) {
  const safeRuns = runs.map(run => ({
    ...run,
    result_payload: typeof run.result_payload === 'string' ? JSON.parse(run.result_payload) : run.result_payload
  }));
  const prefillSymbol = escapeHtml(query.symbol || '');
  const prefillHorizon = escapeHtml(query.intentHorizon || 'short_term');
  const prefillEventMode = escapeHtml(query.eventMode || '');
  const prefillEarningsDate = escapeHtml(query.earningsDate || '');
  const prefillEarningsSession = escapeHtml(query.earningsSession || '');

  return `
<!DOCTYPE html>
<html>
<head>
  <title>Options Analyzer - Whiskie</title>
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
      font-size: 2.4rem;
      margin-bottom: 10px;
      background: linear-gradient(135deg, #22d3ee 0%, #0f766e 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle { color: #94a3b8; margin-bottom: 24px; }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
    .btn-link {
      display: inline-block;
      padding: 12px 20px;
      border-radius: 8px;
      text-decoration: none;
      color: white;
      font-weight: 600;
      background: linear-gradient(135deg, #334155 0%, #1e293b 100%);
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(320px, 420px) 1fr;
      gap: 24px;
      align-items: start;
    }
    .panel {
      background: #11182b;
      border: 1px solid #22304f;
      border-radius: 14px;
      padding: 20px;
    }
    .panel h2 {
      font-size: 1.2rem;
      margin-bottom: 14px;
      color: #f8fafc;
    }
    .form-row { margin-bottom: 16px; }
    .form-row label {
      display: block;
      margin-bottom: 6px;
      color: #cbd5e1;
      font-weight: 600;
    }
    .form-row input, .form-row select {
      width: 100%;
      background: #0f172a;
      color: #e2e8f0;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 12px;
      font-size: 0.95rem;
    }
    .submit-btn {
      width: 100%;
      border: none;
      border-radius: 10px;
      padding: 14px 16px;
      font-size: 1rem;
      font-weight: 700;
      color: white;
      cursor: pointer;
      background: linear-gradient(135deg, #06b6d4 0%, #0f766e 100%);
    }
    .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .note, .rule-card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 10px;
      padding: 14px;
      color: #cbd5e1;
      margin-top: 14px;
    }
    .status {
      display: none;
      margin-bottom: 16px;
      padding: 12px 14px;
      border-radius: 10px;
      font-weight: 600;
    }
    .status.info { display: block; background: rgba(8, 145, 178, 0.18); color: #67e8f9; }
    .status.error { display: block; background: rgba(239, 68, 68, 0.18); color: #fca5a5; }
    .status.success { display: block; background: rgba(16, 185, 129, 0.18); color: #86efac; }
    .results-stack { display: grid; gap: 16px; }
    .result-card {
      background: #11182b;
      border: 1px solid #22304f;
      border-radius: 14px;
      padding: 18px;
    }
    .result-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .result-title { font-size: 1.2rem; font-weight: 700; color: #f8fafc; }
    .muted { color: #94a3b8; font-size: 0.92rem; }
    .pill-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .pill {
      display: inline-flex;
      padding: 6px 10px;
      border-radius: 999px;
      background: #0f172a;
      border: 1px solid #334155;
      color: #cbd5e1;
      font-size: 0.88rem;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin: 14px 0;
    }
    .metric {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 10px;
      padding: 12px;
    }
    .metric-label {
      color: #94a3b8;
      font-size: 0.76rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 6px;
    }
    .metric-value { color: #f8fafc; font-weight: 700; }
    .section-title {
      color: #f8fafc;
      font-size: 0.95rem;
      font-weight: 700;
      margin: 16px 0 8px;
    }
    ul { margin-left: 18px; color: #cbd5e1; }
    li { margin-bottom: 6px; }
    .strategy-card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 14px;
      margin-top: 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 0.9rem;
    }
    th, td {
      text-align: left;
      padding: 10px 8px;
      border-bottom: 1px solid #22304f;
    }
    th { color: #94a3b8; font-size: 0.78rem; text-transform: uppercase; }
    code {
      background: #020617;
      border: 1px solid #1e293b;
      padding: 2px 6px;
      border-radius: 6px;
    }
    @media (max-width: 980px) {
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Options Analyzer</h1>
    <p class="subtitle">Intent-aware options and equity recommendation engine with liquidity guardrails.</p>

    <div class="actions">
      <a class="btn-link" href="/">← Back to Dashboard</a>
    </div>

    <div class="grid">
      <div class="panel">
        <h2>Run Analysis</h2>
        <div id="status" class="status"></div>
        <form id="optionsAnalyzerForm">
          <div class="form-row">
            <label for="symbol">Symbol</label>
            <input id="symbol" name="symbol" placeholder="AAPL" maxlength="10" value="${prefillSymbol}" required />
          </div>
          <div class="form-row">
            <label for="intentHorizon">Intent horizon</label>
            <select id="intentHorizon" name="intentHorizon" required>
              <option value="short_term" ${prefillHorizon === 'short_term' ? 'selected' : ''}>Short term (2-6 weeks)</option>
              <option value="medium_term" ${prefillHorizon === 'medium_term' ? 'selected' : ''}>Medium term (2-4 months)</option>
              <option value="long_term" ${prefillHorizon === 'long_term' ? 'selected' : ''}>Long term (6-18 months)</option>
            </select>
          </div>
          <div class="form-row">
            <label for="capital">Capital budget (optional)</label>
            <input id="capital" name="capital" type="number" min="0" step="0.01" placeholder="2500" />
          </div>
          <input id="eventMode" name="eventMode" type="hidden" value="${prefillEventMode}" />
          <button id="submitBtn" class="submit-btn" type="submit">Analyze Symbol</button>
        </form>

        <div class="rule-card">
          <strong>Strike selection rules</strong>
          <ul>
            <li>Calls stay roughly within 20% below to 25% above spot.</li>
            <li>Puts stay roughly within 25% below to 20% above spot.</li>
            <li>Wide spreads, low OI, and low volume reject contracts before ranking.</li>
            <li>If options are inefficient, the engine can recommend shares or no trade.</li>
          </ul>
        </div>

        ${prefillEventMode === 'earnings' ? `
          <div class="rule-card" style="border-color:#0ea5e9;">
            <strong>Earnings mode</strong>
            <ul>
              <li>Launched from Earnings Predictor with event-driven context.</li>
              <li>Earnings date: <code>${prefillEarningsDate || 'unknown'}</code></li>
              <li>Earnings session: <code>${prefillEarningsSession || 'unknown'}</code></li>
              <li>This mode is higher risk and may surface event-driven structures that standard mode blocks.</li>
            </ul>
          </div>
        ` : ''}

        <div class="note">
          The analyzer uses Opus for directional thesis formation, then applies deterministic contract filtering and ranking from Tradier option chains.
        </div>
      </div>

      <div class="panel">
        <h2>Recent Runs</h2>
        <div id="results" class="results-stack">
          ${safeRuns.length ? safeRuns.map(run => renderOptionsRun(run.result_payload, run.created_at)).join('') : '<div class="muted">No options analysis runs yet.</div>'}
        </div>
      </div>
    </div>
  </div>

  <script>
    const form = document.getElementById('optionsAnalyzerForm');
    const statusEl = document.getElementById('status');
    const resultsEl = document.getElementById('results');
    const submitBtn = document.getElementById('submitBtn');

    function setStatus(type, message) {
      statusEl.className = 'status ' + type;
      statusEl.textContent = message;
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function renderList(items) {
      if (!items || !items.length) return '<div class="muted">None</div>';
      return '<ul>' + items.map(item => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul>';
    }

    function renderStrategies(strategies) {
      if (!strategies || !strategies.length) return '<div class="muted">No option candidates passed the guardrails.</div>';
      return strategies.map(strategy => {
        const rows = (strategy.candidates || []).slice(0, 3).map(candidate => \`
          <tr>
            <td>\${escapeHtml(candidate.symbol || '-')}</td>
            <td>\${escapeHtml(candidate.expiration || '-')}</td>
            <td>$\${Number(candidate.strike || 0).toFixed(2)}</td>
            <td>$\${Number(candidate.bid || 0).toFixed(2)} / $\${Number(candidate.ask || 0).toFixed(2)}</td>
            <td>\${Number(candidate.delta || 0).toFixed(2)}</td>
            <td>\${Number(candidate.openInterest || 0)}</td>
            <td>\${Number(candidate.score || 0).toFixed(2)}</td>
          </tr>
        \`).join('');

        return \`
          <div class="strategy-card">
            <div class="result-title">\${escapeHtml(strategy.strategyType || 'Strategy')}</div>
            <div class="muted">\${escapeHtml(strategy.rationale || '')}</div>
            <div class="pill-row" style="margin-top:8px;">
              <span class="pill">Strike window: \${escapeHtml(strategy.strikeTolerance?.minStrike ?? '-')} to \${escapeHtml(strategy.strikeTolerance?.maxStrike ?? '-')}</span>
              <span class="pill">\${escapeHtml(strategy.strikeTolerance?.toleranceLabel || '')}</span>
            </div>
            \${rows ? '<table><thead><tr><th>Contract</th><th>Expiry</th><th>Strike</th><th>Bid / Ask</th><th>Delta</th><th>OI</th><th>Score</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<div class="muted" style="margin-top:10px;">No ranked candidates shown.</div>'}
          </div>
        \`;
      }).join('');
    }

    function renderRun(result, createdAt) {
      const recommendation = result?.recommendation || {};
      const context = result?.symbolContext || {};
      const sentiment = result?.optionsSentiment || {};
      return \`
        <div class="result-card">
          <div class="result-header">
            <div>
              <div class="result-title">\${escapeHtml(result?.symbol || '-')} • \${escapeHtml(result?.horizonLabel || '-')}</div>
              <div class="muted">\${escapeHtml(createdAt ? new Date(createdAt).toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET' : 'Just now')}</div>
            </div>
            <div class="pill-row">
              <span class="pill">Direction: \${escapeHtml(result?.directionCall || '-')}</span>
              <span class="pill">Conviction: \${escapeHtml(result?.conviction || '-')}</span>
              <span class="pill">Recommendation: \${escapeHtml(recommendation.type || '-')}</span>
            </div>
          </div>
          <div class="metrics">
            <div class="metric"><div class="metric-label">Underlying Price</div><div class="metric-value">$\${Number(context.price || 0).toFixed(2)}</div></div>
            <div class="metric"><div class="metric-label">Strategy</div><div class="metric-value">\${escapeHtml(recommendation.strategyType || 'None')}</div></div>
            <div class="metric"><div class="metric-label">ATM IV</div><div class="metric-value">\${escapeHtml(sentiment.atmImpliedVolatility ?? '-')}%</div></div>
            <div class="metric"><div class="metric-label">Put/Call Vol Ratio</div><div class="metric-value">\${escapeHtml(sentiment.putCallVolumeRatio ?? '-')}</div></div>
          </div>
          <div class="section-title">Thesis</div>
          <div class="muted">\${escapeHtml(result?.thesisSummary || '')}</div>
          <div class="section-title">Recommendation Reason</div>
          <div class="muted">\${escapeHtml(recommendation.reason || '')}</div>
          <div class="section-title">Catalysts</div>
          <div class="pill-row">
            \${(result?.catalysts?.nearTerm || []).map(item => '<span class="pill">' + escapeHtml(item) + '</span>').join('')}
            \${(result?.catalysts?.midTerm || []).map(item => '<span class="pill">' + escapeHtml(item) + '</span>').join('')}
            \${(result?.catalysts?.longTerm || []).map(item => '<span class="pill">' + escapeHtml(item) + '</span>').join('')}
          </div>
          <div class="section-title">Warnings</div>
          \${renderList(result?.warnings || [])}
          <div class="section-title">Guardrails</div>
          \${renderList(result?.guardrails || [])}
          <div class="section-title">Candidate Strategies</div>
          \${renderStrategies(result?.candidateStrategies || [])}
        </div>
      \`;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submitBtn.disabled = true;
      setStatus('info', 'Running options analysis. This may take up to a minute.');

      const payload = {
        symbol: document.getElementById('symbol').value.trim().toUpperCase(),
        intentHorizon: document.getElementById('intentHorizon').value,
        capital: document.getElementById('capital').value ? Number(document.getElementById('capital').value) : null,
        eventMode: document.getElementById('eventMode').value || null
      };

      try {
        const response = await fetch('/api/options-analyzer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Analysis failed');
        }

        setStatus('success', 'Analysis complete.');
        const card = renderRun(data.result, new Date().toISOString());
        if (resultsEl.querySelector('.muted')) resultsEl.innerHTML = '';
        resultsEl.insertAdjacentHTML('afterbegin', card);
      } catch (error) {
        setStatus('error', error.message);
      } finally {
        submitBtn.disabled = false;
      }
    });
  </script>
</body>
</html>
  `;
}

function renderOptionsRun(result, createdAt) {
  const recommendation = result?.recommendation || {};
  const sentiment = result?.optionsSentiment || {};
  const context = result?.symbolContext || {};
  const catalysts = [
    ...(result?.catalysts?.nearTerm || []),
    ...(result?.catalysts?.midTerm || []),
    ...(result?.catalysts?.longTerm || [])
  ];

  return `
    <div class="result-card">
      <div class="result-header">
        <div>
          <div class="result-title">${escapeHtml(result?.symbol || '-')} • ${escapeHtml(result?.horizonLabel || '-')}</div>
          <div class="muted">${escapeHtml(formatDashboardDateTime(createdAt))}</div>
        </div>
        <div class="pill-row">
          <span class="pill">Direction: ${escapeHtml(result?.directionCall || '-')}</span>
          <span class="pill">Conviction: ${escapeHtml(result?.conviction || '-')}</span>
          <span class="pill">Recommendation: ${escapeHtml(recommendation.type || '-')}</span>
        </div>
      </div>
      <div class="metrics">
        <div class="metric"><div class="metric-label">Underlying Price</div><div class="metric-value">$${escapeHtml(Number(context.price || 0).toFixed(2))}</div></div>
        <div class="metric"><div class="metric-label">Strategy</div><div class="metric-value">${escapeHtml(recommendation.strategyType || 'None')}</div></div>
        <div class="metric"><div class="metric-label">ATM IV</div><div class="metric-value">${escapeHtml(sentiment.atmImpliedVolatility ?? '-')}%</div></div>
        <div class="metric"><div class="metric-label">Put/Call OI Ratio</div><div class="metric-value">${escapeHtml(sentiment.putCallOIRatio ?? '-')}</div></div>
      </div>
      <div class="section-title">Thesis</div>
      <div class="muted">${escapeHtml(result?.thesisSummary || '')}</div>
      <div class="section-title">Recommendation Reason</div>
      <div class="muted">${escapeHtml(recommendation.reason || '')}</div>
      <div class="section-title">Catalysts</div>
      ${renderList(catalysts)}
      <div class="section-title">Warnings</div>
      ${renderList(result?.warnings || [])}
    </div>
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
    .detail-block strong {
      color: #fff;
    }
    .compact-trade-card {
      background: #0f1425;
      border: 1px solid #2a2f4a;
      border-left-width: 4px;
      border-radius: 8px;
      padding: 14px 16px;
      margin: 14px 0;
    }
    .compact-trade-card.buy { border-left-color: #10b981; }
    .compact-trade-card.short { border-left-color: #ef4444; }
    .compact-trade-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .compact-trade-title {
      font-weight: 700;
      color: #fff;
      font-size: 1rem;
    }
    .compact-trade-badge {
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 4px 8px;
      border-radius: 999px;
      background: rgba(102, 126, 234, 0.15);
      color: #a5b4fc;
    }
    .compact-trade-metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 10px;
    }
    .compact-trade-metric-label {
      color: #8b93b5;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 4px;
    }
    .compact-trade-metric-value {
      color: #e5e7eb;
      font-weight: 600;
    }
    .phase4-section {
      background: #0f1425;
      border: 1px solid #2a2f4a;
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
    }
    .phase4-section-title {
      color: #fff;
      font-weight: 700;
      margin-bottom: 10px;
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin: 10px 0 16px;
    }
    .metric-card {
      background: #11182b;
      border: 1px solid #2a2f4a;
      border-radius: 8px;
      padding: 12px;
    }
    .metric-label {
      color: #8b93b5;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 6px;
    }
    .metric-value {
      color: #fff;
      font-weight: 600;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .detail-section {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid #2a2f4a;
    }
    .detail-section-title {
      color: #fff;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .detail-section-body {
      color: #d0d0d0;
      line-height: 1.6;
    }
    .detail-list {
      margin: 0 0 0 18px;
      padding: 0;
    }
    .detail-list li {
      margin-bottom: 6px;
    }
    .detail-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .detail-chip, .news-link {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      padding: 6px 10px;
      border-radius: 999px;
      background: #11182b;
      border: 1px solid #2a2f4a;
      color: #cbd5e1;
      text-decoration: none;
      font-size: 0.9rem;
      word-break: break-all;
    }
    .news-link:hover {
      border-color: #667eea;
      color: #fff;
    }
    .override-banner {
      background: rgba(245, 158, 11, 0.14);
      border: 1px solid rgba(245, 158, 11, 0.35);
      border-radius: 8px;
      padding: 12px 14px;
      margin-bottom: 15px;
    }
    .override-label {
      color: #fbbf24;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .reasoning-copy {
      white-space: pre-wrap;
      word-break: break-word;
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
    ` : pending.map(trade => {
      const catalysts = parseListValue(trade.catalysts);
      const newsLinks = parseListValue(trade.news_links);
      const fundamentals = formatStructuredText(trade.fundamentals);
      const technicalSetup = formatStructuredText(trade.technical_setup);
      const riskFactors = formatStructuredText(trade.risk_factors);
      const overrideDecision = normalizeText(trade.override_phase2_decision).toUpperCase();
      const overrideSymbol = normalizeText(trade.override_symbol);
      const overrideReason = normalizeText(trade.override_reason);
      const hasOverride = overrideDecision === 'YES';

      return `
      <div class="trade-card">
        <div class="trade-header">
          <div class="trade-symbol">${escapeHtml(trade.symbol)}</div>
          <div class="trade-action ${trade.action.includes('buy') ? 'action-buy' : 'action-sell'}">
            ${escapeHtml(formatTradeAction(trade.action))}
          </div>
        </div>

        <div class="trade-details">
          <div class="detail-item">
            <div class="detail-label">Quantity</div>
            <div class="detail-value">${escapeHtml(trade.quantity)} shares</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Entry Price</div>
            <div class="detail-value">${formatCurrency(trade.entry_price)}</div>
          </div>
          ${trade.stop_loss ? `
          <div class="detail-item">
            <div class="detail-label">Stop Loss</div>
            <div class="detail-value">${formatCurrency(trade.stop_loss)}</div>
          </div>
          ` : ''}
          ${trade.take_profit ? `
          <div class="detail-item">
            <div class="detail-label">Take Profit</div>
            <div class="detail-value">${formatCurrency(trade.take_profit)}</div>
          </div>
          ` : ''}
          ${trade.pathway ? `
          <div class="detail-item">
            <div class="detail-label">Pathway</div>
            <div class="detail-value">${escapeHtml(trade.pathway)}</div>
          </div>
          ` : ''}
          ${trade.intent ? `
          <div class="detail-item">
            <div class="detail-label">Intent</div>
            <div class="detail-value">${escapeHtml(trade.intent)}</div>
          </div>
          ` : ''}
        </div>

        ${hasOverride ? `
        <div class="override-banner">
          <div class="override-label">Phase 4 Override</div>
          ${renderMetricGrid([
            { label: 'Override Decision', value: overrideDecision || 'YES' },
            { label: 'Replaced Symbol', value: overrideSymbol || 'None' }
          ])}
          ${overrideReason ? `<div class="detail-section-body">${formatStructuredText(overrideReason)}</div>` : ''}
        </div>
        ` : ''}

        <div class="reasoning">
          <strong>Reasoning:</strong><br>
          <div class="reasoning-copy">${escapeHtml(trade.reasoning || '')}</div>
        </div>

        ${(trade.investment_thesis || trade.strategy_type || trade.thesis_state || trade.holding_posture || trade.holding_period || trade.confidence || trade.growth_potential || trade.stop_type || trade.target_type) ? `
        <div class="detail-block">
          <strong>Trade Thesis & Plan</strong>
          ${renderMetricGrid([
            { label: 'Strategy', value: trade.strategy_type },
            { label: 'Thesis State', value: trade.thesis_state },
            { label: 'Holding Posture', value: trade.holding_posture },
            { label: 'Holding Period', value: trade.holding_period },
            { label: 'Confidence', value: trade.confidence },
            { label: 'Growth Potential', value: trade.growth_potential },
            { label: 'Stop Type', value: trade.stop_type },
            { label: 'Target Type', value: trade.target_type },
            { label: 'Trailing Stop %', value: trade.trailing_stop_pct ? `${trade.trailing_stop_pct}%` : '' },
            { label: 'Rebalance Threshold %', value: trade.rebalance_threshold_pct ? `${trade.rebalance_threshold_pct}%` : '' },
            { label: 'Max Hold Days', value: trade.max_holding_days }
          ])}
          ${trade.investment_thesis ? renderDetailSection('Thesis', formatStructuredText(trade.investment_thesis)) : ''}
          ${trade.stop_reason ? renderDetailSection('Stop Reason', formatStructuredText(trade.stop_reason)) : ''}
        </div>
        ` : ''}

        ${(catalysts.length || newsLinks.length || fundamentals || riskFactors || technicalSetup) ? `
        <div class="detail-block">
          <strong>Supporting Detail</strong>
          ${technicalSetup ? renderDetailSection('Technical Setup', technicalSetup) : ''}
          ${riskFactors ? renderDetailSection('Risks', riskFactors) : ''}
          ${fundamentals ? renderDetailSection('Fundamentals', fundamentals) : ''}
          ${catalysts.length ? renderDetailSection('Catalysts', renderList(catalysts)) : ''}
          ${newsLinks.length ? renderDetailSection('News', renderList(newsLinks, 'links')) : ''}
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
    `;
    }).join('')}
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
    { name: 'Portfolio Sync', type: 'manual', schedule: 'Manual only', endpoint: '/api/trigger-portfolio-sync' },
    { name: 'Weekly Earnings Refresh', type: 'weekly', schedule: 'Friday 8:00 PM ET', endpoint: '/api/trigger-weekly-earnings-refresh' },
    { name: 'Earnings Reminder Processor', type: 'daily', schedule: '3:00 PM ET Sun-Thu', endpoint: '/api/trigger-earnings-reminders' },
    { name: 'Stock Universe Refresh', type: 'weekly', schedule: 'Saturday 10:00 AM ET', endpoint: '/api/trigger-stock-universe-refresh' },
    { name: 'Saturday Screening', type: 'weekly', schedule: 'Saturday 3:00 PM ET', endpoint: '/api/trigger-saturday-screening' },
    { name: 'Weekly Portfolio Review', type: 'weekly', schedule: 'Sunday 1:00 PM ET', endpoint: '/api/trigger-weekly-portfolio-review' },
    { name: 'Profile Building', type: 'weekly', schedule: 'Sunday 3:00 PM ET', endpoint: '/api/trigger-profile-build-watchlist' },
    { name: 'Weekly Opus Review', type: 'weekly', schedule: 'Sunday 9:00 PM ET', endpoint: '/api/trigger-weekly-opus-review' },
    { name: 'Weekly Tactical-State Cleanup', type: 'weekly', schedule: 'Sunday 11:00 PM ET', endpoint: '/api/trigger-weekly-tactical-cleanup' }
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
        if (!endpoint) {
          throw new Error('No manual endpoint is configured for this job yet.');
        }
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

function generateEarningsRemindersHTML(reminders) {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Earnings Predictor - Whiskie</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0e27; color: #e0e0e0; padding: 20px; line-height: 1.5; }
    .container { max-width: 1180px; margin: 0 auto; }
    h1 { font-size: 2.3rem; margin-bottom: 10px; color: #fff; }
    .subtitle { color: #94a3b8; margin-bottom: 24px; }
    .back-btn { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 1rem; font-weight: 600; margin-bottom: 20px; text-decoration: none; display: inline-block; }
    .layout { display: grid; grid-template-columns: 420px 1fr; gap: 24px; align-items: start; }
    .panel { background: #1a1f3a; border: 1px solid #2a2f4a; border-radius: 12px; padding: 22px; }
    .panel h2 { margin-bottom: 16px; font-size: 1.25rem; }
    input, textarea, select { width: 100%; background: #0f1425; color: #e0e0e0; border: 1px solid #2a2f4a; border-radius: 8px; padding: 12px; font-size: 0.95rem; }
    textarea { min-height: 140px; resize: vertical; }
    label { display: block; margin: 14px 0 8px; color: #cbd5e1; font-size: 0.92rem; }
    .helper { color: #94a3b8; font-size: 0.85rem; margin-top: 8px; }
    .btn { margin-top: 16px; background: linear-gradient(135deg, #ec4899 0%, #be185d 100%); color: #fff; border: none; border-radius: 8px; padding: 12px 18px; font-weight: 700; cursor: pointer; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .suggestions { margin-top: 10px; border: 1px solid #2a2f4a; border-radius: 10px; overflow: hidden; }
    .suggestion { padding: 12px; background: #0f1425; border-bottom: 1px solid #1f2942; cursor: pointer; }
    .suggestion:last-child { border-bottom: none; }
    .suggestion:hover { background: #151c33; }
    .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .detail-card { background: #0f1425; border: 1px solid #2a2f4a; border-radius: 10px; padding: 12px; }
    .detail-label { color: #94a3b8; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
    .detail-value { color: #fff; font-weight: 700; }
    .summary-box, .notes-box { background: #0f1425; border: 1px solid #2a2f4a; border-radius: 10px; padding: 14px; white-space: pre-wrap; color: #dbe4f0; }
    .markdown-box { background: #0f1425; border: 1px solid #2a2f4a; border-radius: 10px; padding: 14px; color: #dbe4f0; line-height: 1.6; }
    .predictor-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:16px; }
    .predictor-card { background:#0f1425; border:1px solid #2a2f4a; border-radius:10px; padding:14px; }
    .predictor-card .value { font-size:1.35rem; font-weight:800; margin-top:6px; color:#fff; }
    .direction-up { color:#10b981 !important; }
    .direction-down { color:#ef4444 !important; }
    .direction-neutral { color:#f59e0b !important; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px; border-bottom: 1px solid #2a2f4a; vertical-align: top; }
    th { color: #94a3b8; text-transform: uppercase; font-size: 0.82rem; text-align: left; }
    .status-pill { display: inline-block; padding: 4px 10px; border-radius: 999px; background: rgba(236,72,153,0.15); color: #f9a8d4; font-size: 0.8rem; font-weight: 700; }
    .message { margin-top: 12px; font-size: 0.9rem; }
    .message.error { color: #fca5a5; }
    .message.success { color: #86efac; }
    @media (max-width: 980px) { .layout { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>⏰ Earnings Predictor</h1>
    <p class="subtitle">Search upcoming earnings, review catalysts, save one active predictor per symbol, and launch earnings-mode options analysis.</p>
    <a href="/" class="back-btn">← Back to Dashboard</a>

    <div class="layout">
      <div class="panel">
        <h2>Create or Update Predictor</h2>
        <label for="symbolSearch">Search symbol</label>
        <input id="symbolSearch" type="text" placeholder="Type AAPL, NFLX, APP..." autocomplete="off" />
        <div id="suggestions" class="suggestions" style="display:none;"></div>
        <div class="helper">Searches upcoming rows from earnings_calendar.</div>

        <label for="sessionOverride">Session override</label>
        <select id="sessionOverride">
          <option value="">Use detected timing</option>
          <option value="pre_market">Pre-market</option>
          <option value="post_market">Post-market</option>
          <option value="unknown">Unknown</option>
        </select>

        <label for="notes">Notes</label>
        <textarea id="notes" placeholder="Personal notes for the predictor email..."></textarea>

        <button id="saveBtn" class="btn" disabled>Save Predictor</button>
        <button id="earningsOptionsBtn" class="btn" style="display:none; background: linear-gradient(135deg, #06b6d4 0%, #0f766e 100%); margin-left: 10px;">Analyze Earnings Options Setup</button>
        <div id="saveMessage" class="message"></div>
      </div>

      <div class="panel">
        <h2>Selected Earnings Setup</h2>
        <div id="emptyState" class="helper">Pick a symbol to load its next earnings date, timing, latest catalysts, and any existing reminder.</div>
        <div id="details" style="display:none;">
          <div class="detail-grid">
            <div class="detail-card"><div class="detail-label">Symbol</div><div class="detail-value" id="detailSymbol">-</div></div>
            <div class="detail-card"><div class="detail-label">Earnings Date</div><div class="detail-value" id="detailDate">-</div></div>
            <div class="detail-card"><div class="detail-label">Session</div><div class="detail-value" id="detailSession">-</div></div>
            <div class="detail-card"><div class="detail-label">Reminder Time</div><div class="detail-value" id="detailSendAt">-</div></div>
          </div>
          <h3 style="margin-bottom:10px;">Timing Detail</h3>
          <div id="timingRaw" class="summary-box" style="margin-bottom:16px;">-</div>
          <h3 style="margin-bottom:10px;">Catalyst Brief</h3>
          <div id="catalystSummary" class="markdown-box" style="margin-bottom:16px;">-</div>
          <h3 style="margin-bottom:10px;">Live Preview Prediction</h3>
          <div id="predictionState" class="helper" style="margin-bottom:16px;">Loading live preview after symbol selection.</div>
          <div id="predictionPanel" style="display:none;">
            <div class="predictor-grid">
              <div class="predictor-card">
                <div class="detail-label">Direction</div>
                <div id="predictedDirection" class="value">-</div>
              </div>
              <div class="predictor-card">
                <div class="detail-label">Confidence</div>
                <div id="predictedConfidence" class="value">-</div>
              </div>
              <div class="predictor-card">
                <div class="detail-label">Snapshot Price</div>
                <div id="predictorSnapshotPrice" class="value">-</div>
              </div>
            </div>
            <h3 style="margin-bottom:10px;">Prediction Reasoning</h3>
            <div id="predictionReasoning" class="markdown-box" style="margin-bottom:16px;">-</div>
            <h3 style="margin-bottom:10px;">Key Risk</h3>
            <div id="predictionKeyRisk" class="summary-box" style="margin-bottom:16px;">-</div>
          </div>
          <h3 style="margin-bottom:10px;">Last Saved Official Prediction</h3>
          <div id="savedPredictionState" class="helper" style="margin-bottom:16px;">No saved official prediction yet.</div>
          <div id="savedPredictionPanel" style="display:none;">
            <div class="predictor-grid">
              <div class="predictor-card">
                <div class="detail-label">Direction</div>
                <div id="savedPredictedDirection" class="value">-</div>
              </div>
              <div class="predictor-card">
                <div class="detail-label">Confidence</div>
                <div id="savedPredictedConfidence" class="value">-</div>
              </div>
              <div class="predictor-card">
                <div class="detail-label">Snapshot Price</div>
                <div id="savedPredictorSnapshotPrice" class="value">-</div>
              </div>
            </div>
            <h3 style="margin-bottom:10px;">Saved Reasoning</h3>
            <div id="savedPredictionReasoning" class="markdown-box" style="margin-bottom:16px;">-</div>
            <h3 style="margin-bottom:10px;">Saved Key Risk</h3>
            <div id="savedPredictionKeyRisk" class="summary-box" style="margin-bottom:16px;">-</div>
          </div>
          <h3 style="margin-bottom:10px;">Existing Predictor Notes</h3>
          <div id="existingNotes" class="notes-box">None saved yet.</div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:24px;">
      <h2>Active Predictors</h2>
      ${reminders.length === 0 ? '<div class="helper">No active earnings predictors saved yet.</div>' : `
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Earnings Date</th>
            <th>Session</th>
            <th>Pathway Model</th>
            <th>Predictor Time</th>
            <th>Status</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${reminders.map(reminder => `
            <tr>
              <td><strong>${escapeHtml(reminder.symbol)}</strong></td>
              <td>${escapeHtml(reminder.earnings_date)}</td>
              <td>${escapeHtml(formatDashboardSession(reminder.earnings_session || reminder.session_normalized || 'unknown'))}</td>
              <td>${escapeHtml(reminder.primary_pathway || '-')}<br><span class="timestamp">secondary: ${escapeHtml(((reminder.secondary_pathways || []).join(', ')) || 'none')}</span></td>
              <td>${escapeHtml(formatDashboardDateTime(reminder.scheduled_send_at))}</td>
              <td><span class="status-pill">${escapeHtml(reminder.status)}</span></td>
              <td>${escapeHtml((reminder.notes || '').slice(0, 140) || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`}
    </div>
  </div>

  <script>
    function formatDashboardSession(value) {
      const normalized = String(value || '').trim().toLowerCase();
      if (!normalized) return 'Unknown';
      if (normalized === 'bmo' || normalized === 'pre_market') return 'Pre-market';
      if (normalized === 'amc' || normalized === 'post_market') return 'Post-market';
      return normalized
        .replace(/_/g, ' ')
        .replace(/\\b\\w/g, char => char.toUpperCase());
    }

    const searchInput = document.getElementById('symbolSearch');
    const suggestionsEl = document.getElementById('suggestions');
    const detailsEl = document.getElementById('details');
    const emptyStateEl = document.getElementById('emptyState');
    const notesEl = document.getElementById('notes');
    const sessionOverrideEl = document.getElementById('sessionOverride');
    const saveBtn = document.getElementById('saveBtn');
    const saveMessageEl = document.getElementById('saveMessage');
    const earningsOptionsBtn = document.getElementById('earningsOptionsBtn');
    let selectedSymbol = null;
    let currentDetails = null;

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function renderMarkdownLike(text) {
      const normalized = String(text || '').trim();
      if (!normalized) return 'No content available.';
      return normalized
        .split('\\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => '<div style=\"margin-bottom:8px;\">' + escapeHtml(line) + '</div>')
        .join('');
    }

    function renderReasoningList(text) {
      const items = String(text || '')
        .split('\\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.replace(/^[-•]\\s*/, ''));
      if (!items.length) return 'No prediction reasoning available.';
      return '<ul style=\"margin:0; padding-left:18px;\">' + items.map(item => '<li style=\"margin-bottom:6px;\">' + escapeHtml(item) + '</li>').join('') + '</ul>';
    }

    function formatIsoDate(value) {
      if (!value) return '-';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    }

    async function loadPreview(symbol) {
      document.getElementById('predictionState').style.display = 'block';
      document.getElementById('predictionPanel').style.display = 'none';
      document.getElementById('predictionState').textContent = 'Loading live preview...';

      try {
        const response = await fetch('/api/earnings-reminders/' + encodeURIComponent(symbol) + '/preview');
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load live preview');
        }

        const preview = payload.preview || {};
        const directionEl = document.getElementById('predictedDirection');
        const direction = String(preview.direction || 'unknown').toUpperCase();
        directionEl.textContent = direction;
        directionEl.className = 'value ' + (direction === 'UP' ? 'direction-up' : direction === 'DOWN' ? 'direction-down' : 'direction-neutral');
        document.getElementById('predictedConfidence').textContent = String(preview.confidence || 'unknown').toUpperCase();
        document.getElementById('predictorSnapshotPrice').textContent = payload.currentPrice ? '$' + Number(payload.currentPrice).toFixed(2) : '-';
        document.getElementById('predictionReasoning').innerHTML = renderReasoningList(preview.reasoning || '');
        document.getElementById('predictionKeyRisk').textContent = preview.keyRisk || 'No key risk recorded.';
        document.getElementById('catalystSummary').innerHTML = renderReasoningList(payload.catalystBrief || '');
        document.getElementById('predictionState').style.display = 'none';
        document.getElementById('predictionPanel').style.display = 'block';
      } catch (error) {
        document.getElementById('predictionState').textContent = error.message;
      }
    }

    function setMessage(text, type = '') {
      saveMessageEl.textContent = text || '';
      saveMessageEl.className = 'message' + (type ? ' ' + type : '');
    }

    async function searchSymbols(query) {
      if (!query || query.trim().length < 1) {
        suggestionsEl.style.display = 'none';
        suggestionsEl.innerHTML = '';
        return;
      }

      const response = await fetch('/api/earnings-reminders/search?q=' + encodeURIComponent(query));
      const results = await response.json();

      if (!Array.isArray(results) || results.length === 0) {
        suggestionsEl.style.display = 'none';
        suggestionsEl.innerHTML = '';
        return;
      }

      suggestionsEl.innerHTML = results.map(item => {
        const session = formatDashboardSession(item.session_normalized || item.earnings_time || 'unknown');
        return '<div class="suggestion" data-symbol="' + item.symbol + '">' +
          '<strong>' + item.symbol + '</strong> · ' + formatIsoDate(item.earnings_date) + ' · ' + session +
          '</div>';
      }).join('');
      suggestionsEl.style.display = 'block';
    }

    async function loadSymbol(symbol) {
      setMessage('');
      const response = await fetch('/api/earnings-reminders/' + encodeURIComponent(symbol));
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load symbol details');
      }

      selectedSymbol = symbol;
      currentDetails = payload;
      saveBtn.disabled = false;
      earningsOptionsBtn.style.display = 'inline-block';
      detailsEl.style.display = 'block';
      emptyStateEl.style.display = 'none';
      suggestionsEl.style.display = 'none';
      searchInput.value = symbol;

      document.getElementById('detailSymbol').textContent = payload.symbol;
      document.getElementById('detailDate').textContent = payload.timing.earningsDate || payload.nextEarning.earnings_date;
      document.getElementById('detailSession').textContent = formatDashboardSession(payload.timing.earningsSession || payload.nextEarning.session_normalized || 'unknown');
      const scheduled = payload.scheduledSendAt ? new Date(payload.scheduledSendAt) : null;
      document.getElementById('detailSendAt').textContent = scheduled && !Number.isNaN(scheduled.getTime())
        ? scheduled.toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET'
        : '-';
      document.getElementById('timingRaw').textContent = payload.timing.earningsTimeRaw || 'No Yahoo timing detail found.';
      document.getElementById('catalystSummary').innerHTML = renderMarkdownLike('Loading catalyst brief...');
      document.getElementById('existingNotes').textContent = payload.reminder?.notes || 'None saved yet.';
      notesEl.value = payload.reminder?.notes || '';
      sessionOverrideEl.value = '';

      const hasSavedPrediction = payload.reminder?.predicted_direction || payload.reminder?.prediction_reasoning;
      document.getElementById('savedPredictionState').style.display = hasSavedPrediction ? 'none' : 'block';
      document.getElementById('savedPredictionPanel').style.display = hasSavedPrediction ? 'block' : 'none';

      if (hasSavedPrediction) {
        const directionEl = document.getElementById('savedPredictedDirection');
        const direction = String(payload.reminder?.predicted_direction || 'unknown').toUpperCase();
        directionEl.textContent = direction;
        directionEl.className = 'value ' + (direction === 'UP' ? 'direction-up' : direction === 'DOWN' ? 'direction-down' : 'direction-neutral');
        document.getElementById('savedPredictedConfidence').textContent = String(payload.reminder?.predicted_confidence || 'unknown').toUpperCase();
        document.getElementById('savedPredictorSnapshotPrice').textContent = payload.reminder?.predictor_snapshot_price ? '$' + Number(payload.reminder.predictor_snapshot_price).toFixed(2) : '-';
        document.getElementById('savedPredictionReasoning').innerHTML = renderReasoningList(payload.reminder?.prediction_reasoning || '');
        document.getElementById('savedPredictionKeyRisk').textContent = payload.reminder?.prediction_key_risk || 'No key risk recorded.';
      }

      await loadPreview(symbol);
    }

    searchInput.addEventListener('input', async (event) => {
      try {
        await searchSymbols(event.target.value);
      } catch (error) {
        setMessage(error.message, 'error');
      }
    });

    suggestionsEl.addEventListener('click', async (event) => {
      const target = event.target.closest('[data-symbol]');
      if (!target) return;
      try {
        await loadSymbol(target.dataset.symbol);
      } catch (error) {
        setMessage(error.message, 'error');
      }
    });

    saveBtn.addEventListener('click', async () => {
      if (!selectedSymbol || !currentDetails) return;

      saveBtn.disabled = true;
      setMessage('Saving predictor...');

      try {
        const response = await fetch('/api/earnings-reminders/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: selectedSymbol,
            notes: notesEl.value,
            earningsSession: sessionOverrideEl.value || undefined
          })
        });
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Failed to save predictor');
        }

        setMessage('Predictor saved successfully.', 'success');
        await loadSymbol(selectedSymbol);
        setTimeout(() => location.reload(), 800);
      } catch (error) {
        setMessage(error.message, 'error');
      } finally {
        saveBtn.disabled = false;
      }
    });

    earningsOptionsBtn.addEventListener('click', () => {
      if (!currentDetails?.earningsOptionsMode) return;
      const params = new URLSearchParams({
        symbol: currentDetails.earningsOptionsMode.symbol,
        intentHorizon: currentDetails.earningsOptionsMode.intentHorizon,
        eventMode: currentDetails.earningsOptionsMode.eventMode,
        earningsDate: currentDetails.earningsOptionsMode.earningsDate || '',
        earningsSession: currentDetails.earningsOptionsMode.earningsSession || ''
      });
      window.location.href = '/options-analyzer?' + params.toString();
    });
  </script>
</body>
</html>
  `;
}

function formatDashboardDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return `${date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })} ET`;
}

export default router;
