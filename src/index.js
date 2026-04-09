import cron from 'node-cron';
import dotenv from 'dotenv';
import express from 'express';
import dashboard from './dashboard.js';
import tradier from './tradier.js';
import claude from './claude.js';
import tavily from './tavily.js';
import email from './email.js';
import riskManager from './risk-manager.js';
import tradeSafeguard from './trade-safeguard.js';
import analysisEngine from './analysis.js';
import orderManager from './order-manager.js';
import shortManager from './short-manager.js';
import trendLearning, { getLearningSummary } from './trend-learning.js';
import correlationAnalysis from './correlation-analysis.js';
import performanceAnalyzer from './performance-analyzer.js';
import optionsAnalyzer from './options-analyzer.js';
import vixRegime from './vix-regime.js';
import sectorRotation from './sector-rotation.js';
import macroCalendar from './macro-calendar.js';
import allocationManager from './allocation-manager.js';
import assetClassData from './asset-class-data.js';
import preRanking from './pre-ranking.js';
import fundamentalScreener from './fundamental-screener.js';
import { runPreMarketScan } from './pre-market-scanner.js';
import { sanitizeNewsContent, wrapNewsForPrompt } from './news-sanitizer.js';
import * as db from './db.js';
import { updateAllEarnings } from './earnings.js';
import { runTrimCheck } from './trimming.js';
import { runTaxOptimizationCheck } from './tax-optimizer.js';
import { runTrailingStopCheck, updateTrailingStops } from './trailing-stops.js';
import { runEarningsDayAnalysis } from './earnings-analysis.js';
import { runWeeklyReview } from './weekly-review.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// Mount dashboard routes
app.use('/', dashboard);

/**
 * Whiskie - AI Trading Bot
 * Main orchestration logic
 */
class WhiskieBot {
  constructor() {
    this.botStarted = false;
    this.analysisRunning = false;
    this.apiServerStarted = false;
    this.latestGapReport = null; // Store pre-market gap scan results
    this.isPaperTrading = process.env.NODE_ENV === 'paper';
    console.log(`🤖 Whiskie Bot initialized in ${this.isPaperTrading ? 'PAPER TRADING' : 'LIVE'} mode`);
  }

