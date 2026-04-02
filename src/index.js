import cron from 'node-cron';
import dotenv from 'dotenv';
import tradier from './tradier.js';
import claude from './claude.js';
import tavily from './tavily.js';
import email from './email.js';
import riskManager from './risk-manager.js';
import analysisEngine from './analysis.js';
import {
  initDatabase,
  logTrade,
  logAIDecision,
  logAlert,
  savePortfolioSnapshot,
  upsertPosition,
  deletePosition
} from './db.js';

dotenv.config();

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
      await initDatabase();

      // Check if we should run now
      const shouldRun = await this.shouldRunNow();

      if (!shouldRun) {
        console.log('⏰ Outside trading hours. Bot will sleep until next scheduled time.');
        console.log('📅 Next run: Tomorrow at 9:00 AM ET\n');

        // Schedule next run and exit
        this.scheduleNextRun();
        return;
      }

      // Run initial analysis
      console.log('📊 Running initial portfolio analysis...\n');
      await this.runDailyAnalysis();

      // Schedule daily analysis at 9:30 AM ET (market open)
      cron.schedule('30 9 * * 1-5', async () => {
        console.log('\n⏰ Scheduled daily analysis triggered');
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

      console.log('\n✅ Whiskie Bot is running');
      console.log('📅 Daily analysis: 9:30 AM ET (Mon-Fri)');
      console.log('📊 Daily summary: 4:30 PM ET (Mon-Fri)');
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
          await logAlert({
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

      // Handle take-profit opportunities
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
    await logAIDecision({
      type: 'stop-loss',
      symbol,
      recommendation: evaluation.analysis,
      reasoning: 'Stop-loss level reached',
      model: 'sonnet',
      confidence: 'high'
    });

    // Send email alert
    await email.sendTradeRecommendation({
      action: 'sell',
      symbol,
      quantity: position.quantity,
      price: evaluation.currentPrice,
      positionSize: 0,
      reasoning: evaluation.analysis,
      stopLoss: 0,
      takeProfit: 0
    });

    console.log(`   📧 Email sent for approval`);
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
    await logAIDecision({
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
    await logAIDecision({
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
   * Run deep analysis with Claude Opus
   */
  async runDeepAnalysis(portfolio, news) {
    try {
      const question = `Analyze my portfolio and provide specific trade recommendations.

Current portfolio has ${portfolio.positions.length} positions worth $${portfolio.totalValue.toLocaleString()}.
Cash available: $${portfolio.cash.toLocaleString()}.

Should I:
1. Buy any new positions? (which stocks and why)
2. Sell or trim any current positions?
3. Rebalance sectors?

Provide specific, actionable recommendations.`;

      const analysis = await claude.deepAnalysis(
        portfolio,
        {},
        news,
        {},
        question
      );

      console.log('\n🧠 OPUS ANALYSIS:');
      console.log(analysis.analysis.substring(0, 500) + '...\n');

      // Log the decision
      await logAIDecision({
        type: 'deep-analysis',
        symbol: null,
        recommendation: analysis.analysis,
        reasoning: 'Deep portfolio analysis',
        model: 'opus',
        confidence: 'high'
      });

      // TODO: Parse recommendations and send trade alerts

    } catch (error) {
      console.error('Error in deep analysis:', error);
    }
  }

  /**
   * Save portfolio snapshot
   */
  async saveSnapshot(portfolio) {
    try {
      const today = new Date().toISOString().split('T')[0];

      await savePortfolioSnapshot({
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
  async executeTrade(symbol, action, quantity) {
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
        sector: 'Unknown' // TODO: Get sector
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

      // Place order
      const order = await tradier.placeOrder(symbol, action, quantity);

      console.log(`✅ Order placed: ${order.id}`);

      // Log trade
      await logTrade({
        symbol,
        action,
        quantity,
        price,
        orderId: order.id,
        status: order.status,
        reasoning: 'Manual execution'
      });

      // Update position in database
      if (action === 'buy') {
        await upsertPosition({
          symbol,
          quantity,
          cost_basis: price,
          current_price: price,
          sector: trade.sector,
          stock_type: 'large-cap',
          stop_loss: riskManager.calculateStopLoss('large-cap', price),
          take_profit: price * 1.15
        });
      } else if (action === 'sell') {
        const position = portfolio.positions.find(p => p.symbol === symbol);
        if (position && position.quantity <= quantity) {
          await deletePosition(symbol);
        }
      }

      // Send confirmation email
      await email.sendTradeConfirmation({
        orderId: order.id,
        symbol,
        side: action,
        quantity,
        price,
        status: order.status,
        timestamp: new Date()
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
