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
import * as db from './db.js';
import { SUB_INDUSTRIES, getAllSubIndustries } from './sub-industry-data.js';
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
    this.isRunning = false;
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

      // Start API server FIRST so Railway knows we're alive
      this.startAPIServer();
      console.log('✅ API server started\n');

      // Check if we should run now
      const shouldRun = await this.shouldRunNow();

      if (!shouldRun) {
        console.log('⏰ Outside trading hours. Bot will sleep until next scheduled time.');
        console.log('📅 Next run: Tomorrow at 9:00 AM ET\n');

        // Schedule next run and exit
        this.scheduleNextRun();
        return;
      }

      // Run initial analysis (in background so it doesn't block)
      console.log('📊 Running initial portfolio analysis...\n');
      this.runDailyAnalysis().catch(console.error);

      // Schedule daily analysis at 10:00 AM, 12:30 PM, and 3:30 PM ET
      cron.schedule('0 10 * * 1-5', async () => {
        console.log('\n⏰ 10:00 AM Analysis - Market has settled after open');
        await this.runDailyAnalysis();
      }, {
        timezone: 'America/New_York'
      });

      cron.schedule('30 12 * * 1-5', async () => {
        console.log('\n⏰ 12:30 PM Analysis - Mid-day check');
        await this.runDailyAnalysis();
      }, {
        timezone: 'America/New_York'
      });

      cron.schedule('30 15 * * 1-5', async () => {
        console.log('\n⏰ 3:30 PM Analysis - Before market close');
        await this.runDailyAnalysis();
      }, {
        timezone: 'America/New_York'
      });

      // Schedule end-of-day summary at 4:30 PM ET (after market close)
      cron.schedule('30 16 * * 1-5', async () => {
        console.log('\n⏰ End of day summary triggered');
        await this.sendDailySummary();

        // Shut down after evening summary (save costs)
        console.log('\n💤 Market closed. Shutting down until tomorrow...');
        setTimeout(() => process.exit(0), 5000);
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

      // Schedule daily days_held update - 6:00 AM ET
      cron.schedule('0 6 * * 1-5', async () => {
        console.log('\n⏰ 6:00 AM - Updating days held for tax tracking');
        try {
          await db.updateDaysHeld();
          console.log('✅ Days held updated successfully');
        } catch (error) {
          console.error('❌ Error updating days held:', error);
        }
      }, {
        timezone: 'America/New_York'
      });

      console.log('\n✅ Whiskie Bot is running');
      console.log('📅 Analysis schedule (Mon-Fri):');
      console.log('   • 6:00 AM ET - Update days held (tax tracking)');
      console.log('   • 10:00 AM ET - Morning analysis + trim/tax/trailing checks');
      console.log('   • 12:30 PM ET - Mid-day check + trim/tax/trailing checks');
      console.log('   • 3:30 PM ET - Before close + trim/tax/trailing checks');
      console.log('📊 Daily summary: 4:30 PM ET');
      console.log('📅 Weekly earnings refresh: Friday 3:00 PM ET');
      console.log('📅 Weekly review: Sunday 9:00 PM ET (Opus deep review)');
      console.log('💤 Auto-shutdown: 4:35 PM ET (saves costs)');
      console.log('💡 Press Ctrl+C to stop\n');

      this.isRunning = true;
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
        running: this.isRunning,
        mode: process.env.NODE_ENV,
        uptime: process.uptime()
      });
    });

    app.listen(PORT, () => {
      console.log(`🌐 API server listening on port ${PORT}`);
      console.log(`📡 Trigger analysis: POST https://your-app.railway.app/analyze`);
      console.log('');
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
   * Schedule next run (for Railway restarts)
   */
  scheduleNextRun() {
    // Railway will restart the service daily
    // This ensures we don't waste compute outside trading hours
    setTimeout(() => {
      console.log('🔄 Checking if trading hours...');
      this.start();
    }, 60 * 60 * 1000); // Check every hour
  }

  /**
   * Run daily portfolio analysis
   */
  async runDailyAnalysis() {
    if (this.isRunning) {
      console.log('⚠️ Analysis already running, skipping...');
      return;
    }

    this.isRunning = true;

    try {
      console.log('═══════════════════════════════════════');
      console.log('📊 DAILY PORTFOLIO ANALYSIS');
      console.log('═══════════════════════════════════════\n');

      // Check if market is open
      const isMarketOpen = await tradier.isMarketOpen();
      console.log(`📈 Market Status: ${isMarketOpen ? 'OPEN' : 'CLOSED'}\n`);

      // Get portfolio state
      console.log('💼 Fetching portfolio state...');
      const portfolio = await analysisEngine.getPortfolioState();
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

      // Check for earnings day analysis
      console.log('📊 Checking for earnings today/tomorrow...');
      const earningsResults = await runEarningsDayAnalysis();
      if (earningsResults.analyzed > 0) {
        console.log(`✅ Analyzed ${earningsResults.analyzed} positions with upcoming earnings\n`);
      }

      // Update days held for all lots (tax tracking)
      console.log('📅 Updating days held for tax tracking...');
      await db.updateDaysHeld();
      console.log('✅ Days held updated\n');

      // Get market news
      console.log('📰 Fetching market news...');
      const marketNews = await tavily.searchMarketNews(5);
      const formattedNews = tavily.formatResults(marketNews);
      console.log(`   Found ${marketNews.length} articles\n`);

      // Quick sentiment check
      const headlines = marketNews.map(n => n.title).join('. ');
      const sentiment = await claude.quickSentimentCheck(headlines);
      console.log('📊 Market Sentiment:', sentiment.analysis.substring(0, 100) + '...\n');

      // Check if we need deep analysis (Opus)
      const needsDeepAnalysis =
        health.issues.some(i => i.severity === 'high') ||
        portfolio.positions.length < 8 || // Need more positions
        riskManager.isDefensiveMode(portfolio);

      if (needsDeepAnalysis) {
        console.log('🧠 Running deep analysis with Claude Opus...');
        await this.runDeepAnalysis(portfolio, formattedNews);
      } else {
        console.log('✅ Portfolio looks healthy, no deep analysis needed');
      }

      // Save portfolio snapshot
      await this.saveSnapshot(portfolio);

      console.log('\n═══════════════════════════════════════');
      console.log('✅ Daily analysis complete');
      console.log('═══════════════════════════════════════\n');

    } catch (error) {
      console.error('❌ Error in daily analysis:', error);
      await email.sendErrorAlert(error, 'Daily analysis');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Handle stop-loss trigger
   */
  async handleStopLoss(symbol, portfolio) {
    console.log(`\n🛑 STOP-LOSS TRIGGERED: ${symbol}`);

    const position = portfolio.positions.find(p => p.symbol === symbol);
    if (!position) return;

    // Evaluate sell decision with AI
    const evaluation = await analysisEngine.evaluateSellDecision(
      position,
      'Stop-loss triggered'
    );

    // Log AI decision
    await db.logAIDecision({
      type: 'stop-loss',
      symbol,
      recommendation: evaluation.analysis,
      reasoning: 'Stop-loss level reached',
      model: 'sonnet',
      confidence: 'high'
    });

    // Send email alert
    const emailResult = await email.sendTradeRecommendation({
      action: 'sell',
      symbol,
      quantity: position.quantity,
      price: evaluation.currentPrice,
      positionSize: 0,
      reasoning: evaluation.analysis,
      stopLoss: 0,
      takeProfit: 0
    });

    if (emailResult) {
      console.log(`   📧 Email sent successfully`);
    } else {
      console.log(`   ⚠️ Email failed to send (check SendGrid sender verification)`);
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
  async runDeepAnalysis(portfolio, news) {
    try {
      console.log('');
      console.log('═══════════════════════════════════════');
      console.log('🧠 STARTING DEEP ANALYSIS WITH OPUS');
      console.log('═══════════════════════════════════════');
      console.log('Portfolio: $' + portfolio.totalValue.toLocaleString());
      console.log('Positions:', portfolio.positions.length);
      console.log('Cash:', '$' + portfolio.cash.toLocaleString());
      console.log('');

      // PHASE 1: Fetch market context (indices + portfolio stocks only)
      console.log('📊 PHASE 1: Fetching market context...');
      const portfolioSymbols = portfolio.positions.map(p => p.symbol);
      const marketIndices = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX', 'TLT', 'GLD', 'USO'];
      const phase1Symbols = [...new Set([...portfolioSymbols, ...marketIndices])];

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

      // Check watchlist for buy opportunities
      console.log('👀 Checking watchlist for buy opportunities...');
      const watchlist = await db.getWatchlist();
      const buyOpportunities = await db.getWatchlistBuyOpportunities();

      let watchlistContext = '';
      if (watchlist.length > 0) {
        watchlistContext = '\n\n**WATCHLIST (stocks you are monitoring):**\n';
        watchlist.forEach(item => {
          const atTarget = item.current_price <= item.target_entry_price ? '✅ AT TARGET' : '';
          watchlistContext += `- ${item.symbol} (${item.sub_industry}): Current $${item.current_price}, Target Entry $${item.target_entry_price} ${atTarget}\n`;
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
      console.log('');

      // PHASE 1 PROMPT: Identify promising sub-industries and stocks
      const phase1Question = `You are managing a $100k portfolio.

**PHASE 1: Identify promising sub-industries and stocks to analyze**

**Current Portfolio:**
- Positions: ${portfolio.positions.length}
- Total Value: $${portfolio.totalValue.toLocaleString()}
- Cash Available: $${portfolio.cash.toLocaleString()}

**Market Context:**
${Object.entries(marketContext).map(([sym, data]) => `- ${sym}: $${data.price} (${data.change_percentage >= 0 ? '+' : ''}${data.change_percentage}%)`).join('\n')}

**Recent News:**
${news}

${watchlistContext}

**Your Task for Phase 1:**
1. Identify 3-5 promising sub-industries based on current market conditions and news
2. From those sub-industries, select 15-20 specific stocks to analyze in Phase 2
3. Prioritize watchlist stocks that are at or near target entry prices

**Available Sub-Industries (40 total):**
Cloud Computing, Cybersecurity, Semiconductors, Software & SaaS, IT Hardware & Networking, IT Services & Consulting, E-commerce & Online Retail, Digital Advertising & Social Media, Streaming & Digital Entertainment, Video Gaming & Esports, Telecom Services, Biotechnology, Pharmaceuticals, Medical Devices & Equipment, Health Care Services & Managed Care, Life Sciences Tools & Diagnostics, Banks & Diversified Financials, Insurance, Fintech & Payments, Asset Management & Capital Markets, Aerospace & Defense, Industrial Machinery & Equipment, Transportation & Logistics, Building Products & Construction, Electrical Equipment & Automation, Restaurants & Food Services, Automotive & EV, Retail & Apparel, Travel & Leisure, Food & Beverage, Household & Personal Products, Grocery & Consumer Retail, Oil & Gas Exploration & Production, Renewable Energy & Clean Tech, Oil & Gas Services & Midstream, Electric Utilities, Water & Gas Utilities, REITs & Real Estate, Specialty & Industrial REITs, Chemicals & Specialty Materials, Metals & Mining

Format your response EXACTLY like this:
PROMISING_SUB_INDUSTRIES:
- Cloud Computing: [reason]
- Cybersecurity: [reason]
- Biotechnology: [reason]

TICKERS_TO_ANALYZE:
MSFT
PANW
CRWD
LLY
ABBV
...

${historyContext}`;

      console.log('📝 PHASE 1: Asking Opus to identify stocks...');
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

      // PHASE 2 PROMPT: Make final trade decisions with current prices
      const phase2Question = `You are managing a $100k portfolio. Analyze and provide SPECIFIC trade recommendations.

**Current Portfolio:**
- Positions: ${portfolio.positions.length}
- Total Value: $${portfolio.totalValue.toLocaleString()}
- Cash Available: $${portfolio.cash.toLocaleString()}

**Your Decision-Making Authority:**
- You have FULL autonomy to decide when to trade and when to hold cash
- Learn from your previous analyses and adapt your strategy
- Deploy capital when YOU believe the risk/reward is favorable
- It's perfectly fine to hold 100% cash if you don't see good opportunities
- Quality over quantity - only trade when you're confident in your analysis

${watchlistContext}

**Your Task:**
1. **WATCHLIST UPDATE:** For each stock you want to monitor (but not buy yet):
   - Symbol, Sub-industry, Current Price
   - Target Entry Price (price you'd buy at)
   - Target Exit Price (profit target)
   - Why watching (what makes it interesting)
   - Why not buying now (what you're waiting for)

   Format: WATCHLIST_ADD: AAPL | Cloud Computing | $280 | $250 | $320 | Strong fundamentals | Waiting for pullback

2. **BUY RECOMMENDATIONS:** Which stocks to buy NOW? For EACH recommendation provide:
   - Symbol and company name
   - Quantity (exact number of shares)
   - Entry price (current market price)
   - Position size (% of portfolio)
   - **STOP-LOSS:** Exact price level and % below entry (explain why this level)
   - **TAKE-PROFIT:** Target price and expected gain % (explain reasoning)
   - Sector and stock type (mega-cap/large-cap/mid-cap)
   - Full reasoning (fundamentals + technicals + macro)
3. **SELL/TRIM:** Any current positions to sell or trim?
4. **SECTOR ANALYSIS:** Which sectors look strong/weak based on macro environment?
5. **TREND DETECTION:** Any patterns from previous analyses?

**Stop-Loss Guidelines (you decide final levels):**
- Index ETFs: -10 to -12%
- Blue-chip/Mega-cap: -10 to -12%
- Large-cap growth: -13 to -15%
- Mid-cap: -15 to -18%
- Adjust based on volatility and conviction

**Investment Rules:**
- Regular stocks only (no crypto, no penny stocks)
- Max 15% per position
- 10-12 positions max
- Diversify across sectors
- YOU decide which sectors to focus/avoid based on current macro environment

**Be SPECIFIC:**
✅ "BUY 10 shares AAPL at $255. Stop-loss: $230 (-9.8%). Take-profit: $295 (+15.7%). Reasoning: Strong iPhone sales..."
❌ "Consider buying tech stocks"

${historyContext}`;

      console.log('📝 PHASE 2: Sending final question to Opus...');
      console.log('⏳ Extended thinking enabled (50,000 tokens MAX)');
      console.log('⏳ Temperature: 0.1 (focused, consistent)');
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

      // Parse recommendations and execute trades automatically
      console.log('🔍 Parsing trade recommendations...');
      const recommendations = this.parseRecommendations(analysis.analysis);

      if (recommendations.length > 0) {
        console.log(`✅ Found ${recommendations.length} trade recommendations`);

        for (const rec of recommendations) {
          console.log(`   💰 Executing trade: BUY ${rec.quantity} ${rec.symbol} at $${rec.entryPrice}...`);

          try {
            // Execute trade immediately
            await this.executeTrade(rec.symbol, 'buy', rec.quantity);

            console.log(`   ✅ Trade executed successfully`);

            // Send email notification AFTER execution
            await email.sendTradeConfirmation({
              action: 'buy',
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

    // Look for "TICKERS_TO_ANALYZE:" section
    const tickerSection = analysisText.match(/TICKERS_TO_ANALYZE:[\s\S]*?(?=\n\n|$)/i);

    if (tickerSection) {
      const lines = tickerSection[0].split('\n');
      for (const line of lines) {
        const match = line.match(/\b([A-Z]{1,5})\b/);
        if (match && match[1] !== 'TICKERS' && match[1] !== 'TO' && match[1] !== 'ANALYZE') {
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

    // Remove duplicates and limit to 20
    return [...new Set(tickers)].slice(0, 20);
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
   * Parse trade recommendations from Opus analysis (handles multiple formats)
   */
  parseRecommendations(analysisText) {
    const recommendations = [];

    try {
      // Pattern 1: "BUY X shares SYMBOL at $PRICE"
      const buyPattern1 = /BUY\s+(\d+)\s+(?:shares?\s+)?([A-Z]{1,5})\s+at\s+\$?([\d.]+)/gi;

      // Pattern 2: "BUY SYMBOL: X shares @ $PRICE"
      const buyPattern2 = /BUY\s+([A-Z]{1,5}):\s*(\d+)\s+shares?\s+@\s*\$?([\d.]+)/gi;

      // Pattern 3: Markdown table format "| BUY | SYMBOL | X | $PRICE |"
      const tablePattern = /\|\s*BUY\s*\|\s*([A-Z]{1,5})\s*\|\s*(\d+)\s*\|\s*\$?([\d.]+)/gi;

      const stopLossPattern = /Stop-?loss:?\s*\$?([\d.]+)/gi;
      const takeProfitPattern = /Take-?profit:?\s*\$?([\d.]+)/gi;

      let match;
      const matches = [];

      // Try all patterns
      while ((match = buyPattern1.exec(analysisText)) !== null) {
        matches.push({
          quantity: parseInt(match[1]),
          symbol: match[2],
          entryPrice: parseFloat(match[3]),
          index: match.index
        });
      }

      buyPattern2.lastIndex = 0;
      while ((match = buyPattern2.exec(analysisText)) !== null) {
        matches.push({
          quantity: parseInt(match[2]),
          symbol: match[1],
          entryPrice: parseFloat(match[3]),
          index: match.index
        });
      }

      tablePattern.lastIndex = 0;
      while ((match = tablePattern.exec(analysisText)) !== null) {
        matches.push({
          quantity: parseInt(match[2]),
          symbol: match[1],
          entryPrice: parseFloat(match[3]),
          index: match.index
        });
      }

      // For each BUY, find the nearest stop-loss and take-profit
      for (const buyMatch of matches) {
        const textAfterBuy = analysisText.substring(buyMatch.index, buyMatch.index + 2000);

        // Find stop-loss
        stopLossPattern.lastIndex = 0;
        const slMatch = stopLossPattern.exec(textAfterBuy);
        const stopLoss = slMatch ? parseFloat(slMatch[1]) : null;

        // Find take-profit
        takeProfitPattern.lastIndex = 0;
        const tpMatch = takeProfitPattern.exec(textAfterBuy);
        const takeProfit = tpMatch ? parseFloat(tpMatch[1]) : null;

        // Extract reasoning (next 800 chars after the BUY statement)
        const reasoning = textAfterBuy.substring(0, 800).trim();

        recommendations.push({
          symbol: buyMatch.symbol,
          quantity: buyMatch.quantity,
          entryPrice: buyMatch.entryPrice,
          stopLoss,
          takeProfit,
          reasoning
        });
      }

      // Remove duplicates (same symbol)
      const uniqueRecs = [];
      const seen = new Set();
      for (const rec of recommendations) {
        if (!seen.has(rec.symbol)) {
          seen.add(rec.symbol);
          uniqueRecs.push(rec);
        }
      }

      return uniqueRecs;
    } catch (error) {
      console.error('Error parsing recommendations:', error.message);
      return [];
    }
  }

  /**
   * Parse watchlist items from analysis
   * Format: WATCHLIST_ADD: SYMBOL | Sub-industry | $CurrentPrice | $TargetEntry | $TargetExit | Why watching | Why not now
   */
  parseWatchlist(analysisText) {
    const watchlistItems = [];

    try {
      const watchlistPattern = /WATCHLIST_ADD:\s*([A-Z]{1,5})\s*\|\s*([^|]+)\|\s*\$?([\d.]+)\s*\|\s*\$?([\d.]+)\s*\|\s*\$?([\d.]+)\s*\|\s*([^|]+)\|\s*([^|\n]+)/gi;

      let match;
      while ((match = watchlistPattern.exec(analysisText)) !== null) {
        watchlistItems.push({
          symbol: match[1].trim(),
          sub_industry: match[2].trim(),
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

      await db.savePortfolioSnapshot({
        total_value: portfolio.totalValue,
        cash: portfolio.cash,
        positions_value: portfolio.positionsValue,
        daily_change: 0, // TODO: Calculate from previous day
        total_return: portfolio.drawdown,
        sp500_return: 0, // TODO: Fetch S&P 500 return
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
        dailyChange: 0, // TODO: Calculate
        totalReturn: portfolio.drawdown * 100,
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
   * Execute a trade (manual approval required)
   */
  /**
   * Execute a trade (buy or sell)
   * Supports hybrid positions with multiple lots
   */
  async executeTrade(symbol, action, quantity, options = {}) {
    try {
      console.log(`\n💼 Executing ${action.toUpperCase()} ${quantity} ${symbol}...`);

      // Get current price
      const quote = await tradier.getQuote(symbol);
      const price = quote.last;

      // Validate trade
      const portfolio = await analysisEngine.getPortfolioState();
      const trade = {
        action,
        symbol,
        quantity,
        price,
        sector: options.sector || 'Unknown'
      };

      const validation = riskManager.validateTrade(trade, portfolio);

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
      const safeguardCheck = await tradeSafeguard.canTrade(symbol, action, quantity, price);
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

      // Handle BUY - Create lots
      if (action === 'buy') {
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

        console.log(`📦 Creating lots: ${longTermQty} long-term, ${swingQty} swing`);

        // Create long-term lot
        if (longTermQty > 0) {
          const stopLoss = riskManager.calculateStopLoss('large-cap', price);
          const takeProfit = price * 1.50; // +50% for long-term

          const lot = await db.createPositionLot({
            symbol,
            lot_type: 'long-term',
            quantity: longTermQty,
            cost_basis: price,
            current_price: price,
            entry_date: new Date().toISOString().split('T')[0],
            stop_loss: stopLoss,
            take_profit: takeProfit,
            thesis
          });

          // Place OCO order for long-term lot
          try {
            console.log(`📋 Placing OCO for long-term lot (Stop: $${stopLoss.toFixed(2)}, Target: $${takeProfit.toFixed(2)})...`);
            const ocoOrder = await tradier.placeOCOOrder(symbol, longTermQty, stopLoss, takeProfit);
            await db.updatePositionLot(lot.id, { oco_order_id: ocoOrder.id });
            console.log(`✅ Long-term OCO placed: ${ocoOrder.id}`);
          } catch (error) {
            console.error(`⚠️ Failed to place long-term OCO: ${error.message}`);
          }
        }

        // Create swing lot
        if (swingQty > 0) {
          const stopLoss = price * 0.92; // -8% for swing
          const takeProfit = price * 1.15; // +15% for swing

          const lot = await db.createPositionLot({
            symbol,
            lot_type: 'swing',
            quantity: swingQty,
            cost_basis: price,
            current_price: price,
            entry_date: new Date().toISOString().split('T')[0],
            stop_loss: stopLoss,
            take_profit: takeProfit,
            thesis
          });

          // Place OCO order for swing lot
          try {
            console.log(`📋 Placing OCO for swing lot (Stop: $${stopLoss.toFixed(2)}, Target: $${takeProfit.toFixed(2)})...`);
            const ocoOrder = await tradier.placeOCOOrder(symbol, swingQty, stopLoss, takeProfit);
            await db.updatePositionLot(lot.id, { oco_order_id: ocoOrder.id });
            console.log(`✅ Swing OCO placed: ${ocoOrder.id}`);
          } catch (error) {
            console.error(`⚠️ Failed to place swing OCO: ${error.message}`);
          }
        }

        // Update aggregate position
        await db.upsertPosition({
          symbol,
          quantity,
          cost_basis: price,
          current_price: price,
          sector: trade.sector,
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
        stopLoss: null,
        takeProfit: null,
        reasoning: options.reasoning || 'Trade executed via executeTrade method'
      });

      // Record trade
      riskManager.recordTrade();

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
