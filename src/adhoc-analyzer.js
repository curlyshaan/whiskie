import express from 'express';
import * as db from './db.js';
import claude, { MODELS } from './claude.js';
import fmp from './fmp.js';
import tradier from './tradier.js';
import tavily from './tavily.js';
import { researchCatalysts } from './catalyst-research.js';
import stockProfiles from './stock-profiles.js';

const router = express.Router();

/**
 * AdhocAnalyzer - Manual stock analysis tool
 * Analyzes any stock with Opus extended thinking
 */

/**
 * Main analyzer page
 */
router.get('/', async (req, res) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Adhoc Analyzer - Whiskie</title>
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
    .container { max-width: 1200px; margin: 0 auto; }
    h1 {
      color: #667eea;
      margin-bottom: 10px;
      font-size: 2rem;
    }
    .subtitle {
      color: #9ca3af;
      margin-bottom: 30px;
      font-size: 0.95rem;
    }
    .form-card {
      background: #1a1f3a;
      border-radius: 12px;
      padding: 30px;
      margin-bottom: 30px;
      border: 1px solid #2a2f4a;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      color: #9ca3af;
      margin-bottom: 8px;
      font-size: 0.9rem;
      font-weight: 500;
    }
    input, select {
      width: 100%;
      padding: 12px;
      background: #0f1425;
      border: 1px solid #2a2f4a;
      border-radius: 8px;
      color: #e0e0e0;
      font-size: 1rem;
    }
    input:focus, select:focus {
      outline: none;
      border-color: #667eea;
    }
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    .required { color: #ef4444; }
    button {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 14px 32px;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }
    button:hover {
      transform: translateY(-2px);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .loading {
      display: none;
      text-align: center;
      padding: 40px;
      color: #667eea;
    }
    .loading.active { display: block; }
    .spinner {
      border: 3px solid #2a2f4a;
      border-top: 3px solid #667eea;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    #results {
      display: none;
    }
    #results.active { display: block; }
    .result-section {
      background: #1a1f3a;
      border-radius: 12px;
      padding: 25px;
      margin-bottom: 20px;
      border: 1px solid #2a2f4a;
    }
    .result-section h2 {
      color: #667eea;
      margin-bottom: 15px;
      font-size: 1.3rem;
    }
    .check-item {
      display: flex;
      align-items: center;
      padding: 12px;
      background: #0f1425;
      border-radius: 8px;
      margin-bottom: 10px;
    }
    .check-icon {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 12px;
      font-weight: bold;
    }
    .check-icon.yes {
      background: #10b981;
      color: white;
    }
    .check-icon.no {
      background: #ef4444;
      color: white;
    }
    .profile-content {
      background: #0f1425;
      padding: 20px;
      border-radius: 8px;
      margin-top: 15px;
    }
    .profile-section {
      margin-bottom: 20px;
    }
    .profile-section h3 {
      color: #667eea;
      font-size: 1.1rem;
      margin-bottom: 10px;
    }
    .profile-section p {
      color: #d0d0d0;
      line-height: 1.8;
    }
    .opus-recommendation {
      background: linear-gradient(135deg, #1a1f3a 0%, #2a2f4a 100%);
      border: 2px solid #667eea;
      padding: 30px;
      border-radius: 12px;
      margin-top: 20px;
    }
    .opus-recommendation h3 {
      color: #667eea;
      font-size: 1.4rem;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
    }
    .opus-recommendation h3::before {
      content: '🧠';
      margin-right: 10px;
    }
    .recommendation-text {
      color: #e0e0e0;
      line-height: 1.8;
      font-size: 1.05rem;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .summary-card {
      background: #0f1425;
      border: 1px solid #2a2f4a;
      border-radius: 10px;
      padding: 14px;
    }
    .summary-card .label {
      font-size: 0.78rem;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 6px;
    }
    .summary-card .value {
      color: #f3f4f6;
      font-size: 1rem;
      font-weight: 600;
      line-height: 1.4;
    }
    .detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }
    .detail-card {
      background: #0f1425;
      border: 1px solid #2a2f4a;
      border-radius: 10px;
      padding: 16px;
    }
    .detail-card h3 {
      color: #667eea;
      font-size: 1rem;
      margin-bottom: 10px;
    }
    .detail-card p {
      color: #d0d0d0;
      line-height: 1.7;
      white-space: pre-wrap;
    }
    .back-link {
      display: inline-block;
      color: #667eea;
      text-decoration: none;
      margin-bottom: 20px;
    }
    .back-link:hover {
      text-decoration: underline;
    }
    .action-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 14px;
    }
    .secondary-button {
      background: #0f1425;
      border: 1px solid #2a2f4a;
    }
  </style>
</head>
<body>
  <div class="container">
    <a href="/" class="back-link">← Back to Dashboard</a>

    <h1>Adhoc Stock Analyzer</h1>
    <p class="subtitle">Get Opus-powered analysis for any stock with current market conditions</p>

    <div class="form-card">
      <form id="analyzerForm">
        <div class="form-group">
          <label>Stock Ticker <span class="required">*</span></label>
          <input type="text" id="ticker" name="ticker" placeholder="AAPL" required style="text-transform: uppercase;">
        </div>

        <div class="form-group">
          <label>Intent <span class="required">*</span></label>
          <select id="intent" name="intent" required>
            <option value="">Select intent...</option>
            <option value="LONG">LONG - Buy/Hold position</option>
            <option value="SHORT">SHORT - Short position</option>
          </select>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Cost Basis (optional)</label>
            <input type="number" id="costBasis" name="costBasis" placeholder="150.00" step="0.01" min="0">
          </div>

          <div class="form-group">
            <label>Stop Loss (optional)</label>
            <input type="number" id="stopLoss" name="stopLoss" placeholder="140.00" step="0.01" min="0">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Take Profit (optional)</label>
            <input type="number" id="takeProfit" name="takeProfit" placeholder="180.00" step="0.01" min="0">
          </div>
          <div></div>
        </div>

        <button type="submit">Analyze Stock</button>
      </form>
    </div>

    <div class="loading" id="loading">
      <div class="spinner"></div>
      <p>Analyzing with Opus extended thinking (30k tokens)...</p>
      <p style="font-size: 0.9rem; color: #9ca3af; margin-top: 10px;">This may take 3-5 minutes for deep analysis</p>
    </div>

    <div id="results"></div>
  </div>

  <script>
    let lastAnalysisRequest = null;

    document.getElementById('analyzerForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const ticker = document.getElementById('ticker').value.toUpperCase();
      const intent = document.getElementById('intent').value;
      const costBasis = document.getElementById('costBasis').value;
      const stopLoss = document.getElementById('stopLoss').value;
      const takeProfit = document.getElementById('takeProfit').value;
      lastAnalysisRequest = { ticker, intent, costBasis, stopLoss, takeProfit };

      await runAnalysis(lastAnalysisRequest);
    });

    async function runAnalysis(payload) {
      // Show loading
      document.getElementById('loading').classList.add('active');
      document.getElementById('results').classList.remove('active');

      try {
        const response = await fetch('/adhoc-analyzer/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Analysis failed');
        }

        // Display results
        displayResults(data);
      } catch (error) {
        alert('Error: ' + error.message);
      } finally {
        document.getElementById('loading').classList.remove('active');
      }
    }

    async function buildProfile(symbol) {
      const normalized = String(symbol || '').toUpperCase().trim();
      if (!normalized) return;

      document.getElementById('loading').classList.add('active');
      document.getElementById('results').classList.remove('active');

      try {
        const response = await fetch('/adhoc-analyzer/build-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: normalized })
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Profile build failed');
        }

        if (lastAnalysisRequest && lastAnalysisRequest.ticker === normalized) {
          await runAnalysis(lastAnalysisRequest);
          return;
        }

        alert('Profile built successfully for ' + normalized + '. You can now rerun analysis.');
      } catch (error) {
        alert('Profile build failed: ' + error.message);
      } finally {
        document.getElementById('loading').classList.remove('active');
      }
    }

    function displayResults(data) {
      const resultsDiv = document.getElementById('results');

      let html = '<div class="result-section">';
      html += '<h2>Stock Checks</h2>';

      // Stock universe check
      html += '<div class="check-item">';
      html += \`<div class="check-icon \${data.checks.inUniverse ? 'yes' : 'no'}">\${data.checks.inUniverse ? '✓' : '✗'}</div>\`;
      html += \`<div>In Stock Universe: \${data.checks.inUniverse ? 'Yes' : 'No'}</div>\`;
      html += '</div>';

      // Saturday watchlist check
      html += '<div class="check-item">';
      html += \`<div class="check-icon \${data.checks.inWatchlist ? 'yes' : 'no'}">\${data.checks.inWatchlist ? '✓' : '✗'}</div>\`;
      html += '<div>';
      html += \`In Saturday Watchlist: \${data.checks.inWatchlist ? 'Yes' : 'No'}\`;
      if (data.checks.inWatchlist) {
        html += \`<br><span style="color: #9ca3af; font-size: 0.9rem;">Status: \${data.checks.watchlistStatus}</span>\`;
        if (data.checks.watchlistPathway) {
          html += \`<br><span style="color: #9ca3af; font-size: 0.9rem;">Pathway: \${data.checks.watchlistPathway}</span>\`;
        }
        if (data.checks.opusConviction) {
          html += \`<br><span style="color: #9ca3af; font-size: 0.9rem;">Opus Conviction: \${data.checks.opusConviction}/100</span>\`;
        }
      }
      html += '</div>';
      html += '</div>';

      // Stock profile check
      html += '<div class="check-item">';
      html += \`<div class="check-icon \${data.checks.hasProfile ? 'yes' : 'no'}">\${data.checks.hasProfile ? '✓' : '✗'}</div>\`;
      html += '<div>';
      html += \`Has Stock Profile: \${data.checks.hasProfile ? 'Yes' : 'No'}\`;
      if (!data.checks.hasProfile) {
        html += \`<div class="action-row"><button type="button" class="secondary-button" onclick="buildProfile('\${data.symbol}')">Build Profile for \${data.symbol}</button></div>\`;
      }
      html += '</div>';
      html += '</div>';

      html += '</div>';

      // Stock profile display
      if (data.profile) {
        html += '<div class="result-section">';
        html += '<h2>Stock Profile</h2>';
        html += '<div class="profile-content">';

        if (data.profile.business_model) {
          html += '<div class="profile-section">';
          html += '<h3>Business Model</h3>';
          html += \`<p>\${data.profile.business_model}</p>\`;
          html += '</div>';
        }

        if (data.profile.moats) {
          html += '<div class="profile-section">';
          html += '<h3>Moats & Competitive Advantages</h3>';
          html += \`<p>\${data.profile.moats}</p>\`;
          html += '</div>';
        }

        if (data.profile.risks) {
          html += '<div class="profile-section">';
          html += '<h3>Key Risks</h3>';
          html += \`<p>\${data.profile.risks}</p>\`;
          html += '</div>';
        }

        if (data.profile.catalysts) {
          html += '<div class="profile-section">';
          html += '<h3>Catalysts</h3>';
          html += \`<p>\${data.profile.catalysts}</p>\`;
          html += '</div>';
        }

        html += '</div></div>';
      }

      if (data.parsedRecommendation) {
        const parsed = data.parsedRecommendation;
        html += '<div class="result-section">';
        html += '<h2>Decision Summary</h2>';
        html += '<div class="summary-grid">';
        html += renderSummaryCard('Decision', parsed.decision);
        html += renderSummaryCard('Pathway Fit', parsed.pathwayFit);
        html += renderSummaryCard('Conviction', parsed.conviction);
        html += renderSummaryCard('Growth Potential', parsed.growthPotential);
        html += renderSummaryCard('Holding Period', parsed.holdingPeriod);
        html += '</div>';
        html += '</div>';

        html += '<div class="result-section">';
        html += '<h2>Trade Plan</h2>';
        html += '<div class="summary-grid">';
        html += renderSummaryCard('Entry', parsed.entry);
        html += renderSummaryCard('Stop', parsed.stop);
        html += renderSummaryCard('Target', parsed.target);
        html += renderSummaryCard('Management Plan', parsed.managementPlan);
        html += '</div>';
        html += '</div>';

        html += '<div class="result-section">';
        html += '<h2>Analysis Breakdown</h2>';
        html += '<div class="detail-grid">';
        html += renderDetailCard('Thesis', parsed.thesis);
        html += renderDetailCard('Catalysts', parsed.catalysts);
        html += renderDetailCard('Technical View', parsed.technicalView);
        html += renderDetailCard('Risk View', parsed.riskView);
        html += '</div>';
        html += '</div>';
      }

      // Opus recommendation
      html += '<div class="result-section">';
      html += '<div class="opus-recommendation">';
      html += '<h3>Full Opus Recommendation</h3>';
      html += \`<div class="recommendation-text">\${data.opusRecommendation}</div>\`;
      html += '</div>';
      html += '</div>';

      resultsDiv.innerHTML = html;
      resultsDiv.classList.add('active');
      resultsDiv.scrollIntoView({ behavior: 'smooth' });
    }

    function renderSummaryCard(label, value) {
      if (!value) return '';
      return \`<div class="summary-card"><div class="label">\${label}</div><div class="value">\${value}</div></div>\`;
    }

    function renderDetailCard(title, value) {
      if (!value) return '';
      return \`<div class="detail-card"><h3>\${title}</h3><p>\${value}</p></div>\`;
    }
  </script>
</body>
</html>
  `;

  res.send(html);
});