  /**
   * Start the bot
   */
  async start() {
    console.log('🚀 Starting Whiskie Bot...\n');

    try {
      // Initialize database
      await db.initDatabase();

      // Load active orders from database
      await orderManager.loadActiveOrders();
      console.log('✅ Order manager initialized\n');

      // Start API server FIRST so Railway knows we're alive
      this.startAPIServer();
      console.log('✅ API server started\n');

      // Disable auto-start on deployment - only run on schedule or manual trigger
      console.log('⏰ Auto-start disabled. Bot will wait for scheduled cron jobs or manual trigger.');
      console.log('📅 Scheduled runs: 9:00 AM (pre-market), 10:00 AM, 2:00 PM ET (Mon-Fri)');
      console.log('📡 Manual trigger: POST /analyze\n');

      // Schedule pre-market gap scanner at 9:00 AM ET
      cron.schedule('0 9 * * 1-5', async () => {
        console.log('\n⏰ 9:00 AM Pre-Market Gap Scan');
        this.latestGapReport = await runPreMarketScan();
      }, {
        timezone: 'America/New_York'
      });

      // Schedule daily analysis at 10:00 AM and 2:00 PM ET
      cron.schedule('0 10 * * 1-5', async () => {
        console.log('\n⏰ 10:00 AM Analysis - Market has settled after open');
        await this.runDailyAnalysis();
      }, {
        timezone: 'America/New_York'
      });

      cron.schedule('0 14 * * 1-5', async () => {
        console.log('\n⏰ 2:00 PM Analysis - Afternoon check');
        await this.runDailyAnalysis();
      }, {
        timezone: 'America/New_York'
      });

      // Schedule end-of-day summary at 4:30 PM ET (after market close)
      cron.schedule('30 16 * * 1-5', async () => {
        console.log('\n⏰ End of day summary triggered');
        await this.sendDailySummary();
        console.log('✅ Daily summary complete');
      }, {
        timezone: 'America/New_York'
      });

      // Schedule weekly earnings update - Friday 3:00 PM ET
      cron.schedule('0 15 * * 5', async () => {
        console.log('\n⏰ Friday 3:00 PM - Weekly earnings calendar refresh');
        try {
          // Run Python script to update earnings calendar
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);

          console.log('📅 Running earnings calendar update...');
          const { stdout, stderr } = await execAsync('python3 fetch-earnings.py');

          if (stderr) console.error('Earnings update stderr:', stderr);
          console.log(stdout);
          console.log('✅ Earnings calendar updated successfully');
        } catch (error) {
          console.error('❌ Error updating earnings calendar:', error);
          await email.sendErrorAlert(error, 'Earnings calendar update failed');
        }
      }, {
        timezone: 'America/New_York'
      });

      // Schedule weekly portfolio review - Sunday 9:00 PM ET
      cron.schedule('0 21 * * 0', async () => {
        console.log('\n⏰ Sunday 9:00 PM - Weekly portfolio review');
        try {
          // Run weekly portfolio review with Opus
          await runWeeklyReview();
          console.log('✅ Weekly review complete');
        } catch (error) {
          console.error('❌ Error in weekly review:', error);
          await email.sendErrorAlert(error, 'Weekly review failed');
        }
      }, {
        timezone: 'America/New_York'
      });

      console.log('\n✅ Whiskie Bot is running');
      console.log('📅 Analysis schedule (Mon-Fri):');
      console.log('   • 10:00 AM ET - Morning analysis + trim/tax/trailing checks');
      console.log('   • 2:00 PM ET - Afternoon analysis + trim/tax/trailing checks');
      console.log('📊 Daily summary: 4:30 PM ET');
      console.log('📅 Weekly earnings refresh: Friday 3:00 PM ET');
      console.log('📅 Weekly review: Sunday 9:00 PM ET (Opus deep review)');
      console.log('💡 Press Ctrl+C to stop\n');

      this.botStarted = true;
    } catch (error) {
      console.error('❌ Error starting bot:', error);
      await email.sendErrorAlert(error, 'Bot startup');
      throw error;
    }
  }

  /**
   * Start API server for on-demand analysis
   */
  startAPIServer() {
    if (this.apiServerStarted) {
      console.log('⚠️ API server already running, skipping...');
      return;
    }

    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        bot: 'running',
        mode: process.env.NODE_ENV || 'development'
      });
    });

    app.post('/analyze', async (req, res) => {
      try {
        console.log('📡 Manual analysis triggered via API');

        // Run analysis in background
        this.runDailyAnalysis().catch(console.error);

        res.json({
          success: true,
          message: 'Analysis started. Check logs for progress.'
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    app.post('/weekly-review', async (req, res) => {
      try {
        console.log('📡 Manual weekly review triggered via API');

        // Import and run weekly review
        const { runWeeklyReview } = await import('./weekly-review.js');
        runWeeklyReview().catch(console.error);

        res.json({
          success: true,
          message: 'Weekly review started. This will take 5-10 minutes. Check logs for progress.'
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    app.get('/status', (req, res) => {
      res.json({
        running: this.botStarted,
        mode: process.env.NODE_ENV,
        uptime: process.uptime()
      });
    });

    // Chat endpoint with Tavily integration
    app.post('/chat', async (req, res) => {
      try {
        const { question } = req.body;

        if (!question) {
          return res.status(400).json({ error: 'Question is required' });
        }

        console.log(`💬 Chat query: ${question}`);

        // Get current portfolio state
        const portfolio = await analysisEngine.getPortfolioState();

        // Search for relevant market news/data with Tavily
        const searchResults = await tavily.search(question, { maxResults: 5 });
        const newsContext = searchResults.map(r => `${r.title}: ${r.content}`).join('\n\n');

        // Get real-time market data for portfolio positions
        const symbols = portfolio.positions.map(p => p.symbol);
        let marketData = {};
        if (symbols.length > 0) {
          const quotes = await tradier.getQuotes(symbols);
          const quotesArray = Array.isArray(quotes) ? quotes : [quotes];
          quotesArray.forEach(q => {
            marketData[q.symbol] = {
              price: q.last || q.close,
              change_percentage: q.change_percentage || 0
            };
          });
        }

        // Build context-aware prompt
        const prompt = `You are Whiskie, an AI portfolio manager. Answer the user's question with current market context.

**User Question:**
${question}

**Current Portfolio:**
- Total Value: $${portfolio.totalValue.toLocaleString()}
- Cash: $${portfolio.cash.toLocaleString()}
- Positions: ${portfolio.positions.length}
${portfolio.positions.map(p => `  - ${p.symbol}: ${p.quantity} shares @ $${p.currentPrice}`).join('\n')}

**Real-Time Market Data:**
${Object.entries(marketData).map(([sym, data]) => `${sym}: $${data.price} (${data.change_percentage >= 0 ? '+' : ''}${data.change_percentage}%)`).join('\n')}

**Recent Market News/Context:**
${newsContext}

Provide a clear, actionable answer. If recommending trades, be specific about entry/exit prices and reasoning.`;

        // Get Opus response with extended thinking
        const response = await claude.analyze(prompt, { model: 'opus' });

        res.json({
          answer: response.analysis,
          sources: searchResults.map(r => ({ title: r.title, url: r.url })),
          portfolioContext: {
            totalValue: portfolio.totalValue,
            cash: portfolio.cash,
            positions: portfolio.positions.length
          }
        });

      } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    app.listen(PORT, () => {
      console.log(`🌐 API server listening on port ${PORT}`);
      console.log(`📡 Trigger analysis: POST https://your-app.railway.app/analyze`);
      console.log('');
      this.apiServerStarted = true;
    });
  }

  /**
   * Check if bot should run now (9 AM - 5 PM ET, Mon-Fri)
   */
  async shouldRunNow() {
    const now = new Date();
    const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

    const hour = etTime.getHours();
    const day = etTime.getDay(); // 0 = Sunday, 6 = Saturday

    // Only run Mon-Fri (1-5), 9 AM - 5 PM ET
    const isWeekday = day >= 1 && day <= 5;
    const isTradingHours = hour >= 9 && hour < 17;

    return isWeekday && isTradingHours;
  }


  /**
   * Run daily portfolio analysis
   */
  async runDailyAnalysis() {
    if (this.analysisRunning) {
      console.log('⚠️ Analysis already running, skipping...');
      return;
    }

    this.analysisRunning = true;

    try {
      console.log('═══════════════════════════════════════');
      console.log('📊 DAILY PORTFOLIO ANALYSIS');
      console.log('═══════════════════════════════════════\n');

      // Check if market is open
      const isMarketOpen = await tradier.isMarketOpen();
      console.log(`📈 Market Status: ${isMarketOpen ? 'OPEN' : 'CLOSED'}\n`);

      // Get portfolio state with retry logic
      console.log('💼 Fetching portfolio state...');
      const MAX_RETRIES = 3;
      const RETRY_DELAY = [30000, 60000, 120000]; // 30s, 1min, 2min

      let portfolio;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          portfolio = await analysisEngine.getPortfolioState();
          break; // Success
        } catch (error) {
          if (attempt === MAX_RETRIES - 1) {
            console.error('❌ Failed to get portfolio state after 3 attempts. Aborting analysis.');
            await email.sendErrorAlert(error, 'Portfolio state fetch failed — analysis skipped');
            return;
          }
          console.warn(`⚠️ Portfolio fetch attempt ${attempt + 1} failed. Retrying in ${RETRY_DELAY[attempt] / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY[attempt]));
        }
      }

      console.log(`   Total Value: $${portfolio.totalValue.toLocaleString()}`);
      console.log(`   Cash: $${portfolio.cash.toLocaleString()}`);
      console.log(`   Positions: ${portfolio.positions.length}`);
      console.log(`   Drawdown: ${(portfolio.drawdown * 100).toFixed(2)}%\n`);

      // Sync positions to database (reconcile Tradier with database)
      console.log('📦 Syncing positions with Tradier...');
      const dbPositions = await db.getPositions();

      // Get symbols from both sources
      const tradierSymbols = new Set(portfolio.positions.map(p => p.symbol));
      const dbSymbols = new Set(dbPositions.map(p => p.symbol));

      // Remove positions from database that no longer exist in Tradier
      for (const dbPos of dbPositions) {
        if (!tradierSymbols.has(dbPos.symbol)) {
          console.log(`   🗑️ Removing ${dbPos.symbol} (no longer in Tradier)`);
          await db.query('DELETE FROM positions WHERE symbol = $1', [dbPos.symbol]);
          await db.query('DELETE FROM position_lots WHERE symbol = $1', [dbPos.symbol]);
        }
      }

      // Add/update positions from Tradier to database
      for (const pos of portfolio.positions) {
        await db.upsertPosition({
          symbol: pos.symbol,
          quantity: pos.quantity,
          cost_basis: pos.cost_basis,
          current_price: pos.currentPrice,
          sector: pos.sector,
          stock_type: pos.stock_type
        });

        // Update current_price for all lots of this symbol
        await db.query(
          `UPDATE position_lots SET current_price = $1 WHERE symbol = $2`,
          [pos.currentPrice, pos.symbol]
        );

        if (!dbSymbols.has(pos.symbol)) {
          console.log(`   ✅ Added ${pos.symbol}`);
        } else {
          console.log(`   🔄 Updated ${pos.symbol}`);
        }
      }

      console.log('');

      // Analyze portfolio health
      console.log('🔍 Analyzing portfolio health...');
      const health = await analysisEngine.analyzePortfolioHealth(portfolio);
      console.log(`   Issues: ${health.issues.length}`);
      console.log(`   Opportunities: ${health.opportunities.length}\n`);

      // Handle critical issues first
      if (health.issues.length > 0) {
        console.log('⚠️ ISSUES DETECTED:');
        for (const issue of health.issues) {
          console.log(`   - ${issue.message} (${issue.severity})`);

          // Log alert
          await db.logAlert({
            type: issue.type,
            symbol: issue.symbol,
            message: issue.message,
            severity: issue.severity
          });

          // Handle stop-loss triggers
          if (issue.type === 'stop-loss') {
            await this.handleStopLoss(issue.symbol, portfolio);
          }

          // Handle positions needing attention (20%+ loss)
          if (issue.type === 'attention') {
            await this.handlePositionAlert(issue.symbol, portfolio);
          }
        }
        console.log('');
      }

      // Check and execute all trim opportunities
      if (health.opportunities.length > 0) {
        console.log('💰 OPPORTUNITIES DETECTED:');
        for (const opp of health.opportunities) {
          console.log(`   - ${opp.message}`);

          if (opp.type === 'take-profit') {
            await this.handleTakeProfit(opp.symbol, opp.action, portfolio);
          }
        }
        console.log('');
      }

      // Check for trim opportunities (graduated trimming)
      console.log('✂️ Checking for trim opportunities...');
      const trimResults = await runTrimCheck();
      if (trimResults.trimmed > 0) {
        console.log(`✅ Trimmed ${trimResults.trimmed} positions\n`);
      }

      // Check for tax optimization opportunities
      console.log('💰 Checking for tax optimization...');
      const taxResults = await runTaxOptimizationCheck();
      if (taxResults.actionsCount > 0) {
        console.log(`✅ Tax optimization: ${taxResults.actionsCount} stops tightened\n`);
      }

      // Check for trailing stop activation
      console.log('📈 Checking for trailing stop activation...');
      const trailingResults = await runTrailingStopCheck();
      if (trailingResults.activated > 0) {
        console.log(`✅ Activated ${trailingResults.activated} trailing stops\n`);
      }

      // Update existing trailing stops
      console.log('📊 Updating trailing stops...');
      const trailingUpdateResults = await updateTrailingStops();
      if (trailingUpdateResults.updated > 0) {
        console.log(`✅ Updated ${trailingUpdateResults.updated} trailing stops\n`);
      }

      // Check for earnings day analysis (5 days ahead)
      console.log('📊 Checking for earnings in next 5 days...');
      const earningsResults = await runEarningsDayAnalysis(5);
      if (earningsResults.analyzed > 0) {
        console.log(`✅ Analyzed ${earningsResults.analyzed} positions with upcoming earnings\n`);
      } else {
        console.log('✅ No positions with earnings in next 5 days\n');
      }

      // Analyze and modify orders based on news/events
      console.log('🔄 Analyzing orders for potential modifications...');
      let ordersModified = 0;
      for (const position of portfolio.positions) {
        const result = await orderManager.analyzeAndModifyOrders(
          position.symbol,
          position,
          position.currentPrice
        );
        if (result && result.success && result.action !== 'NO_ACTION') {
          ordersModified++;
        }
      }
      if (ordersModified > 0) {
        console.log(`✅ Modified ${ordersModified} orders based on AI analysis\n`);
      } else {
        console.log(`✅ All orders remain appropriate\n`);
      }

      // Update days held for all lots (tax tracking)
      console.log('📅 Updating days held for tax tracking...');
      await db.updateDaysHeld();
      console.log('✅ Days held updated\n');

      // Get enriched news
      console.log('📰 Fetching enriched news...');
      const marketNews = await tavily.searchMarketNews(8);
      const techNews = await tavily.searchSectorNews('technology', 3);
      const healthNews = await tavily.searchSectorNews('healthcare', 3);
      const macroResults = await tavily.searchNews(
        'Federal Reserve interest rates inflation earnings season 2026',
        5
      );
      const allNews = [...marketNews, ...techNews, ...healthNews, ...macroResults];

      // Sanitize news content to prevent prompt injection
      const sanitizedNews = allNews.map(article => ({
        ...article,
        title: sanitizeNewsContent(article.title),
        content: sanitizeNewsContent(article.content)
      }));

      const formattedNews = tavily.formatResults(sanitizedNews);
      const wrappedNews = wrapNewsForPrompt(formattedNews);
      console.log(`   Found ${allNews.length} articles (sanitized)\n`);

      // Quick sentiment check
      const headlines = marketNews.map(n => n.title).join('. ');
      const sentiment = await claude.quickSentimentCheck(headlines);
      console.log('📊 Market Sentiment:', sentiment.analysis.substring(0, 100) + '...\n');

      // Gather additional context for Claude's analysis
      console.log('📊 Gathering market context...');

      // Cash state context
      const cashState = riskManager.checkCashState(portfolio);
      let cashContext = `\n${cashState.context}\n`;

      if (cashState.rotationCandidates.length > 0) {
        cashContext += '\nROTATION CANDIDATES (review before any new buy):\n';
        cashState.rotationCandidates.forEach(p => {
          cashContext += `  ${p.symbol} (${p.stock_type}): ${p.gainPct >= 0 ? '+' : ''}${p.gainPct}%, value $${p.positionValue}\n`;
        });
        cashContext += '\n→ If recommending a new buy while cash is DEPLOYED or ZERO, you MUST also ' +
          'either (a) recommend selling/trimming one of the above to fund it, or (b) explicitly explain ' +
          'why no rotation makes sense and why waiting for natural capital release is better.\n';
      }

      // VIX regime context
      const vixContext = await vixRegime.buildPromptContext();

      // Macro calendar context (FOMC, CPI, PPI, NFP)
      const macroContext = await macroCalendar.buildMacroContext(7);

      // Pre-market gap report context
      const gapContext = this.latestGapReport
        ? `\nPRE-MARKET GAP REPORT (9:00 AM scan):\n${this.latestGapReport.summary}`
        : '\nPRE-MARKET: No gap scan data available.';

      // Performance feedback context
      let performanceContext = '';
      try {
        const perf = await performanceAnalyzer.analyzePerformance();
        const learning = await getLearningSummary(30);

        if (perf) {
          performanceContext = `
RECENT TRADING PERFORMANCE (last 30 days — use to calibrate confidence):
- Win rate: ${perf.winRate} (target: 55-60%)
- Profit factor: ${perf.profitFactor} (target: 2.0+)
- Avg winner: ${perf.avgWin} | Avg loser: ${perf.avgLoss}
- Top losers: ${perf.topLosers.map(l => `${l.symbol} (${l.gainLossPercent}, held ${l.daysHeld}d)`).join(', ')}
${perf.patterns ? perf.patterns.map(p => `- Pattern: ${p}`).join('\n') : ''}
${learning ? `\nLEARNING INSIGHTS:\n${learning}` : ''}

→ If win rate < 50%: Be more selective, raise conviction bar for new entries.
→ If a symbol appears in repeated losers: Avoid re-entering that stock for 2 weeks.
→ If avg loser hold > avg winner hold: The bot is holding losses too long — tighten stops.
`;
        }
      } catch (error) {
        console.warn('⚠️ Could not fetch performance context:', error.message);
      }

      // Sector rotation context
      let sectorContext = '';
      try {
        const cached = await db.query(
          `SELECT metric_value FROM performance_metrics
           WHERE metric_name = 'sector_rotation_cache'
           ORDER BY calculated_at DESC LIMIT 1`
        );
        if (cached.rows[0]) {
          const ranking = JSON.parse(cached.rows[0].metric_value);
          sectorContext = sectorRotation.buildPromptContext(ranking);
        }
      } catch (e) {
        console.warn('⚠️ Could not fetch sector rotation context:', e.message);
      }

      // Options flow context (Feature 2)
      let optionsContext = '';
      try {
        const positionSymbols = portfolio.positions.map(p => p.symbol);
        const watchlistItems = await db.getWatchlist();
        const watchlistSymbols = watchlistItems.slice(0, 10).map(w => w.symbol);
        const symbolsToCheck = [...new Set([...positionSymbols, ...watchlistSymbols])];

        if (symbolsToCheck.length > 0) {
          console.log('📊 Fetching options chain data...');
          const optionsData = await optionsAnalyzer.analyzeMultipleSymbols(symbolsToCheck);

          const optionsSummary = optionsData.map(o =>
            `${o.symbol}: P/C ratio ${o.putCallVolumeRatio} (${o.sentiment}), IV ${o.impliedVolatility}` +
            (o.unusualActivity.calls > 3 ? `, ⚠️ ${o.unusualActivity.calls} unusual call strikes` : '') +
            (o.unusualActivity.puts > 3 ? `, ⚠️ ${o.unusualActivity.puts} unusual put strikes` : '')
          ).join('\n');

          optionsContext = `
OPTIONS FLOW DATA (institutional sentiment signals):
${optionsSummary}

Interpretation guide:
- P/C ratio < 0.7 = bullish options positioning
- P/C ratio > 1.3 = bearish options positioning
- Unusual call volume = potential large buyer positioning for upside
- Unusual put volume = hedging or directional bet on downside
- High IV = market expects large price move (earnings, catalyst, risk event)
Use this as a CONFIRMING signal, not a standalone buy/sell trigger.
`;
        }
      } catch (error) {
        console.warn('⚠️ Could not fetch options context:', error.message);
      }

      console.log('✅ Market context gathered\n');

      // Always run watchlist scan and news review, even if portfolio is healthy
      // This ensures we don't miss opportunities on stable days
      const shouldRunFullAnalysis =
        health.issues.some(i => i.severity === 'high') ||
        portfolio.positions.length < 10 ||
        cashPercent > 0.25 ||
        riskManager.isDefensiveMode(portfolio) ||
        health.opportunities.length > 0;

      if (shouldRunFullAnalysis) {
        console.log('🧠 Running deep analysis with Claude Opus...');
        // Pass all context to deep analysis
        await this.runDeepAnalysis(portfolio, wrappedNews, {
          cashContext,
          vixContext,
          macroContext,
          gapContext,
          performanceContext,
          sectorContext,
          optionsContext
        });
      } else {
        // Portfolio is healthy, but still scan watchlist and news for opportunities
        console.log('✅ Portfolio healthy - running watchlist scan and news review');

        // Get watchlist
        const watchlist = await db.getWatchlist();
        if (watchlist.length > 0) {
          console.log(`📋 Watchlist: ${watchlist.length} stocks being monitored`);

          // Check if any watchlist stocks are at target entry prices
          const opportunities = watchlist.filter(w => w.current_price <= w.target_entry_price);
          if (opportunities.length > 0) {
            console.log(`🎯 ${opportunities.length} watchlist stocks at or below target entry price`);
            console.log('   Consider running full analysis to evaluate these opportunities');
          }
        }

        // Brief news scan for major market events
        console.log('📰 Scanning for major market events...');
        const majorNews = await tavily.searchMarketNews(3);
        if (majorNews.length > 0) {
          console.log(`   Found ${majorNews.length} recent market headlines`);
        }
      }

      // Save portfolio snapshot
      await this.saveSnapshot(portfolio);

      // Run daily trend learning (learns from recent trades and patterns)
      console.log('🧠 Running daily trend learning...');
      const recentTrades = await db.getTradeHistory(10);
      await trendLearning.runDailyTrendLearning(portfolio.positions, recentTrades);

      console.log('\n═══════════════════════════════════════');
      console.log('✅ Daily analysis complete');
      console.log('═══════════════════════════════════════\n');

    } catch (error) {
      console.error('❌ Error in daily analysis:', error);
      await email.sendErrorAlert(error, 'Daily analysis');
    } finally {
      this.analysisRunning = false;
    }
  }

  /**
   * Handle stop-loss trigger
   */
  async handleStopLoss(symbol, portfolio) {
    console.log(`\n🛑 STOP-LOSS TRIGGERED: ${symbol}`);

    const position = portfolio.positions.find(p => p.symbol === symbol);
    if (!position) return;

    // Determine action based on position type
    const isShort = position.position_type === 'short';
    const action = isShort ? 'buy' : 'sell'; // Short: buy-to-close, Long: sell-to-close

    console.log(`🔴 Auto-executing stop-loss ${action} for ${symbol} (${isShort ? 'SHORT' : 'LONG'})...`);

    try {
      const result = await this.executeTrade(symbol, action, position.quantity, {
        reasoning: `Stop-loss triggered at $${position.currentPrice.toFixed(2)} (cost basis: $${position.cost_basis.toFixed(2)})`,
        sector: position.sector
      });

      if (result.success) {
        console.log(`✅ Stop-loss executed successfully`);
      } else {
        console.error(`❌ Stop-loss execution failed:`, result.errors);
        // Send alert email if auto-execution fails
        await email.sendErrorAlert(
          new Error(`Stop-loss auto-execution failed: ${result.errors?.join(', ')}`),
          `Stop-loss for ${symbol}`
        );
      }
    } catch (error) {
      console.error(`❌ Stop-loss execution error:`, error);
      await email.sendErrorAlert(error, `Stop-loss execution: ${symbol}`);
    }
  }

  /**
   * Handle position alert (20%+ loss)
   */
  async handlePositionAlert(symbol, portfolio) {
    const position = portfolio.positions.find(p => p.symbol === symbol);
    if (!position) return;

    const percentDown = ((position.currentPrice - position.cost_basis) / position.cost_basis) * 100;

    console.log(`\n⚠️ POSITION ALERT: ${symbol} down ${Math.abs(percentDown).toFixed(1)}%`);

    // Send email alert
    await email.sendPositionAlert(position, position.currentPrice, Math.abs(percentDown));

    // Evaluate with AI
    const evaluation = await analysisEngine.evaluateSellDecision(
      position,
      `Position down ${Math.abs(percentDown).toFixed(1)}%`
    );

    // Log AI decision
    await db.logAIDecision({
      type: 'position-review',
      symbol,
      recommendation: evaluation.analysis,
      reasoning: `Position down ${Math.abs(percentDown).toFixed(1)}%`,
      model: 'sonnet',
      confidence: 'medium'
    });

    console.log(`   📧 Alert email sent with AI analysis`);
  }

  /**
   * Handle take-profit opportunity
   */
  async handleTakeProfit(symbol, action, portfolio) {
    console.log(`\n💰 TAKE-PROFIT: ${symbol} - ${action.reason}`);

    const position = portfolio.positions.find(p => p.symbol === symbol);
    if (!position) return;

    const sellQuantity = Math.floor(position.quantity * action.percentage);
    const quote = await tradier.getQuote(symbol);

    // Send email recommendation
    await email.sendTradeRecommendation({
      action: 'sell',
      symbol,
      quantity: sellQuantity,
      price: quote.last,
      positionSize: action.percentage * 100,
      reasoning: action.reason,
      stopLoss: 0,
      takeProfit: 0
    });

    // Log AI decision
    await db.logAIDecision({
      type: 'take-profit',
      symbol,
      recommendation: `Sell ${action.percentage * 100}% of position`,
      reasoning: action.reason,
      model: 'risk-manager',
      confidence: 'high'
    });

    console.log(`   📧 Email sent for approval`);
  }

  /**
   * Run deep analysis with Claude Opus (Two-Phase Approach)
   */
  async runDeepAnalysis(portfolio, news, additionalContext = {}) {
    try {
      console.log('');
      console.log('═══════════════════════════════════════');
      console.log('🧠 STARTING DEEP ANALYSIS WITH OPUS');
      console.log('═══════════════════════════════════════');
      console.log('Portfolio: $' + portfolio.totalValue.toLocaleString());
      console.log('Positions:', portfolio.positions.length);
      console.log('Cash:', '$' + portfolio.cash.toLocaleString());
      console.log('');

      // Extract additional context
      const {
        cashContext = '',
        vixContext = '',
        macroContext = '',
        gapContext = '',
        performanceContext = '',
        sectorContext = '',
        optionsContext = ''
      } = additionalContext;

      // PHASE 1: Pre-rank stock universe to 100-150 candidates
      console.log('📊 PHASE 1: Pre-ranking stock universe...');
      const preRankedStocks = await preRanking.rankStocks();
      console.log(`   ✅ Pre-ranked to ${preRankedStocks.longs.length} long + ${preRankedStocks.shorts.length} short candidates`);
      console.log('');

      // Fetch market context (indices + portfolio stocks + pre-ranked candidates)
      console.log('📊 Fetching market context...');
      const portfolioSymbols = portfolio.positions.map(p => p.symbol);
      const marketIndices = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX', 'TLT', 'GLD', 'USO'];
      const candidateSymbols = [...preRankedStocks.longs, ...preRankedStocks.shorts];
      const phase1Symbols = [...new Set([...portfolioSymbols, ...marketIndices, ...candidateSymbols])];

      const phase1Quotes = await tradier.getQuotes(phase1Symbols.join(','));
      const marketContext = {};
      const quoteArray = Array.isArray(phase1Quotes) ? phase1Quotes : [phase1Quotes];

      quoteArray.forEach(q => {
        if (q && q.symbol) {
          marketContext[q.symbol] = {
            price: q.last,
            change: q.change,
            change_percentage: q.change_percentage,
            volume: q.volume
          };
        }
      });

      console.log(`✅ Fetched ${Object.keys(marketContext).length} market quotes`);
      console.log('');

      // Check value watchlist for momentum triggers
      console.log('💎 Checking value watchlist for momentum...');
      const valueMomentumTriggers = await fundamentalScreener.checkValueMomentum(marketContext);
      if (valueMomentumTriggers.length > 0) {
        console.log(`   🎯 ${valueMomentumTriggers.length} value stocks showing momentum!`);
        valueMomentumTriggers.forEach(trigger => {
          console.log(`      ${trigger.symbol}: ${trigger.changePercent} + ${trigger.volumeSurge}`);
        });
      } else {
        console.log(`   No value stocks showing momentum yet`);
      }
      console.log('');

      // Refresh portfolio prices with phase 1 data
      console.log('💰 Refreshing portfolio prices...');
      let pricesUpdated = 0;
      for (const position of portfolio.positions) {
        if (marketContext[position.symbol]) {
          const oldPrice = position.currentPrice;
          position.currentPrice = marketContext[position.symbol].price;
          if (oldPrice !== position.currentPrice) {
            console.log(`   ${position.symbol}: $${oldPrice} → $${position.currentPrice}`);
            pricesUpdated++;
          }
        }
      }
      console.log(`✅ Updated ${pricesUpdated} position prices`);
      console.log('');

      // Get previous analyses for trend detection
      console.log('📚 Fetching previous analyses for trend detection...');
      const previousAnalyses = await this.getPreviousAnalyses(3);

      let historyContext = '';
      if (previousAnalyses.length > 0) {
        console.log(`✅ Found ${previousAnalyses.length} previous analyses`);
        historyContext = '\n\n**PREVIOUS ANALYSES (for trend detection):**\n';
        previousAnalyses.forEach((analysis, i) => {
          historyContext += `\n${i + 1}. ${analysis.created_at}: ${analysis.recommendation.substring(0, 300)}...\n`;
        });
      } else {
        console.log('ℹ️  No previous analyses found (first run)');
      }

      // Get trend learning insights
      console.log('🧠 Fetching trend learning insights...');
      const trendInsights = await trendLearning.getUnappliedInsights();
      const recentTrends = await trendLearning.getRecentMarketTrends(30, 10);

      let trendContext = '';
      if (trendInsights.length > 0 || recentTrends.length > 0) {
        trendContext = '\n\n**LEARNING FROM PAST PATTERNS:**\n';

        if (trendInsights.length > 0) {
          trendContext += '\n**Key Insights to Apply:**\n';
          trendInsights.forEach(insight => {
            trendContext += `- ${insight.insight_text} (confidence: ${insight.confidence})\n`;
          });
        }

        if (recentTrends.length > 0) {
          trendContext += '\n**Recent Market Patterns:**\n';
          recentTrends.forEach(trend => {
            trendContext += `- ${trend.pattern_date}: ${trend.pattern_description} → ${trend.action_taken}\n`;
          });
        }

        console.log(`✅ Found ${trendInsights.length} insights and ${recentTrends.length} trend patterns`);
      } else {
        console.log('ℹ️  No trend learning data yet');
      }

      // Check watchlist for buy opportunities
      console.log('👀 Checking watchlist for buy opportunities...');
      const watchlist = await db.getWatchlist();
      const buyOpportunities = await db.getWatchlistBuyOpportunities();

      let watchlistContext = '';
      if (watchlist.length > 0) {
        watchlistContext = '\n\n**WATCHLIST (stocks you are monitoring):**\n';
        watchlist.forEach(item => {
          const assetClass = assetClassData.getAssetClass(item.symbol);
          const atTarget = item.current_price <= item.target_entry_price ? '✅ AT TARGET' : '';
          watchlistContext += `- ${item.symbol} (${assetClass}): Current $${item.current_price}, Target Entry $${item.target_entry_price} ${atTarget}\n`;
          watchlistContext += `  Why watching: ${item.why_watching}\n`;
          watchlistContext += `  Why not buying now: ${item.why_not_buying_now}\n\n`;
        });
        console.log(`   Found ${watchlist.length} stocks on watchlist`);
        if (buyOpportunities.length > 0) {
          console.log(`   🎯 ${buyOpportunities.length} stocks at or below target entry price!`);
        }
      } else {
        console.log('   Watchlist is empty');
      }

      // Get correlation analysis for portfolio
      console.log('🔗 Analyzing portfolio correlation...');
      const correlationSummary = correlationAnalysis.getPortfolioCorrelationSummary(portfolio.positions);
      const diversificationScore = correlationAnalysis.calculateDiversificationScore(portfolio.positions);

      let correlationContext = '\n\n**PORTFOLIO CORRELATION ANALYSIS:**\n';
      correlationContext += `- Diversification Score: ${diversificationScore}/100\n`;

      if (correlationSummary.hasConcentration) {
        correlationContext += '\n⚠️ **Concentrated Groups (multiple positions in same correlation group):**\n';
        correlationSummary.concentratedGroups.forEach(group => {
          correlationContext += `- ${group.group}: ${group.count} positions, $${group.value.toLocaleString()} total value\n`;
        });
        correlationContext += '\n**Important:** Avoid adding more positions to concentrated groups. Seek diversification across different correlation groups.\n';
      } else {
        correlationContext += '- No concentrated correlation groups detected\n';
      }

      console.log(`   Diversification score: ${diversificationScore}/100`);
      if (correlationSummary.hasConcentration) {
        console.log(`   ⚠️ Found ${correlationSummary.concentratedGroups.length} concentrated groups`);
      }

      // Get earnings and tax data for existing positions
      console.log('📅 Gathering earnings and tax data...');
      const lots = await db.getAllPositionLots();

      let earningsAndTaxContext = '\n\n**EXISTING POSITIONS - EARNINGS & TAX STATUS:**\n';
      for (const position of portfolio.positions) {
        const positionLots = lots.filter(l => l.symbol === position.symbol && l.quantity > 0);
        const earning = await db.getNextEarning(position.symbol);

        earningsAndTaxContext += `\n**${position.symbol}:**\n`;

        // Earnings info
        if (earning) {
          const earningsDate = new Date(earning.earnings_date);
          const today = new Date();
          const daysUntil = Math.floor((earningsDate - today) / (1000 * 60 * 60 * 24));

          if (daysUntil >= 0 && daysUntil <= 7) {
            earningsAndTaxContext += `- ⚠️ EARNINGS in ${daysUntil} days (${earning.earnings_date}, ${earning.earnings_time})\n`;
          }
        }

        // Tax status for each lot
        positionLots.forEach(lot => {
          const daysToLongTerm = lot.days_to_long_term || 0;
          if (daysToLongTerm > 0 && daysToLongTerm <= 30) {
            earningsAndTaxContext += `- 🏛️ ${lot.quantity} shares → Long-term in ${daysToLongTerm} days (${lot.days_held || 0} days held)\n`;
          }
        });
      }

      console.log('   ✅ Earnings and tax data compiled');
      console.log('');

      // PHASE 1 PROMPT: Select 25-35 stocks from pre-ranked candidates
      const phase1Question = `You are managing a $100k portfolio.

**PHASE 1: Select 25-35 stocks from pre-ranked candidates for deep analysis**

**Current Portfolio:**
- Positions: ${portfolio.positions.length}
- Total Value: $${portfolio.totalValue.toLocaleString()}
- Cash Available: $${portfolio.cash.toLocaleString()}

**Market Context:**
${Object.entries(marketContext).map(([sym, data]) => `- ${sym}: $${data.price} (${data.change_percentage >= 0 ? '+' : ''}${data.change_percentage}%)`).join('\n')}

**Recent News:**
${news}

${watchlistContext}

**Pre-Ranked Candidates (algorithmic filter based on volume surge, momentum, sector strength):**

**Long Candidates (${preRankedStocks.longs.length} stocks):**
${preRankedStocks.longs.join(', ')}

**Short Candidates (${preRankedStocks.shorts.length} stocks):**
${preRankedStocks.shorts.join(', ')}

**Your Task for Phase 1:**
1. Review the pre-ranked candidates above
2. Select 25-35 stocks total (mix of longs and shorts) for deep analysis in Phase 2
3. Prioritize:
   - Watchlist stocks that are at or near target entry prices
   - Stocks with strong fundamental catalysts (earnings, news, sector rotation)
   - Diversification across asset classes and sub-sectors
4. **IMPORTANT: Max 3-4 stocks from the same sub-sector** (e.g., max 3-4 semiconductors, max 3-4 software stocks)
   - Sub-sectors include: Semiconductors, Software, Cybersecurity, Cloud Computing, Biotechnology, Pharmaceuticals, Banks, etc.
   - This prevents over-concentration in a specific industry

Format your response EXACTLY like this:
SELECTED_STOCKS_FOR_ANALYSIS:
MSFT
PANW
CRWD
LLY
ABBV
...
(25-35 stocks total)

REASONING:
[Brief explanation of your selection criteria and sector diversification]

${historyContext}

${trendContext}`;

      console.log('📝 PHASE 1: Asking Opus to select 25-35 stocks from pre-ranked candidates...');
      console.log('⏳ This will take 1-2 minutes...');
      console.log('');

      const phase1Start = Date.now();
      const phase1Analysis = await claude.deepAnalysis(
        portfolio,
        marketContext,
        news,
        {},
        phase1Question
      );
      const phase1Duration = ((Date.now() - phase1Start) / 1000).toFixed(1);

      console.log(`✅ Phase 1 complete (${phase1Duration}s)`);
      console.log('');

      // Extract tickers from Phase 1 response
      const tickersToAnalyze = this.extractTickers(phase1Analysis.analysis);
      console.log(`🎯 Opus identified ${tickersToAnalyze.length} stocks to analyze:`);
      console.log(`   ${tickersToAnalyze.join(', ')}`);
      console.log('');

      // PHASE 2: Fetch prices for identified stocks
      console.log('📊 PHASE 2: Fetching prices for identified stocks...');
      const allSymbols = [...new Set([...portfolioSymbols, ...marketIndices, ...tickersToAnalyze])];
      const phase2Quotes = await tradier.getQuotes(allSymbols.join(','));

      const fullMarketData = {};
      const phase2Array = Array.isArray(phase2Quotes) ? phase2Quotes : [phase2Quotes];

      phase2Array.forEach(q => {
        if (q && q.symbol) {
          fullMarketData[q.symbol] = {
            price: q.last,
            change: q.change,
            change_percentage: q.change_percentage,
            volume: q.volume,
            bid: q.bid,
            ask: q.ask
          };
        }
      });

      console.log(`✅ Fetched ${Object.keys(fullMarketData).length} total quotes`);
      console.log('');

      // Get market regime for allocation guidance
      console.log('📈 Detecting market regime...');
      const marketRegime = await riskManager.getMarketRegime();
      const targetAllocation = riskManager.getTargetAllocation(marketRegime);
      console.log(`   Market regime: ${marketRegime.toUpperCase()}`);
      console.log(`   Target allocation: ${(targetAllocation.long * 100).toFixed(0)}% long, ${(targetAllocation.short * 100).toFixed(0)}% short, ${(targetAllocation.cash * 100).toFixed(0)}% cash`);

      // Get asset class allocation context from allocation manager
      const assetClassContext = await allocationManager.buildAllocationContext(portfolio);

      const marketRegimeContext = `\n\n**MARKET REGIME: ${marketRegime.toUpperCase()}**
- SPY vs 200MA: ${marketRegime === 'bull' ? 'Above rising 200MA (bullish)' : marketRegime === 'bear' ? 'Below declining 200MA (bearish)' : 'Mixed signals (transitional)'}
- Target allocation: ${(targetAllocation.long * 100).toFixed(0)}% long, ${(targetAllocation.short * 100).toFixed(0)}% short, ${(targetAllocation.cash * 100).toFixed(0)}% cash
- Current allocation: ${((portfolio.positionsValue / portfolio.totalValue) * 100).toFixed(0)}% invested, ${((portfolio.cash / portfolio.totalValue) * 100).toFixed(0)}% cash
${marketRegime === 'bull' ? '- Focus: High-conviction longs, tactical shorts as hedges' : marketRegime === 'bear' ? '- Focus: Defensive longs, increase short exposure' : '- Focus: Balanced approach, prepare for either direction'}`;

      // PHASE 2 PROMPT: Make final trade decisions with current prices
      const phase2Question = `You are managing a $100k portfolio. Analyze and provide SPECIFIC trade recommendations.

**Current Portfolio:**
- Positions: ${portfolio.positions.length}
- Total Value: $${portfolio.totalValue.toLocaleString()}
- Cash Available: $${portfolio.cash.toLocaleString()}

${cashContext}

${vixContext}

${macroContext}

${gapContext}

${performanceContext}

${sectorContext}

${optionsContext}

${marketRegimeContext}

${assetClassContext}

**Capital Deployment Mandate:**
- You are managing $100,000 and holding $${portfolio.cash.toLocaleString()} in cash (${((portfolio.cash/portfolio.totalValue)*100).toFixed(1)}% idle)
- Idle cash is a drag on performance. The TARGET is 10-20% cash maximum (dry powder for dips).
- With ${portfolio.positions.length} positions and a target of 10-12, you have room for ${12 - portfolio.positions.length} more positions.
- You do NOT need perfect conditions to deploy. Good enough is good enough.
- If you can identify 2-3 high-quality setups, deploy into them.
- Holding >50% cash REQUIRES a specific written justification (e.g., "VIX > 30 + inverted yield curve").
- Quality AND quantity matter. A portfolio of 2 stocks is not diversified — it's concentrated risk.

${watchlistContext}

**Portfolio Construction Mandate:**
- Current cash: $${portfolio.cash.toLocaleString()} (${((portfolio.cash/portfolio.totalValue)*100).toFixed(1)}% of portfolio)
- Current positions: ${portfolio.positions.length} (target: 10-12)
- Positions needed to reach target: ${Math.max(0, 10 - portfolio.positions.length)}
- If you recommend ZERO new positions, you MUST provide specific reasoning why current market conditions justify staying in cash (e.g., "VIX > 25 + negative breadth" or "Awaiting Fed decision tomorrow").
- Default posture: deploy into good setups. Cash requires justification, not deployment.

${correlationContext}

${earningsAndTaxContext}

**Your Task:**
1. **WATCHLIST UPDATE:** For each stock you want to monitor (but not buy yet):
   - Symbol, Sub-industry, Current Price
   - Target Entry Price (price you'd buy at)
   - Target Exit Price (profit target)
   - Why watching (what makes it interesting)
   - Why not buying now (what you're waiting for)

   Format: WATCHLIST_ADD: AAPL | Technology | $280 | $250 | $320 | Strong fundamentals | Waiting for pullback

2. **BUY RECOMMENDATIONS:** Which stocks to buy NOW? For EACH recommendation provide:
   - Symbol and company name
   - Quantity (exact number of shares)
   - Entry price (current market price)
   - Position size (% of portfolio)
   - **STOP-LOSS:** Exact price level and % below entry (explain why this level)
   - **TAKE-PROFIT:** Target price and expected gain % (explain reasoning)
   - Sector and stock type (mega-cap/large-cap/mid-cap)
   - Full reasoning (fundamentals + technicals + macro)

   **CRITICAL: Use this EXACT format for executable trades:**
   EXECUTE_BUY: SYMBOL | QUANTITY | ENTRY_PRICE | STOP_LOSS | TAKE_PROFIT

   Example: EXECUTE_BUY: MSFT | 100 | 400.50 | 360.00 | 450.00

   Then provide your full reasoning below the EXECUTE_BUY line.

3. **SHORT RECOMMENDATIONS:** Which stocks to short NOW? For EACH short provide:
   - Symbol and company name
   - Quantity (exact number of shares)
   - Entry price (current market price)
   - **STOP-LOSS:** Exact price level ABOVE entry (inverse logic - triggers on price RISE)
   - **TAKE-PROFIT:** Target price BELOW entry (profit on decline)
   - Technical confirmation (declining 200MA, RSI not oversold, no near-term earnings)
   - Full reasoning (why overvalued, deteriorating fundamentals, technical breakdown)

   **CRITICAL: Use this EXACT format for executable shorts:**
   EXECUTE_SHORT: SYMBOL | QUANTITY | ENTRY_PRICE | STOP_LOSS | TAKE_PROFIT

   Example: EXECUTE_SHORT: XYZ | 50 | 150.00 | 165.00 | 120.00
   (Stop at $165 = 10% above entry, profit target at $120 = 20% below entry)

   Then provide your full reasoning below the EXECUTE_SHORT line.

4. **SELL/TRIM:** Any current positions to sell or trim?
5. **SECTOR ANALYSIS:** Which sectors look strong/weak based on macro environment?
6. **TREND DETECTION:** Any patterns from previous analyses?

**Stop-Loss Guidelines (you decide final levels):**
- Index ETFs: -10 to -12%
- Blue-chip/Mega-cap: -10 to -12%
- Large-cap growth: -13 to -15%
- Mid-cap: -15 to -18%
- Adjust based on volatility and conviction

**Investment Rules:**
- Regular stocks only (no crypto, no penny stocks)
- Max 12% per position (down from 15%)
- 10-12 positions max
- Diversify across sectors
- YOU decide which sectors to focus/avoid based on current macro environment

**CASH MANAGEMENT PHILOSOPHY:**
- 10% cash is the TARGET BUFFER — dry powder for opportunities, not a sacred minimum
- If you find a high-conviction setup and cash is low: DEPLOY IT. Going to 0% cash is acceptable
  when the opportunity justifies it.
- When cash is DEPLOYED or ZERO: Always evaluate rotation before recommending a new buy.
  Rotation = sell or trim a weaker position to fund a better one. This is active portfolio management.
- When recommending a rotation: explain which position you'd exit and why the new opportunity
  is a better use of that capital right now.
- After capital is freed (stop-loss hit, take-profit, or manual exit): rebuild toward 10% cash
  by being selective about the next entry — don't immediately redeploy into the first thing you see.
- Never sell a strong position with an intact thesis purely to hit a cash target. Let winners run.

**Be SPECIFIC:**
✅ "BUY 10 shares AAPL at $255. Stop-loss: $230 (-9.8%). Take-profit: $295 (+15.7%). Reasoning: Strong iPhone sales..."
❌ "Consider buying tech stocks"

**OPTIONAL: For easier parsing, you can also provide a JSON block at the end:**
\`\`\`json
{
  "trades": [
    {
      "action": "buy",
      "symbol": "MSFT",
      "quantity": 50,
      "entry_price": 415.00,
      "stop_loss": 385.00,
      "take_profit": 460.00,
      "sector": "Technology",
      "reasoning": "Strong Azure growth..."
    }
  ]
}
\`\`\`

${historyContext}`;

      console.log('📝 PHASE 2: Sending final question to Opus...');
      console.log('⏳ Extended thinking enabled (50,000 tokens MAX)');
      console.log('⏳ Temperature: 1 (creative, diverse)');
      console.log('⏳ This will take 3-7 minutes...');
      console.log('');

      const phase2Start = Date.now();
      const analysis = await claude.deepAnalysis(
        portfolio,
        fullMarketData,
        news,
        {},
        phase2Question
      );
      const phase2Duration = ((Date.now() - phase2Start) / 1000).toFixed(1);
      const totalDuration = ((Date.now() - phase1Start) / 1000).toFixed(1);

      console.log('');
      console.log('═══════════════════════════════════════');
      console.log('✅ OPUS ANALYSIS COMPLETE');
      console.log('═══════════════════════════════════════');
      console.log('Phase 1 Duration:', phase1Duration, 'seconds');
      console.log('Phase 2 Duration:', phase2Duration, 'seconds');
      console.log('Total Duration:', totalDuration, 'seconds');
      console.log('Response length:', analysis.analysis.length, 'characters');
      console.log('Model used:', analysis.model);

      // Display token usage
      if (analysis.usage) {
        const totalTokens = (analysis.usage.input_tokens || 0) + (analysis.usage.output_tokens || 0);
        console.log('');
        console.log('📊 TOKEN USAGE:');
        console.log('   Input tokens:', (analysis.usage.input_tokens || 0).toLocaleString());
        console.log('   Output tokens:', (analysis.usage.output_tokens || 0).toLocaleString());
        console.log('   Total tokens:', totalTokens.toLocaleString());
      }

      console.log('');
      console.log('📊 ANALYSIS PREVIEW (first 1500 chars):');
      console.log('─────────────────────────────────────');
      console.log(analysis.analysis.substring(0, 1500));
      console.log('─────────────────────────────────────');
      console.log('');

      // Thinking block is stored internally but not displayed to user

      console.log('💾 Saving analysis to database...');

      // Log the decision with token usage
      const analysisId = await db.logAIDecision({
        type: 'deep-analysis',
        symbol: null,
        recommendation: analysis.analysis,
        reasoning: `Two-phase deep analysis. Phase 1: ${tickersToAnalyze.length} stocks identified. Phase 2: Final recommendations with real-time prices.`,
        model: 'opus',
        confidence: 'high',
        inputTokens: analysis.usage?.input_tokens,
        outputTokens: analysis.usage?.output_tokens,
        totalTokens: (analysis.usage?.input_tokens || 0) + (analysis.usage?.output_tokens || 0),
        durationSeconds: parseInt(totalDuration)
      });

      console.log('✅ Analysis saved to database');
      console.log('');

      // Mark trend insights as applied
      if (trendInsights.length > 0) {
        console.log('📝 Marking trend insights as applied...');
        for (const insight of trendInsights) {
          await trendLearning.markInsightApplied(insight.id, 'pending');
        }
        console.log(`✅ Marked ${trendInsights.length} insights as applied`);
      }

      // Save this analysis to trend learning for future reference
      console.log('🧠 Saving analysis to trend learning...');
      await trendLearning.saveMarketTrendPattern({
        date: new Date().toISOString().split('T')[0],
        type: 'daily-analysis',
        description: `Market analysis with ${tickersToAnalyze.length} stocks analyzed`,
        actionTaken: analysis.analysis.substring(0, 500) // First 500 chars as summary
      });
      console.log('✅ Trend pattern saved');
      console.log('');

      // Save stock analyses to learning database for each analyzed ticker
      console.log('💾 Saving stock analyses to learning database...');
      const { saveStockAnalysis } = await import('./trend-learning.js');

      for (const ticker of tickersToAnalyze) {
        try {
          // Extract analysis for this specific ticker from the full analysis text
          const tickerMention = analysis.analysis.includes(ticker);
          if (tickerMention) {
            await saveStockAnalysis({
              symbol: ticker,
              date: new Date().toISOString().split('T')[0],
              type: 'daily',
              price: marketContext[ticker]?.price || 0,
              thesis: `Analyzed in daily deep analysis with ${tickersToAnalyze.length} stocks`,
              recommendation: analysis.analysis.includes(`BUY: ${ticker}`) ? 'buy' :
                            analysis.analysis.includes(`SHORT: ${ticker}`) ? 'short' : 'hold',
              confidence: 'medium',
              keyFactors: [`Included in ${tickersToAnalyze.length}-stock analysis`, `VIX: ${regime.vix}`]
            });
          }
        } catch (error) {
          console.warn(`⚠️ Could not save analysis for ${ticker}:`, error.message);
        }
      }
      console.log(`✅ Saved ${tickersToAnalyze.length} stock analyses to learning database`);
      console.log('');

      // Parse recommendations and execute trades automatically
      console.log('🔍 Parsing trade recommendations...');
      const recommendations = this.parseRecommendations(analysis.analysis);

      if (recommendations.length > 0) {
        console.log(`✅ Found ${recommendations.length} trade recommendations`);

        // Get portfolio state and VIX regime
        const portfolio = await analysisEngine.getPortfolioState();
        const regime = await vixRegime.getRegime();

        // STEP 1: Apply VIX adjustment to all trade quantities BEFORE sector validation
        console.log(`\n📊 Applying VIX regime adjustments (${regime.name}: ${(regime.positionSizeMultiplier * 100).toFixed(0)}% multiplier)...`);
        for (const rec of recommendations) {
          const originalQuantity = rec.quantity;
          const tradeValue = originalQuantity * rec.entryPrice;
          const originalPositionSize = tradeValue / portfolio.totalValue;

          // Apply VIX multiplier
          const adjustedPositionSize = originalPositionSize * regime.positionSizeMultiplier;
          const adjustedQuantity = Math.floor((adjustedPositionSize * portfolio.totalValue) / rec.entryPrice);

          rec.quantity = adjustedQuantity;
          rec.vixAdjusted = true;
          rec.originalQuantity = originalQuantity;

          if (adjustedQuantity !== originalQuantity) {
            console.log(`   ${rec.symbol}: ${originalQuantity} → ${adjustedQuantity} shares (${(originalPositionSize * 100).toFixed(1)}% → ${(adjustedPositionSize * 100).toFixed(1)}%)`);
          }
        }

        // STEP 2: Validate asset class allocation with VIX-adjusted quantities
        const adjustedRecs = await this.validateAndAdjustAssetClassAllocation(recommendations, portfolio);

        for (const rec of adjustedRecs) {
          const action = rec.type === 'short' ? 'SHORT' : 'BUY';
          console.log(`   💰 Executing trade: ${action} ${rec.quantity} ${rec.symbol} at $${rec.entryPrice}...`);

          try {
            if (rec.type === 'short') {
              // Execute short trade with safeguards
              const portfolio = await analysisEngine.getPortfolioState();

              // Check ETB status first
              const etbCheck = await shortManager.isShortable(rec.symbol, 5000000000); // Assume $5B+ market cap for now
              if (!etbCheck.shortable) {
                console.log(`   ⚠️ Short blocked: ${etbCheck.errors.join(', ')}`);
                continue;
              }

              // Check if short is allowed
              const shortCheck = await shortManager.canShort(
                rec.symbol,
                rec.quantity,
                rec.entryPrice,
                portfolio.totalValue
              );

              if (!shortCheck.allowed) {
                console.log(`   ⚠️ Short blocked: ${shortCheck.errors.join(', ')}`);
                continue;
              }

              // Place short with protection
              await shortManager.placeShortWithProtection(
                rec.symbol,
                rec.quantity,
                rec.entryPrice,
                rec.stopLoss,
                rec.takeProfit
              );

              console.log(`   ✅ Short executed successfully`);
            } else {
              // Execute long trade with Opus's recommended stops
              await this.executeTrade(rec.symbol, 'buy', rec.quantity, {
                sector: rec.sector,
                stopLoss: rec.stopLoss,
                takeProfit: rec.takeProfit,
                reasoning: rec.reasoning
              });

              console.log(`   ✅ Trade executed successfully`);
            }

            // Send email notification AFTER execution
            await email.sendTradeConfirmation({
              action: rec.type === 'short' ? 'short' : 'buy',
              symbol: rec.symbol,
              quantity: rec.quantity,
              price: rec.entryPrice,
              stopLoss: rec.stopLoss,
              takeProfit: rec.takeProfit,
              reasoning: rec.reasoning
            });

            console.log(`   📧 Confirmation email sent`);
          } catch (error) {
            console.error(`   ❌ Failed to execute trade for ${rec.symbol}:`, error.message);
            await email.sendErrorAlert(error, `Trade execution: ${rec.symbol}`);
          }
        }

        console.log('✅ All trades processed');
      } else {
        console.log('ℹ️  No trade recommendations found (holding cash)');
      }
      console.log('');

      // Parse and update watchlist
      console.log('👀 Parsing watchlist updates...');
      const watchlistItems = this.parseWatchlist(analysis.analysis);

      if (watchlistItems.length > 0) {
        console.log(`✅ Found ${watchlistItems.length} watchlist items`);

        for (const item of watchlistItems) {
          try {
            await db.addToWatchlist(item);
            console.log(`   ✅ Added ${item.symbol} to watchlist (target: $${item.target_entry_price})`);
          } catch (error) {
            console.error(`   ❌ Failed to add ${item.symbol} to watchlist:`, error.message);
          }
        }

        console.log('✅ Watchlist updated');
      } else {
        console.log('ℹ️  No watchlist updates');
      }
      console.log('');

    } catch (error) {
      console.error('');
      console.error('═══════════════════════════════════════');
      console.error('❌ ERROR IN DEEP ANALYSIS');
      console.error('═══════════════════════════════════════');
      console.error('Error message:', error.message);
      console.error('Error type:', error.constructor.name);
      if (error.response) {
        console.error('API response:', error.response.data);
      }
      console.error('Stack trace:', error.stack);
      console.error('═══════════════════════════════════════');
      console.error('');
    }
  }

  /**
   * Extract ticker symbols from Phase 1 analysis
   */
  extractTickers(analysisText) {
    const tickers = [];

    // Look for "SELECTED_STOCKS_FOR_ANALYSIS:" section (new format)
    let tickerSection = analysisText.match(/SELECTED_STOCKS_FOR_ANALYSIS:[\s\S]*?(?=\n\n|REASONING:|$)/i);

    // Fallback to old format "TICKERS_TO_ANALYZE:"
    if (!tickerSection) {
      tickerSection = analysisText.match(/TICKERS_TO_ANALYZE:[\s\S]*?(?=\n\n|$)/i);
    }

    if (tickerSection) {
      const lines = tickerSection[0].split('\n');
      for (const line of lines) {
        const match = line.match(/\b([A-Z]{1,5})\b/);
        if (match && match[1] !== 'TICKERS' && match[1] !== 'TO' && match[1] !== 'ANALYZE' &&
            match[1] !== 'SELECTED' && match[1] !== 'STOCKS' && match[1] !== 'FOR' && match[1] !== 'ANALYSIS') {
          tickers.push(match[1]);
        }
      }
    }

    // Fallback: extract any stock tickers mentioned
    if (tickers.length === 0) {
      const matches = analysisText.match(/\b[A-Z]{2,5}\b/g);
      if (matches) {
        const commonWords = new Set(['THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW', 'ITS', 'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WAY', 'WHO', 'BOY', 'DID', 'ITS', 'LET', 'PUT', 'SAY', 'SHE', 'TOO', 'USE']);
        matches.forEach(ticker => {
          if (!commonWords.has(ticker) && ticker.length >= 2 && ticker.length <= 5) {
            tickers.push(ticker);
          }
        });
      }
    }

    // Remove duplicates and limit to 35 (increased from 20)
    return [...new Set(tickers)].slice(0, 35);
  }

  /**
   * Get previous analyses for trend detection
   */
  async getPreviousAnalyses(limit = 3) {
    try {
      const { default: pool } = await import('./db.js');
      const result = await pool.query(
        `SELECT created_at, recommendation FROM ai_decisions
         WHERE decision_type = 'deep-analysis'
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      );
      return result.rows;
    } catch (error) {
      console.error('Error fetching previous analyses:', error.message);
      return [];
    }
  }

  /**
   * Validate and adjust recommendations to fit within sector allocation limits
   * Groups trades by sector and adjusts quantities to stay under 30% per sector
   */
  async validateAndAdjustAssetClassAllocation(recommendations, portfolio) {
    console.log(`\n📊 Validating asset class allocation...`);

    // Get current asset class allocation
    const currentAllocation = allocationManager.calculateAssetClassAllocation(portfolio);

    // Get dynamic limits for all asset classes
    const limits = await allocationManager.getAllAssetClassLimits();

    // Group recommendations by asset class
    const recsByAssetClass = {};
    for (const rec of recommendations) {
      const assetClass = assetClassData.getAssetClass(rec.symbol);
      if (!recsByAssetClass[assetClass]) {
        recsByAssetClass[assetClass] = [];
      }
      recsByAssetClass[assetClass].push(rec);
    }

    const adjustedRecs = [];

    console.log('\n📊 Validating asset class allocation for all trades...');

    for (const [assetClass, recs] of Object.entries(recsByAssetClass)) {
      const currentValue = (currentAllocation[assetClass] || 0) * portfolio.totalValue;
      const currentPct = (currentAllocation[assetClass] || 0) * 100;
      const limit = limits[assetClass];

      // Calculate total value of new trades in this asset class
      const newTradesValue = recs.reduce((sum, rec) => sum + (rec.quantity * rec.entryPrice), 0);
      const totalValue = currentValue + newTradesValue;
      const totalPct = (totalValue / portfolio.totalValue) * 100;

      console.log(`\n   ${assetClass}:`);
      console.log(`     Current: ${currentPct.toFixed(1)}%`);
      console.log(`     After trades: ${totalPct.toFixed(1)}%`);
      console.log(`     Limit: ${(limit * 100).toFixed(0)}%`);

      if (totalPct <= limit * 100) {
        // All trades fit within limit
        console.log(`     ✅ All ${recs.length} trades fit within limit`);
        adjustedRecs.push(...recs);
      } else {
        // Need to adjust - reduce quantities proportionally
        const availableRoom = (limit * portfolio.totalValue) - currentValue;
        const reductionFactor = availableRoom / newTradesValue;

        console.log(`     ⚠️ Would exceed limit - adjusting quantities (${(reductionFactor * 100).toFixed(0)}% of original)`);

        for (const rec of recs) {
          const adjustedQuantity = Math.floor(rec.quantity * reductionFactor);
          if (adjustedQuantity > 0) {
            adjustedRecs.push({
              ...rec,
              quantity: adjustedQuantity,
              originalQuantity: rec.quantity
            });
            console.log(`       ${rec.symbol}: ${rec.quantity} → ${adjustedQuantity} shares`);
          } else {
            console.log(`       ${rec.symbol}: SKIPPED (would be 0 shares after adjustment)`);
          }
        }
      }
    }

    console.log(`\n   Final: ${adjustedRecs.length} trades approved (${recommendations.length - adjustedRecs.length} skipped/adjusted)\n`);

    return adjustedRecs;
  }

  /**
   * Parse trade recommendations from Opus analysis
   * Uses strict sentinel pattern to prevent false positives from news content
   *
   * Required format: EXECUTE_BUY: SYMBOL | QUANTITY | ENTRY_PRICE | STOP_LOSS | TAKE_PROFIT
   * Example: EXECUTE_BUY: MSFT | 100 | 400.50 | 360.00 | 450.00
   */
  parseRecommendations(analysisText) {
    const recommendations = [];

    try {
      // Try JSON parsing first
      const jsonMatch = analysisText.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.trades && Array.isArray(parsed.trades)) {
            console.log('✅ Parsed trades from JSON block');
            return parsed.trades.map(t => ({
              type: t.action === 'short' ? 'short' : 'long',
              symbol: t.symbol,
              quantity: t.quantity,
              entryPrice: t.entry_price,
              stopLoss: t.stop_loss,
              takeProfit: t.take_profit,
              assetClass: t.asset_class || assetClassData.getAssetClass(t.symbol),
              reasoning: t.reasoning || ''
            }));
          }
        } catch (jsonError) {
          console.warn('⚠️ JSON block found but failed to parse, falling back to regex');
        }
      }

      // Fallback to regex parsing
      // Parse EXECUTE_BUY
      const buyPattern = /EXECUTE_BUY:\s*([A-Z]{1,5})\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/gi;

      let match;
      while ((match = buyPattern.exec(analysisText)) !== null) {
        const symbol = match[1];
        const quantity = parseInt(match[2]);
        const entryPrice = parseFloat(match[3]);
        const stopLoss = parseFloat(match[4]);
        const takeProfit = parseFloat(match[5]);

        // Validate stop-loss and take-profit for longs
        if (stopLoss >= entryPrice) {
          console.warn(`⚠️ Invalid stop-loss for ${symbol}: $${stopLoss} must be below entry $${entryPrice}`);
          continue;
        }

        if (takeProfit <= entryPrice) {
          console.warn(`⚠️ Invalid take-profit for ${symbol}: $${takeProfit} must be above entry $${entryPrice}`);
          continue;
        }

        const textAfter = analysisText.substring(match.index + match[0].length, match.index + match[0].length + 500);

        // Get asset class for symbol
        const assetClass = assetClassData.getAssetClass(symbol);

        recommendations.push({
          type: 'long',
          symbol,
          quantity,
          entryPrice,
          stopLoss,
          takeProfit,
          assetClass,
          reasoning: textAfter.trim()
        });
      }

      // Parse EXECUTE_SHORT
      const shortPattern = /EXECUTE_SHORT:\s*([A-Z]{1,5})\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/gi;

      while ((match = shortPattern.exec(analysisText)) !== null) {
        const symbol = match[1];
        const quantity = parseInt(match[2]);
        const entryPrice = parseFloat(match[3]);
        const stopLoss = parseFloat(match[4]);
        const takeProfit = parseFloat(match[5]);

        // Validate stop-loss and take-profit for shorts (inverse logic)
        if (stopLoss <= entryPrice) {
          console.warn(`⚠️ Invalid stop-loss for SHORT ${symbol}: $${stopLoss} must be ABOVE entry $${entryPrice}`);
          continue;
        }

        if (takeProfit >= entryPrice) {
          console.warn(`⚠️ Invalid take-profit for SHORT ${symbol}: $${takeProfit} must be BELOW entry $${entryPrice}`);
          continue;
        }

        const textAfter = analysisText.substring(match.index + match[0].length, match.index + match[0].length + 500);

        // Get asset class for symbol
        const assetClass = assetClassData.getAssetClass(symbol);

        recommendations.push({
          type: 'short',
          symbol,
          quantity,
          entryPrice,
          stopLoss,
          takeProfit,
          assetClass,
          reasoning: textAfter.trim()
        });
      }

      if (recommendations.length === 0) {
        console.log('ℹ️ No EXECUTE_BUY or EXECUTE_SHORT commands found in analysis');
        console.log('   Expected format: EXECUTE_BUY: SYMBOL | QUANTITY | ENTRY | STOP | TARGET');
        console.log('   Or: EXECUTE_SHORT: SYMBOL | QUANTITY | ENTRY | STOP | TARGET');
      }

      return recommendations;
    } catch (error) {
      console.error('Error parsing recommendations:', error.message);
      return [];
    }
  }

  /**
   * Parse watchlist items from analysis
   * Format: WATCHLIST_ADD: SYMBOL | Asset Class | $CurrentPrice | $TargetEntry | $TargetExit | Why watching | Why not now
   */
  parseWatchlist(analysisText) {
    const watchlistItems = [];

    try {
      const watchlistPattern = /WATCHLIST_ADD:\s*([A-Z]{1,5})\s*\|\s*([^|]+)\|\s*\$?([\d.]+)\s*\|\s*\$?([\d.]+)\s*\|\s*\$?([\d.]+)\s*\|\s*([^|]+)\|\s*([^|\n]+)/gi;

      let match;
      while ((match = watchlistPattern.exec(analysisText)) !== null) {
        const symbol = match[1].trim();
        watchlistItems.push({
          symbol: symbol,
          asset_class: assetClassData.getAssetClass(symbol),
          current_price: parseFloat(match[3]),
          target_entry_price: parseFloat(match[4]),
          target_exit_price: parseFloat(match[5]),
          why_watching: match[6].trim(),
          why_not_buying_now: match[7].trim()
        });
      }

      return watchlistItems;
    } catch (error) {
      console.error('Error parsing watchlist:', error.message);
      return [];
    }
  }

  /**
   * Save portfolio snapshot
   */
  async saveSnapshot(portfolio) {
    try {
      const today = new Date().toISOString().split('T')[0];

      // Get previous day's snapshot for daily change calculation
      let dailyChange = 0;
      let sp500Return = 0;

      try {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const prevSnapshot = await db.query(
          `SELECT total_value FROM portfolio_snapshots WHERE snapshot_date = $1`,
          [yesterday]
        );

        if (prevSnapshot.rows.length > 0) {
          const prevValue = parseFloat(prevSnapshot.rows[0].total_value);
          dailyChange = (portfolio.totalValue - prevValue) / prevValue;
        }
      } catch (error) {
        console.error('Error calculating daily change:', error);
      }

      // Fetch S&P 500 return for comparison
      try {
        const spyQuote = await tradier.getQuote('SPY');
        if (spyQuote && spyQuote.change_percentage) {
          sp500Return = spyQuote.change_percentage / 100; // Convert to decimal
        }
      } catch (error) {
        console.error('Error fetching S&P 500 return:', error);
      }

      // Calculate total return from initial capital
      const initialCapital = parseFloat(process.env.INITIAL_CAPITAL) || 100000;
      const totalReturn = (portfolio.totalValue - initialCapital) / initialCapital;

      await db.savePortfolioSnapshot({
        total_value: portfolio.totalValue,
        cash: portfolio.cash,
        positions_value: portfolio.positionsValue,
        daily_change: dailyChange,
        total_return: totalReturn,
        sp500_return: sp500Return,
        snapshot_date: today
      });

      console.log('💾 Portfolio snapshot saved');
    } catch (error) {
      console.error('Error saving snapshot:', error);
    }
  }

  /**
   * Send daily summary email
   */
  async sendDailySummary() {
    try {
      console.log('📧 Sending daily summary...');

      const portfolio = await analysisEngine.getPortfolioState();

      // Calculate top performers
      const performers = portfolio.positions
        .map(p => ({
          symbol: p.symbol,
          change: ((p.currentPrice - p.cost_basis) / p.cost_basis) * 100
        }))
        .sort((a, b) => b.change - a.change)
        .slice(0, 3);

      // Get alerts
      const health = await analysisEngine.analyzePortfolioHealth(portfolio);
      const alerts = health.issues.map(i => i.message);

      await email.sendDailySummary({
        totalValue: portfolio.totalValue,
        cash: portfolio.cash,
        positions: portfolio.positions,
        dailyChange: 0, // TODO: Calculate
        totalReturn: portfolio.drawdown * 100,
        trades: [], // TODO: Get today's trades
        topPerformers: performers,
        alerts,
        aiRecommendation: 'Portfolio analysis complete. Check dashboard for details.'
      });

      console.log('✅ Daily summary sent');
    } catch (error) {
      console.error('Error sending daily summary:', error);
    }
  }

  /**
   * Execute a trade (buy or sell)
   * Supports long and short positions with multiple lots
   * Actions: buy, sell, buy_to_open, sell_to_close, sell_to_open, buy_to_close
   */
  async executeTrade(symbol, action, quantity, options = {}) {
    try {
      console.log(`\n💼 Executing ${action.toUpperCase()} ${quantity} ${symbol}...`);

      // Get current price
      const quote = await tradier.getQuote(symbol);
      const price = quote.last;

      // Validate trade
      const portfolio = await analysisEngine.getPortfolioState();

      // Get asset class for the symbol
      const assetClass = assetClassData.getAssetClass(symbol);

      const trade = {
        action,
        symbol,
        quantity,
        price,
        assetClass: assetClass
      };

      const validation = await riskManager.validateTrade(trade, portfolio);

      if (!validation.valid) {
        console.log('❌ Trade validation failed:');
        validation.errors.forEach(err => console.log(`   - ${err}`));
        return { success: false, errors: validation.errors };
      }

      if (validation.warnings.length > 0) {
        console.log('⚠️ Warnings:');
        validation.warnings.forEach(warn => console.log(`   - ${warn}`));
      }

      // CRITICAL: Check trade safeguards (code-enforced limits)
      const safeguardCheck = await tradeSafeguard.canTrade(symbol, action, quantity, price, portfolio);
      if (!safeguardCheck.allowed) {
        console.log('🚫 Trade blocked by safeguards:');
        safeguardCheck.errors.forEach(err => console.log(`   - ${err}`));
        return { success: false, errors: safeguardCheck.errors };
      }

      // Place order
      const order = await tradier.placeOrder(symbol, action, quantity);

      console.log(`✅ Order placed: ${order.id}`);

      // Log trade
      await db.logTrade({
        symbol,
        action,
        quantity,
        price,
        orderId: order.id,
        status: order.status,
        reasoning: options.reasoning || 'Manual execution'
      });

      // Handle BUY (long) or SELL_TO_OPEN (short) - Create lots
      if (action === 'buy' || action === 'buy_to_open' || action === 'sell_to_open') {
        const isShort = action === 'sell_to_open';
        const positionType = isShort ? 'short' : 'long';
        const investmentType = options.investmentType || 'long-term'; // 'long-term', 'swing', or 'hybrid'
        const thesis = options.thesis || 'No thesis provided';

        let longTermQty = 0;
        let swingQty = 0;

        // Determine lot split
        if (investmentType === 'hybrid') {
          // Hybrid: 75% long-term, 25% swing
          longTermQty = Math.floor(quantity * 0.75);
          swingQty = quantity - longTermQty;
        } else if (investmentType === 'long-term') {
          longTermQty = quantity;
        } else if (investmentType === 'swing') {
          swingQty = quantity;
        }

        console.log(`📦 Creating ${positionType.toUpperCase()} lots: ${longTermQty} long-term, ${swingQty} swing`);

        // Create long-term lot
        if (longTermQty > 0) {
          // Calculate stops based on position type
          let stopLoss, takeProfit;
          if (isShort) {
            // Short: stop above entry, target below entry
            stopLoss = options.stopLoss || price * 1.15; // +15% stop for shorts
            takeProfit = options.takeProfit || price * 0.70; // -30% target for shorts
          } else {
            // Long: stop below entry, target above entry
            stopLoss = options.stopLoss || riskManager.calculateStopLoss('large-cap', price);
            takeProfit = options.takeProfit || price * 1.50; // +50% for long-term
          }

          const lot = await db.createPositionLot({
            symbol,
            lot_type: 'long-term',
            position_type: positionType,
            quantity: longTermQty,
            cost_basis: price,
            current_price: price,
            entry_date: new Date().toISOString().split('T')[0],
            stop_loss: stopLoss,
            take_profit: takeProfit,
            thesis,
            original_intent: 'long-term',
            current_intent: 'long-term'
          });

          // Place OCO order for long-term lot
          // Check market hours to determine order type
          const isMarketOpen = await tradier.isMarketOpen();

          try {
            if (isMarketOpen) {
              // Market open: Use OCO (assumes shares already owned after instant fill)
              console.log(`📋 Placing OCO for long-term lot (Stop: $${stopLoss.toFixed(2)}, Target: $${takeProfit.toFixed(2)})...`);
              const ocoOrder = await tradier.placeOCOOrder(symbol, longTermQty, stopLoss, takeProfit);
              await db.updatePositionLot(lot.id, { oco_order_id: ocoOrder.id });
              console.log(`✅ Long-term OCO placed: ${ocoOrder.id}`);
            } else {
              // Market closed: Use OTOCO (limit buy triggers OCO when filled)
              console.log(`📋 Market closed - placing OTOCO order (Entry: $${price.toFixed(2)}, Stop: $${stopLoss.toFixed(2)}, Target: $${takeProfit.toFixed(2)})...`);
              const otocoOrder = await tradier.placeOTOCOOrder(symbol, 'buy', longTermQty, price, stopLoss, takeProfit);
              await db.updatePositionLot(lot.id, { oco_order_id: otocoOrder.id });
              console.log(`✅ OTOCO placed: ${otocoOrder.id}`);
            }
          } catch (error) {
            console.error(`⚠️ Failed to place long-term OCO: ${error.message}`);
            console.log(`📋 Fallback: Placing separate stop-loss and take-profit orders...`);

            try {
              // Place stop-loss order
              const stopOrder = await tradier.placeOrder(symbol, 'sell', longTermQty, {
                type: 'stop',
                stop: stopLoss
              });
              console.log(`✅ Stop-loss placed: ${stopOrder.id}`);

              // Place take-profit order
              const limitOrder = await tradier.placeOrder(symbol, 'sell', longTermQty, {
                type: 'limit',
                price: takeProfit
              });
              console.log(`✅ Take-profit placed: ${limitOrder.id}`);

              // Store both order IDs
              await db.updatePositionLot(lot.id, {
                stop_order_id: stopOrder.id,
                limit_order_id: limitOrder.id
              });
            } catch (fallbackError) {
              console.error(`❌ Fallback orders also failed: ${fallbackError.message}`);
            }
          }
        }

        // Create swing lot
        if (swingQty > 0) {
          // Calculate stops based on position type
          let stopLoss, takeProfit;
          if (isShort) {
            // Short: stop above entry, target below entry
            stopLoss = options.stopLoss || price * 1.10; // +10% stop for swing shorts
            takeProfit = options.takeProfit || price * 0.85; // -15% target for swing shorts
          } else {
            // Long: stop below entry, target above entry
            stopLoss = options.stopLoss || price * 0.92; // -8% for swing
            takeProfit = options.takeProfit || price * 1.15; // +15% for swing
          }

          const lot = await db.createPositionLot({
            symbol,
            lot_type: 'swing',
            position_type: positionType,
            quantity: swingQty,
            cost_basis: price,
            current_price: price,
            entry_date: new Date().toISOString().split('T')[0],
            stop_loss: stopLoss,
            take_profit: takeProfit,
            thesis,
            original_intent: 'swing',
            current_intent: 'swing'
          });

          // Place OCO order for swing lot
          // Check market hours to determine order type
          const isMarketOpen = await tradier.isMarketOpen();

          try {
            if (isMarketOpen) {
              // Market open: Use OCO (assumes shares already owned after instant fill)
              console.log(`📋 Placing OCO for swing lot (Stop: $${stopLoss.toFixed(2)}, Target: $${takeProfit.toFixed(2)})...`);
              const ocoOrder = await tradier.placeOCOOrder(symbol, swingQty, stopLoss, takeProfit);
              await db.updatePositionLot(lot.id, { oco_order_id: ocoOrder.id });
              console.log(`✅ Swing OCO placed: ${ocoOrder.id}`);
            } else {
              // Market closed: Use OTOCO (limit buy triggers OCO when filled)
              console.log(`📋 Market closed - placing OTOCO order (Entry: $${price.toFixed(2)}, Stop: $${stopLoss.toFixed(2)}, Target: $${takeProfit.toFixed(2)})...`);
              const otocoOrder = await tradier.placeOTOCOOrder(symbol, 'buy', swingQty, price, stopLoss, takeProfit);
              await db.updatePositionLot(lot.id, { oco_order_id: otocoOrder.id });
              console.log(`✅ OTOCO placed: ${otocoOrder.id}`);
            }
          } catch (error) {
            console.error(`⚠️ Failed to place swing OCO: ${error.message}`);
            console.log(`📋 Fallback: Placing separate stop-loss and take-profit orders...`);

            try {
              // Place stop-loss order
              const stopOrder = await tradier.placeOrder(symbol, 'sell', swingQty, {
                type: 'stop',
                stop: stopLoss
              });
              console.log(`✅ Stop-loss placed: ${stopOrder.id}`);

              // Place take-profit order
              const limitOrder = await tradier.placeOrder(symbol, 'sell', swingQty, {
                type: 'limit',
                price: takeProfit
              });
              console.log(`✅ Take-profit placed: ${limitOrder.id}`);

              // Store both order IDs
              await db.updatePositionLot(lot.id, {
                stop_order_id: stopOrder.id,
                limit_order_id: limitOrder.id
              });
            } catch (fallbackError) {
              console.error(`❌ Fallback orders also failed: ${fallbackError.message}`);
            }
          }
        }

        // Update aggregate position
        await db.upsertPosition({
          symbol,
          quantity,
          cost_basis: price,
          current_price: price,
          asset_class: trade.assetClass,
          stock_type: 'large-cap',
          investment_type: investmentType,
          total_lots: (longTermQty > 0 ? 1 : 0) + (swingQty > 0 ? 1 : 0),
          long_term_lots: longTermQty > 0 ? 1 : 0,
          swing_lots: swingQty > 0 ? 1 : 0,
          thesis
        });

      } else if (action === 'sell') {
        // Handle SELL - handled by trimming.js or manual
        const position = portfolio.positions.find(p => p.symbol === symbol);
        if (position && position.quantity <= quantity) {
          await db.deletePosition(symbol);
        }
      }

      // Send confirmation email
      await email.sendTradeConfirmation({
        action: action,
        symbol: symbol,
        quantity: quantity,
        price: price,
        totalValue: quantity * price,
        orderId: order.id,
        status: order.status || 'pending',
        stopLoss: null,
        takeProfit: null,
        reasoning: options.reasoning || 'Trade executed via executeTrade method'
      });

      // Trade count now tracked in database via tradeSafeguard

      return { success: true, order };

    } catch (error) {
      console.error('❌ Trade execution error:', error);
      await email.sendErrorAlert(error, `Trade execution: ${action} ${symbol}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop the bot
   */
  stop() {
    console.log('\n🛑 Stopping Whiskie Bot...');
    this.isRunning = false;
    process.exit(0);
  }
}

// Create bot instance
const bot = new WhiskieBot();

// Handle graceful shutdown
process.on('SIGINT', () => bot.stop());
process.on('SIGTERM', () => bot.stop());

// Start the bot
bot.start().catch(console.error);

export default bot;