/**
 * Analyze endpoint - performs the actual analysis
 */
router.post('/analyze', async (req, res) => {
  try {
    const { ticker, intent, costBasis, stopLoss, takeProfit } = req.body;

    if (!ticker || !intent) {
      return res.status(400).json({ error: 'Ticker and intent are required' });
    }

    const symbol = ticker.toUpperCase();
    console.log(`\n🔍 Adhoc analysis requested: ${symbol} (${intent})`);

    // Step 1: Check if stock is in universe
    const universeCheck = await db.query(
      'SELECT * FROM stock_universe WHERE symbol = $1',
      [symbol]
    );
    const inUniverse = universeCheck.rows.length > 0;

    // Step 2: Check if stock is in saturday_watchlist
    const watchlistCheck = await db.query(
      `SELECT *
       FROM saturday_watchlist
       WHERE symbol = $1
       ORDER BY COALESCE(last_reviewed, added_date) DESC, added_date DESC
       LIMIT 1`,
      [symbol]
    );
    const inWatchlist = watchlistCheck.rows.length > 0;
    const watchlistStatus = inWatchlist ? watchlistCheck.rows[0].status : null;
    const watchlistPathway = inWatchlist ? (watchlistCheck.rows[0].primary_pathway || watchlistCheck.rows[0].pathway) : null;
    const watchlistSecondaryPathways = inWatchlist ? (watchlistCheck.rows[0].secondary_pathways || []) : [];
    const opusConviction = inWatchlist ? watchlistCheck.rows[0].opus_conviction : null;
    const watchlistSelectionSource = inWatchlist ? watchlistCheck.rows[0].selection_source || watchlistCheck.rows[0].source : null;
    const watchlistAnalysisReady = inWatchlist ? watchlistCheck.rows[0].analysis_ready : null;
    const watchlistSelectionRank = inWatchlist ? watchlistCheck.rows[0].selection_rank_within_pathway : null;
    const watchlistReviewPriority = inWatchlist ? watchlistCheck.rows[0].review_priority : null;
    
    // Check if there's an active position with thesis management
    let positionDetails = null;
    try {
      const positionCheck = await db.query(
        `SELECT *
         FROM positions
         WHERE symbol = $1`,
        [symbol]
      );
      positionDetails = positionCheck.rows.length > 0 ? positionCheck.rows[0] : null;
    } catch (error) {
      console.warn(`   ⚠️ Could not load position details for ${symbol}: ${error.message}`);
    }

    // Step 3: Get stock profile
    const profileCheck = await db.query(
      'SELECT * FROM stock_profiles WHERE symbol = $1',
      [symbol]
    );
    const hasProfile = profileCheck.rows.length > 0;
    const profile = hasProfile ? profileCheck.rows[0] : null;

    // Step 4: Get current market data
    const [quote, ratios, keyMetrics, deepBundle] = await Promise.all([
      fmp.getQuote(symbol),
      fmp.getRatiosTTM(symbol),
      fmp.getKeyMetricsTTM(symbol),
      fmp.getDeepAnalysisBundle(symbol)
    ]);

    if (!quote) {
      return res.status(404).json({ error: 'Stock not found or invalid ticker' });
    }

    const currentPrice = quote?.price || quote?.previousClose || quote?.close || 0;

    // Step 5: Get earnings calendar
    const earningsResult = await db.query(
      'SELECT * FROM earnings_calendar WHERE symbol = $1 AND earnings_date >= CURRENT_DATE ORDER BY earnings_date LIMIT 1',
      [symbol]
    );
    const nextEarnings = earningsResult.rows[0];

    // Step 6: Get recent news
    let news = [];
    try {
      news = await tavily.searchStructuredStockContext(symbol, { maxResults: 5 });
    } catch (error) {
      console.warn(`   ⚠️ Tavily structured search failed for ${symbol}: ${error.message}`);
      news = [];
    }

    // Step 7: Get catalyst research and options data
    let catalystResearch = [];
    try {
      catalystResearch = await researchCatalysts(symbol, watchlistPathway || intent);
    } catch (error) {
      console.warn(`   ⚠️ Catalyst research failed for ${symbol}: ${error.message}`);
      catalystResearch = [];
    }

    // Step 8: Get options data from Tradier (if available)
    let optionsData = null;
    try {
      // Get options chain for next 2 months
      optionsData = await tradier.getOptionsChain(symbol);
    } catch (error) {
      console.log(`   ⚠️  Options data not available for ${symbol}`);
    }

    // Step 9: Build Opus prompt
    const prompt = buildOpusPrompt({
      symbol,
      intent,
      costBasis,
      stopLoss,
      takeProfit,
      currentPrice,
      quote,
      ratios,
      keyMetrics,
      deepBundle,
      profile,
      nextEarnings,
      news,
      catalystResearch,
      optionsData,
      inUniverse,
      inWatchlist,
      watchlistStatus,
      watchlistPathway,
      opusConviction,
      watchlistSelectionSource,
      watchlistAnalysisReady,
      watchlistSelectionRank,
      watchlistReviewPriority,
      watchlistSecondaryPathways,
      positionDetails
    });

    // Step 10: Call Opus with extended thinking
    console.log(`   🧠 Calling Opus with 30k token extended thinking...`);
    const messages = [{ role: 'user', content: prompt }];
    const response = await claude.sendMessage(
      messages,
      MODELS.OPUS,
      null,
      true, // enableThinking
      30000 // 30k token budget
    );

    // Extract text from response
    let opusRecommendation = '';
    if (response.content) {
      const textBlock = response.content.find(b => b.type === 'text');
      if (textBlock) {
        opusRecommendation = textBlock.text;
      }
    }

    const parsedRecommendation = parseStructuredRecommendation(opusRecommendation);
    opusRecommendation = formatOpusResponse(opusRecommendation);

    // Return results
    res.json({
      symbol,
      checks: {
        inUniverse,
        inWatchlist,
        watchlistStatus,
        watchlistPathway,
        opusConviction,
        watchlistSelectionSource,
        watchlistAnalysisReady,
        watchlistSelectionRank,
        watchlistReviewPriority,
        hasProfile
      },
      profile: profile ? {
        business_model: profile.business_model,
        moats: profile.moats,
        risks: profile.risks,
        catalysts: profile.catalysts
      } : null,
      parsedRecommendation,
      opusRecommendation
    });

  } catch (error) {
    console.error('❌ Error in adhoc analysis:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/build-profile', async (req, res) => {
  try {
    const symbol = String(req.body?.ticker || '').trim().toUpperCase();
    if (!symbol) {
      return res.status(400).json({ error: 'Ticker is required' });
    }

    console.log(`\n🔬 Manual stock profile build requested: ${symbol}`);
    const profile = await stockProfiles.buildStockProfile(symbol);
    res.json({ success: true, symbol, profile });
  } catch (error) {
    console.error('❌ Error building adhoc stock profile:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Build Opus analysis prompt
 */
function buildOpusPrompt(data) {
  const {
    symbol,
    intent,
    costBasis,
    stopLoss,
    takeProfit,
    currentPrice,
    quote,
    ratios,
    keyMetrics,
    deepBundle,
    profile,
    nextEarnings,
    news,
    catalystResearch,
    optionsData,
    inUniverse,
    inWatchlist,
    watchlistStatus,
    watchlistPathway,
    opusConviction,
    watchlistSelectionSource,
    watchlistAnalysisReady,
    watchlistSelectionRank,
    watchlistReviewPriority,
    watchlistSecondaryPathways,
    positionDetails
  } = data;

  let prompt = `You are Whiskie. Analyze ${symbol} using the same core process Whiskie's trading bot uses: pathway-aware context, weekly selection metadata, stock profile context, technical confirmation, catalyst review, earnings-aware risk handling, tactical-state awareness, risk/reward discipline, and strategy-consistent position management.

This is an ADHOC single-stock review, not a portfolio-construction pass. Be consistent with Whiskie's PHASE 2/3 style analysis and management language.

You are analyzing ${symbol} for a ${intent} position.

CURRENT POSITION DETAILS:
- Intent: ${intent}
- Current Price: $${currentPrice}`;

  if (costBasis) {
    const pnlPercent = ((currentPrice - parseFloat(costBasis)) / parseFloat(costBasis) * 100).toFixed(2);
    prompt += `
- Cost Basis: $${costBasis}
- Unrealized P&L: ${pnlPercent}% (${pnlPercent > 0 ? 'gain' : 'loss'})`;
  }

  if (stopLoss) {
    const stopDistance = ((parseFloat(stopLoss) - currentPrice) / currentPrice * 100).toFixed(2);
    prompt += `
- Stop Loss: $${stopLoss} (${Math.abs(stopDistance)}% ${stopDistance < 0 ? 'below' : 'above'} current)`;
  }

  if (takeProfit) {
    const targetDistance = ((parseFloat(takeProfit) - currentPrice) / currentPrice * 100).toFixed(2);
    prompt += `
- Take Profit: $${takeProfit} (${Math.abs(targetDistance)}% ${targetDistance > 0 ? 'above' : 'below'} current)`;
  }
  
  if (positionDetails) {
    prompt += `

ACTIVE POSITION MANAGEMENT:
- Pathway: ${positionDetails.pathway || 'N/A'}
- Thesis State: ${positionDetails.thesis_state || 'N/A'}
- Holding Posture: ${positionDetails.holding_posture || 'N/A'}
- Base Target: $${positionDetails.base_target || 'N/A'}
- Thesis Flex Target: $${positionDetails.thesis_flex_target || 'N/A'}
- Trailing Stop: $${positionDetails.trailing_stop || 'N/A'}
- Reassessment Date: ${positionDetails.thesis_reassessment_date || 'N/A'}`;
  }

  prompt += `

WHISKIE SYSTEM STATUS:
- In Stock Universe: ${inUniverse ? 'Yes' : 'No'}
- In Saturday Watchlist: ${inWatchlist ? `Yes (${watchlistStatus})` : 'No'}
- Primary Watchlist Pathway: ${watchlistPathway || 'None'}
- Secondary Watchlist Pathways: ${(watchlistSecondaryPathways || []).join(', ') || 'None'}
- Watchlist Selection Source: ${watchlistSelectionSource || 'None'}
- Watchlist Analysis Ready: ${watchlistAnalysisReady === null ? 'N/A' : (watchlistAnalysisReady ? 'Yes' : 'No')}
- Watchlist Rank Within Pathway: ${watchlistSelectionRank ?? 'N/A'}
- Watchlist Review Priority: ${watchlistReviewPriority ?? 'N/A'}
- Weekly Opus Conviction: ${opusConviction ?? 'N/A'}
- Has Stock Profile: ${profile ? 'Yes' : 'No'}

`;

  // Add stock profile if exists
  if (profile) {
    prompt += `STOCK PROFILE:
Business Model: ${profile.business_model || 'N/A'}

Moats: ${profile.moats || 'N/A'}

Risks: ${profile.risks || 'N/A'}

Catalysts: ${profile.catalysts || 'N/A'}

`;
  }

  if (deepBundle) {
    prompt += `DEEP ANALYSIS BUNDLE:
- Sector: ${deepBundle.signals?.sector || 'Unknown'}
- Industry: ${deepBundle.signals?.industry || 'Unknown'}
- Revenue Acceleration: ${deepBundle.signals?.revenueAccel || 'unknown'}
- Current Price Signal: ${deepBundle.signals?.currentPrice || currentPrice}
- Revenue Growth: ${typeof deepBundle.signals?.revenueGrowth === 'number' ? `${(deepBundle.signals.revenueGrowth * 100).toFixed(1)}%` : 'N/A'}
- EPS Growth: ${typeof deepBundle.signals?.epsGrowth === 'number' ? `${(deepBundle.signals.epsGrowth * 100).toFixed(1)}%` : 'N/A'}
- Operating Margin: ${typeof deepBundle.signals?.operatingMargin === 'number' ? `${(deepBundle.signals.operatingMargin * 100).toFixed(1)}%` : 'N/A'}
- ROE: ${typeof deepBundle.signals?.roe === 'number' ? `${(deepBundle.signals.roe * 100).toFixed(1)}%` : 'N/A'}
- ROIC: ${typeof deepBundle.signals?.roic === 'number' ? `${(deepBundle.signals.roic * 100).toFixed(1)}%` : 'N/A'}
- Technicals Snapshot: ${deepBundle.technicals ? JSON.stringify(deepBundle.technicals, null, 2) : 'N/A'}

`;
  }

  // Add fundamentals
  const marketCap = quote?.marketCap || keyMetrics?.marketCap || 0;
  const peRatio = ratios?.priceToEarningsRatioTTM;
  const pegRatio = ratios?.priceToEarningsGrowthRatioTTM;
  const forwardPeg = ratios?.forwardPriceToEarningsGrowthRatioTTM;
  const priceToBook = ratios?.priceToBookRatioTTM ?? ratios?.priceToBookRatio;
  const operatingMargin = ratios?.operatingProfitMarginTTM ?? ratios?.operatingMargin;
  const roe = keyMetrics?.returnOnEquityTTM ?? ratios?.returnOnEquity;
  const debtToEquity = ratios?.debtToEquityRatioTTM ?? ratios?.debtToEquity;
  const currentRatio = ratios?.currentRatioTTM ?? ratios?.currentRatio;
  const fcfYield = keyMetrics?.freeCashFlowYieldTTM ?? keyMetrics?.freeCashFlowYield;

  prompt += `CURRENT FUNDAMENTALS:
- Market Cap: ${marketCap ? `$${(marketCap / 1e9).toFixed(2)}B` : 'N/A'}
- P/E Ratio (TTM): ${typeof peRatio === 'number' ? peRatio.toFixed(2) : 'N/A'}
- PEG Ratio (TTM): ${typeof pegRatio === 'number' ? pegRatio.toFixed(2) : 'N/A'}
- PEG Ratio (Forward): ${typeof forwardPeg === 'number' ? forwardPeg.toFixed(2) : 'N/A'}
- Price to Book: ${typeof priceToBook === 'number' ? priceToBook.toFixed(2) : 'N/A'}
- Operating Margin: ${typeof operatingMargin === 'number' ? `${(operatingMargin * 100).toFixed(1)}%` : 'N/A'}
- ROE: ${typeof roe === 'number' ? `${(roe * 100).toFixed(1)}%` : 'N/A'}
- Debt to Equity: ${typeof debtToEquity === 'number' ? debtToEquity.toFixed(2) : 'N/A'}
- Current Ratio: ${typeof currentRatio === 'number' ? currentRatio.toFixed(2) : 'N/A'}
- FCF Yield: ${typeof fcfYield === 'number' ? `${(fcfYield * 100).toFixed(1)}%` : 'N/A'}

PRICE ACTION:
- Day Change: ${typeof quote?.changePercentage === 'number' ? `${quote.changePercentage.toFixed(2)}%` : 'N/A'}
- Day Range: ${quote?.dayLow && quote?.dayHigh ? `$${quote.dayLow} - $${quote.dayHigh}` : 'N/A'}
- 52-Week Range: ${quote?.yearLow && quote?.yearHigh ? `$${quote.yearLow} - $${quote.yearHigh}` : 'N/A'}
- 50-Day MA: ${typeof quote?.priceAvg50 === 'number' ? `$${quote.priceAvg50.toFixed(2)}` : 'N/A'}
- 200-Day MA: ${typeof quote?.priceAvg200 === 'number' ? `$${quote.priceAvg200.toFixed(2)}` : 'N/A'}
- Volume: ${typeof quote?.volume === 'number' ? `${(quote.volume / 1e6).toFixed(2)}M` : 'N/A'}

`;

  // Add earnings calendar
  if (nextEarnings) {
    const daysUntil = Math.ceil((new Date(nextEarnings.earnings_date) - new Date()) / (1000 * 60 * 60 * 24));
    prompt += `UPCOMING EARNINGS:
- Date: ${nextEarnings.earnings_date} (${daysUntil} days away)
- Session: ${nextEarnings.session_normalized || nextEarnings.earnings_time || 'Unknown'}
- Timing Detail: ${nextEarnings.timing_raw || nextEarnings.earnings_time || 'Unknown'}

`;
  }

  // Add recent news
  if (news && news.length > 0) {
    prompt += `RECENT NEWS & CATALYSTS:\n`;
    news.forEach((item, i) => {
      prompt += `${i + 1}. ${item.title}\n   ${item.snippet}\n\n`;
    });
  }

  if (catalystResearch && catalystResearch.length > 0) {
    prompt += `STRUCTURED CATALYST RESEARCH:
${JSON.stringify(catalystResearch, null, 2)}

`;
  }

  // Add options data if available
  if (optionsData) {
    prompt += `OPTIONS MARKET DATA:
- Implied Volatility: ${optionsData.iv || 'N/A'}
- Put/Call Ratio: ${optionsData.putCallRatio || 'N/A'}
- Options Volume: ${optionsData.volume || 'N/A'}

`;
  }

  // Add evaluation criteria
  if (intent === 'LONG') {
    prompt += `YOUR TASK:
Provide a comprehensive recommendation for this LONG position using Whiskie's core long-analysis framework:

1. **Current Action**: Should the user HOLD, BUY MORE, SELL, or WAIT?
2. **Growth Potential**: 2x-3x / 50-100% / 20-50% / <20%
3. **Reasoning**: Why? Consider fundamentals, technicals, catalysts, pathway fit, and risks
4. **Entry/Exit Strategy**:
   - If no position: Is current price a good entry? What's the ideal entry?
   - If has position: Should they add, trim, or hold?
   - Stop loss and take profit recommendations
5. **Catalyst Timing**: Any upcoming events (earnings, product launches) to wait for?
6. **Risk Assessment**: Key risks and how to manage them
7. **Time Horizon**: Is this a short-term trade or long-term hold?

Use this output structure:
DECISION: BUY / PASS / HOLD / TRIM / EXIT / WAIT
PATHWAY_FIT: [best matching pathway or NONE]
CONVICTION: High / Medium / Low
GROWTH_POTENTIAL: 2x-3x / 50-100% / 20-50% / <20%
ENTRY: [price or range]
STOP: [price and rationale]
TARGET: [price and rationale]
HOLDING_PERIOD: [days/weeks/months/years]
THESIS: [1-2 sentences]
CATALYSTS: [dated catalysts]
TECHNICAL_VIEW: [summary]
RISK_VIEW: [summary]
MANAGEMENT_PLAN: [hold/rebalance/trim/exit/trail/add]
REASONING: [detailed explanation]

Be specific and actionable. If you recommend waiting, explain what you're waiting for and at what price/condition to act.`;
  } else {
    prompt += `YOUR TASK:
Provide a comprehensive recommendation for this SHORT position using Whiskie's core short-analysis framework:

1. **Current Action**: Should the user HOLD SHORT, ADD TO SHORT, COVER, or WAIT?
2. **Reasoning**: Why? Consider overvaluation, deterioration, pathway fit, and technical weakness
3. **Technical Confirmation**: Explicitly address price vs 200MA, direction of 200MA, RSI, squeeze risk, and earnings proximity
4. **Entry/Exit Strategy**:
   - If no position: Is current price a good short entry? What's the ideal entry?
   - If has position: Should they add, cover partially, or hold?
   - Stop loss (cover) and take profit recommendations
5. **Catalyst Timing**: Any upcoming events that could trigger downside?
6. **Risk Assessment**: Squeeze risk, borrow costs, upside catalysts to watch
7. **Time Horizon**: Short-term trade or longer-term short thesis?

Use this output structure:
DECISION: SHORT / PASS / HOLD / COVER / WAIT
PATHWAY_FIT: overvalued / deteriorating / overextended / NONE
CONVICTION: High / Medium / Low
ENTRY: [price or range]
STOP: [price and rationale]
TARGET: [price and rationale]
HOLDING_PERIOD: [days/weeks/months]
THESIS: [1-2 sentences]
CATALYSTS: [dated catalysts]
TECHNICAL_VIEW: [summary]
RISK_VIEW: [summary]
MANAGEMENT_PLAN: [hold/cover/trim/exit/add]
REASONING: [detailed explanation]

Be specific and actionable. If you recommend waiting, explain what you're waiting for and at what price/condition to act.`;
  }

  return prompt;
}

/**
 * Format Opus response for better HTML display
 */
function formatOpusResponse(text) {
  let html = text;

  // Convert bold text
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Convert numbered lists (1. 2. 3.)
  html = html.replace(/^(\d+)\.\s+(.+)$/gm, '<li style="margin-bottom: 10px;">$2</li>');
  html = html.replace(/(<li.*<\/li>\n?)+/g, '<ol style="margin: 15px 0 15px 25px; padding-left: 20px;">$&</ol>');

  // Convert bullet points (- or •)
  html = html.replace(/^[-•]\s+(.+)$/gm, '<li style="margin-bottom: 8px;">$1</li>');
  html = html.replace(/(<li.*<\/li>\n?)+/g, '<ul style="margin: 15px 0 15px 25px; padding-left: 20px;">$&</ul>');

  // Convert section headers (lines ending with :)
  html = html.replace(/^([A-Z][^:\n]{3,50}):$/gm, '<h4 style="color: #667eea; margin-top: 20px; margin-bottom: 10px; font-size: 1.1rem;">$1</h4>');

  // Convert paragraphs
  html = html.split('\n\n').map(para => {
    para = para.trim();
    if (para && !para.startsWith('<')) {
      return `<p style="margin-bottom: 12px; color: #d0d0d0; line-height: 1.8;">${para.replace(/\n/g, '<br>')}</p>`;
    }
    return para;
  }).join('\n');

  return html;
}

function parseStructuredRecommendation(text) {
  const extract = (label) => {
    const match = text.match(new RegExp(`^${label}:\\s*(.+)$`, 'im'));
    return match ? match[1].trim() : null;
  };

  return {
    decision: extract('DECISION'),
    pathwayFit: extract('PATHWAY_FIT'),
    conviction: extract('CONVICTION'),
    growthPotential: extract('GROWTH_POTENTIAL'),
    entry: extract('ENTRY'),
    stop: extract('STOP'),
    target: extract('TARGET'),
    holdingPeriod: extract('HOLDING_PERIOD'),
    thesis: extract('THESIS'),
    catalysts: extract('CATALYSTS'),
    technicalView: extract('TECHNICAL_VIEW'),
    riskView: extract('RISK_VIEW'),
    managementPlan: extract('MANAGEMENT_PLAN'),
    reasoning: extract('REASONING')
  };
}

export default router;
