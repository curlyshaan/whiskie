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
import preRanking from './pre-ranking.js';
import fundamentalScreener from './fundamental-screener.js';
import qualityScreener from './quality-screener.js';
import overvaluedScreener from './overvalued-screener.js';
import tradeApproval from './trade-approval.js';
import opusScreener from './opus-screener.js';
import tradeExecutor from './trade-executor.js';
import circuitBreaker from './circuit-breaker.js';
import earningsGuard from './earnings-guard.js';
import pathwayExitMonitor from './pathway-exit-monitor.js';
import portfolioRiskMetrics from './portfolio-risk-metrics.js';
import learningFeedback from './learning-feedback.js';
import orderReconciliation from './order-reconciliation.js';
import macroRegime from './macro-regime.js';
import corporateActions from './corporate-actions.js';
import { runPreMarketScan } from './pre-market-scanner.js';
import { sanitizeNewsContent, wrapNewsForPrompt } from './news-sanitizer.js';
import * as db from './db.js';
import { updateAllEarnings } from './earnings.js';
import { runTrimCheck } from './trimming.js';
import { runTaxOptimizationCheck } from './tax-optimizer.js';
import { runTrailingStopCheck, updateTrailingStops } from './trailing-stops.js';
import { runEarningsDayAnalysis } from './earnings-analysis.js';
import { runWeeklyReview } from './weekly-review.js';
import stockProfiles from './stock-profiles.js';

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
    this.sectorCache = new Map(); // Cache sector/industry lookups
    console.log(`🤖 Whiskie Bot initialized in ${this.isPaperTrading ? 'PAPER TRADING' : 'LIVE'} mode`);
  }

  /**
   * Get sector for a symbol (replaces assetClassData.getAssetClass)
   * Returns sector from stock_universe, with caching
   */
  async getSector(symbol) {
    if (this.sectorCache.has(symbol)) {
      return this.sectorCache.get(symbol);
    }
    const info = await db.getStockInfo(symbol);
    const sector = info?.sector || 'Unknown';
    this.sectorCache.set(symbol, sector);
    return sector;
  }

  /**
   * Start the bot
   */
  async start() {
    console.log('🚀 Starting Whiskie Bot...\n');

    try {
      // Initialize database
      await db.initDatabase();

      // Initialize trade approval system
      await tradeApproval.initDatabase();
      console.log('✅ Trade approval system initialized\n');

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
        const scheduledTime = new Date();
        const jobId = await db.logCronJobStart('Pre-Market Scan', 'daily', scheduledTime);

        try {
          console.log('\n⏰ 9:00 AM Pre-Market Gap Scan');
          this.latestGapReport = await runPreMarketScan();
          await db.logCronJobComplete(jobId, true);
        } catch (error) {
          console.error('❌ Pre-market scan failed:', error);
          await db.logCronJobComplete(jobId, false, error.message);
        }
      }, {
        timezone: 'America/New_York'
      });

      // Schedule daily analysis at 10:00 AM and 2:00 PM ET
      cron.schedule('0 10 * * 1-5', async () => {
        const scheduledTime = new Date();
        const jobId = await db.logCronJobStart('Morning Analysis', 'daily', scheduledTime);

        try {
          console.log('\n⏰ 10:00 AM Analysis - Market has settled after open');
          await this.runDailyAnalysis();
          await db.logCronJobComplete(jobId, true);
        } catch (error) {
          console.error('❌ Morning analysis failed:', error);
          await db.logCronJobComplete(jobId, false, error.message);
        }
      }, {
        timezone: 'America/New_York'
      });

      cron.schedule('0 14 * * 1-5', async () => {
        const scheduledTime = new Date();
        const jobId = await db.logCronJobStart('Afternoon Analysis', 'daily', scheduledTime);

        try {
          console.log('\n⏰ 2:00 PM Analysis - Afternoon check');
          await this.runDailyAnalysis();
          await db.logCronJobComplete(jobId, true);
        } catch (error) {
          console.error('❌ Afternoon analysis failed:', error);
          await db.logCronJobComplete(jobId, false, error.message);
        }
      }, {
        timezone: 'America/New_York'
      });

      // Schedule end-of-day summary at 6:00 PM ET
      cron.schedule('0 18 * * 1-5', async () => {
        const scheduledTime = new Date();
        const jobId = await db.logCronJobStart('Daily Summary', 'daily', scheduledTime);

        try {
          console.log('\n⏰ End of day summary triggered');
          await this.sendDailySummary();
          console.log('✅ Daily summary complete');
          await db.logCronJobComplete(jobId, true);
        } catch (error) {
          console.error('❌ Daily summary failed:', error);
          await db.logCronJobComplete(jobId, false, error.message);
        }
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

      // Schedule stock universe refresh - Saturday 10:00 AM ET
      cron.schedule('0 10 * * 6', async () => {
        const scheduledTime = new Date();
        const jobId = await db.logCronJobStart('Stock Universe Refresh', 'weekly', scheduledTime);

        try {
          console.log('\n⏰ Saturday 10:00 AM - Refreshing stock universe');

          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);

          console.log('📊 Running populate-universe-v2.js...');
          const { stdout, stderr } = await execAsync('node scripts/populate-universe-v2.js');

          if (stderr) console.error('Universe refresh stderr:', stderr);
          console.log(stdout);
          console.log('✅ Stock universe refreshed successfully');
          await db.logCronJobComplete(jobId, true);
        } catch (error) {
          console.error('❌ Error refreshing stock universe:', error);
          await db.logCronJobComplete(jobId, false, error.message);
          await email.sendErrorAlert(error, 'Stock universe refresh failed');
        }
      }, {
        timezone: 'America/New_York'
      });

      // Schedule combined weekly screening - Saturday 3:00 PM ET
      // Runs full fundamental screening + Opus screening + weekly review
      cron.schedule('0 15 * * 6', async () => {
        const scheduledTime = new Date();
        const screeningJobId = await db.logCronJobStart('Weekly Fundamental Screening', 'weekly', scheduledTime);
        const reviewJobId = await db.logCronJobStart('Weekly Review', 'weekly', scheduledTime);

        try {
          console.log('\n⏰ Saturday 3:00 PM - Fundamental screening');

          // Run full fundamental value screening (all stocks in one pass)
          console.log('\n📊 Fundamental screening (all stocks)...');
          await fundamentalScreener.runWeeklyScreen('full');
          console.log('✅ Fundamental screening complete (stocks set to pending status)');
          console.log('⏭️  Sunday 9pm Opus review will analyze and activate top candidates');
          await db.logCronJobComplete(screeningJobId, true);

        } catch (error) {
          console.error('❌ Error in Saturday screening:', error);
          await db.logCronJobComplete(screeningJobId, false, error.message);
          await email.sendErrorAlert(error, 'Saturday fundamental screening failed');
        }
      }, {
        timezone: 'America/New_York'
      });

      // Schedule weekly Opus review - Sunday 9:00 PM ET
      // Analyzes all saturday_watchlist candidates and activates top 15 per pathway
      cron.schedule('0 21 * * 0', async () => {
        const scheduledTime = new Date();
        const jobId = await db.logCronJobStart('Weekly Opus Review', 'weekly', scheduledTime);

        try {
          console.log('\n⏰ Sunday 9:00 PM - Weekly Opus review');
          const weeklyOpusReview = (await import('./weekly-opus-review.js')).default;
          const results = await weeklyOpusReview.runWeeklyReview();
          console.log(`✅ Weekly Opus review complete: ${results.analyzed} analyzed, ${results.activated} activated`);
          await db.logCronJobComplete(jobId, true);
        } catch (error) {
          console.error('❌ Error in weekly Opus review:', error);
          await db.logCronJobComplete(jobId, false, error.message);
          await email.sendErrorAlert(error, 'Weekly Opus review failed');
        }
      }, {
        timezone: 'America/New_York'
      });

      // Schedule hourly check to expire old trade approvals
      cron.schedule('0 * * * *', async () => {
        try {
          await tradeApproval.expirePendingApprovals();
        } catch (error) {
          console.error('❌ Error expiring approvals:', error);
        }
      }, {
        timezone: 'America/New_York'
      });

      // Schedule trade executor and pathway exit monitoring every 45 minutes during market hours
      cron.schedule('*/45 9-16 * * 1-5', async () => {
        try {
          await tradeExecutor.processApprovedTrades();
          await pathwayExitMonitor.checkPathwayExits();
        } catch (error) {
          console.error('❌ Error in 45-minute monitoring cycle:', error);
        }
      }, {
        timezone: 'America/New_York'
      });

      // Schedule order reconciliation - hourly during market hours
      cron.schedule('0 9-16 * * 1-5', async () => {
        try {
          await orderReconciliation.reconcilePositions();
        } catch (error) {
          console.error('❌ Error reconciling positions:', error);
        }
      }, {
        timezone: 'America/New_York'
      });

      // Schedule macro regime detection - daily at 8:00 AM
      cron.schedule('0 8 * * 1-5', async () => {
        try {
          const regime = await macroRegime.detectRegime();
          console.log(`📊 Macro regime: ${regime.name} - ${regime.description}`);
        } catch (error) {
          console.error('❌ Error detecting macro regime:', error);
        }
      }, {
        timezone: 'America/New_York'
      });

      // Schedule corporate actions check - daily at 7:00 AM
      cron.schedule('0 7 * * 1-5', async () => {
        try {
          await corporateActions.checkCorporateActions();
        } catch (error) {
          console.error('❌ Error checking corporate actions:', error);
        }
      }, {
        timezone: 'America/New_York'
      });

      console.log('\n✅ Whiskie Bot is running');
      console.log('📅 Analysis schedule (Mon-Fri):');
      console.log('   • 7:00 AM ET - Corporate actions check');
      console.log('   • 8:00 AM ET - Macro regime detection');
      console.log('   • 9:00 AM ET - Pre-market gap scan');
      console.log('   • 10:00 AM ET - Morning analysis + trim/tax/trailing checks');
      console.log('   • 2:00 PM ET - Afternoon analysis + trim/tax/trailing checks');
      console.log('   • 6:00 PM ET - Daily summary + portfolio risk metrics');
      console.log('   • Every 5 min (9am-4pm) - Process approved trades');
      console.log('   • Hourly (9am-4pm) - Order reconciliation');
      console.log('   • Hourly - Expire old trade approvals');
      console.log('📅 Weekly earnings refresh: Friday 3:00 PM ET');
      console.log('📅 Stock universe refresh: Saturday 10:00 AM ET');
      console.log('   → Repopulate stock_universe from FMP (top 7 per industry, $7B+ market cap)');
      console.log('📅 Weekly screening: Saturday 3:00 PM ET');
      console.log('   → Full fundamental screening (all stocks, 6 pathways)');
      console.log('   → Opus quality + overvalued screening');
      console.log('   → Populates saturday_watchlist with status=\'active\'');
      console.log('📅 Weekly Opus review: Sunday 9:00 PM ET');
      console.log('   → Analyzes all saturday_watchlist candidates with Opus extended thinking');
      console.log('   → Ranks by thesis strength, activates top 15 per pathway');
      console.log('   → Sets top candidates to status=\'active\', rest to \'pending\'');
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

    app.post('/api/trigger-saturday-screening', async (req, res) => {
      try {
        console.log('📡 Manual Saturday screening triggered via API');

        // Import and run Saturday screening only (no weekly review)
        const fundamentalScreener = (await import('./fundamental-screener.js')).default;
        const opusScreener = (await import('./opus-screener.js')).default;

        // Run screening steps only
        (async () => {
          try {
            console.log('\n📊 STEP 1: Fundamental screening (all stocks)...');
            await fundamentalScreener.runWeeklyScreen('full');

            console.log('\n🧠 STEP 2: Opus quality + overvalued screening...');
            await opusScreener.runWeeklyOpusScreening();

            console.log('✅ Saturday screening complete');
          } catch (error) {
            console.error('❌ Error in Saturday screening:', error);
          }
        })();

        res.json({ success: true, message: 'Saturday screening started. This will take 10-15 minutes. Check logs for progress.' });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    app.post('/api/trigger-daily-analysis', async (req, res) => {
      try {
        console.log('📡 Manual daily analysis triggered via API');
        (async () => {
          try {
            await this.runDailyAnalysis();
          } catch (error) {
            console.error('❌ Error in manual daily analysis:', error);
          }
        })();
        res.json({ success: true, message: 'Daily analysis started. Check logs for progress.' });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });


    app.post('/api/trigger-profile-build-watchlist', async (req, res) => {
      try {
        console.log('📡 Building/updating profiles for stocks in saturday_watchlist');
        (async () => {
          try {
            const db = await import('./db.js');
            const stockProfiles = await import('./stock-profiles.js');

            // Get all stocks from saturday_watchlist
            const watchlistResult = await db.query(
              'SELECT DISTINCT symbol FROM saturday_watchlist WHERE status = $1 ORDER BY symbol',
              ['active']
            );

            // Get existing profiles with their last_updated timestamps
            const profilesResult = await db.query(
              'SELECT symbol, last_updated FROM stock_profiles'
            );

            const watchlistSymbols = watchlistResult.rows.map(r => r.symbol);
            const existingProfiles = new Map(
              profilesResult.rows.map(r => [r.symbol, r.last_updated])
            );

            console.log(`Watchlist stocks: ${watchlistSymbols.length}, Existing profiles: ${existingProfiles.size}`);

            let newProfiles = 0;
            let incrementalUpdates = 0;
            let failed = 0;

            for (const symbol of watchlistSymbols) {
              try {
                const hasProfile = existingProfiles.has(symbol);

                if (hasProfile) {
                  // Incremental update for existing profiles
                  console.log(`[${newProfiles + incrementalUpdates + failed + 1}/${watchlistSymbols.length}] Updating ${symbol} (incremental)...`);
                  await stockProfiles.updateStockProfile(symbol); // Uses incremental update logic
                  incrementalUpdates++;
                } else {
                  // Full build for new profiles
                  console.log(`[${newProfiles + incrementalUpdates + failed + 1}/${watchlistSymbols.length}] Building ${symbol} (new)...`);
                  await stockProfiles.buildStockProfile(symbol);
                  newProfiles++;
                }

                // 3-second delay between profiles to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 3000));
              } catch (error) {
                console.error(`Failed ${symbol}: ${error.message}`);
                failed++;
              }
            }

            console.log(`✅ Profile building complete: ${newProfiles} new, ${incrementalUpdates} updated, ${failed} failed`);
          } catch (error) {
            console.error('❌ Error in profile building:', error);
          }
        })();
        res.json({ success: true, message: `Building/updating profiles for saturday_watchlist stocks. Check logs for progress.` });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    app.post('/api/trigger-weekly-portfolio-review', async (req, res) => {
      try {
        console.log('📡 Manual weekly portfolio review triggered via API');
        (async () => {
          try {
            const weeklyReview = await import('./weekly-portfolio-review.js');
            await weeklyReview.runWeeklyPortfolioReview();
            console.log('✅ Weekly portfolio review complete');
          } catch (error) {
            console.error('❌ Error in weekly portfolio review:', error);
          }
        })();
        res.json({ success: true, message: 'Weekly portfolio review started. This will take 5-10 minutes. Check logs for progress.' });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    app.post('/api/trigger-weekly-opus-review', async (req, res) => {
      try {
        console.log('📡 Manual weekly Opus review triggered via API');
        (async () => {
          try {
            const weeklyOpusReview = (await import('./weekly-opus-review.js')).default;
            const results = await weeklyOpusReview.runWeeklyReview();
            console.log(`✅ Weekly Opus review complete: ${results.analyzed} analyzed, ${results.activated} activated`);
          } catch (error) {
            console.error('❌ Error in weekly Opus review:', error);
          }
        })();
        res.json({ success: true, message: 'Weekly Opus review started. This will take 30-60 minutes depending on candidate count. Check logs for progress.' });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    app.post('/api/trigger-premarket-scan', async (req, res) => {
      try {
        console.log('📡 Manual pre-market scan triggered via API');
        (async () => {
          try {
            await this.runPreMarketScan();
          } catch (error) {
            console.error('❌ Error in manual pre-market scan:', error);
          }
        })();
        res.json({ success: true, message: 'Pre-market scan started. Check logs for progress.' });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    app.post('/api/update-etb-status', async (req, res) => {
      try {
        console.log('📡 Manual ETB status update triggered via API');
        (async () => {
          try {
            const tradierModule = await import('./tradier.js');
            const tradier = tradierModule.default;

            console.log('🔍 Fetching ETB list from Tradier...');
            const etbList = await tradier.getETBList();

            if (!etbList || etbList.length === 0) {
              console.error('❌ No ETB data received from Tradier');
              return;
            }

            console.log(`📊 Received ${etbList.length} stocks on ETB list`);

            const allStocks = await db.query('SELECT symbol FROM stock_universe WHERE status = $1', ['active']);
            console.log(`📈 Checking ${allStocks.rows.length} stocks in universe`);

            let shortableCount = 0;
            let notShortableCount = 0;

            for (const stock of allStocks.rows) {
              const isETB = etbList.some(etb => etb.symbol === stock.symbol);

              await db.query(
                `UPDATE stock_universe SET shortable = $1, last_etb_check = NOW() WHERE symbol = $2`,
                [isETB, stock.symbol]
              );

              if (isETB) {
                shortableCount++;
                process.stdout.write('✓');
              } else {
                notShortableCount++;
                process.stdout.write('·');
              }
            }

            console.log('\n\n✅ ETB status update complete!');
            console.log(`✓ Shortable: ${shortableCount}`);
            console.log(`· Not shortable: ${notShortableCount}`);
            console.log(`📊 Shortable percentage: ${((shortableCount / allStocks.rows.length) * 100).toFixed(1)}%`);
          } catch (error) {
            console.error('❌ Error updating ETB status:', error);
          }
        })();
        res.json({ success: true, message: 'ETB status update started. Check logs for progress.' });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    app.post('/api/trigger-eod-summary', async (req, res) => {
      try {
        console.log('📡 Manual EOD summary triggered via API');
        (async () => {
          try {
            await this.sendDailySummary();
          } catch (error) {
            console.error('❌ Error in manual EOD summary:', error);
          }
        })();
        res.json({ success: true, message: 'EOD summary started. Check logs for progress.' });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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
        portfolio.positions.length < 12 ||
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
      const phase1Start = Date.now();
      const preRankedStocks = await preRanking.rankStocks();
      console.log(`   ✅ Pre-ranked to ${preRankedStocks.longs.length} long + ${preRankedStocks.shorts.length} short candidates`);
      console.log('');

      // Fetch market context (indices + portfolio stocks + pre-ranked candidates)
      console.log('📊 Fetching market context...');
      const portfolioSymbols = portfolio.positions.map(p => p.symbol);
      const marketIndices = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX', 'TLT', 'GLD', 'USO'];
      const candidateSymbols = [
        ...preRankedStocks.longs.map(c => c.symbol),
        ...preRankedStocks.shorts.map(c => c.symbol)
      ];
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

      // Build intent mapping for Opus (pathway from saturday_watchlist)
      const intentMap = {};
      const pathwayMap = {};

      // Pathway-to-intent mapping
      const PATHWAY_TO_INTENT = {
        'deepValue': 'value_dip',
        'cashMachine': 'value_dip',
        'qarp': 'value_dip',
        'highGrowth': 'growth',
        'inflection': 'growth_momentum',
        'turnaround': 'turnaround',
        'overvalued': 'short_overvalued'
      };

      // Map pre-ranked candidates with pathway info from saturday_watchlist
      preRankedStocks.longs.forEach(candidate => {
        const pathway = candidate.pathway;
        pathwayMap[candidate.symbol] = pathway;
        intentMap[candidate.symbol] = pathway ? PATHWAY_TO_INTENT[pathway] || 'momentum' : 'momentum';
      });
      preRankedStocks.shorts.forEach(candidate => {
        const pathway = candidate.pathway;
        pathwayMap[candidate.symbol] = pathway;
        intentMap[candidate.symbol] = pathway ? PATHWAY_TO_INTENT[pathway] || 'momentum_short' : 'momentum_short';
      });

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
        for (const item of watchlist) {
          const sector = await this.getSector(item.symbol);
          const atTarget = item.current_price <= item.target_entry_price ? '✅ AT TARGET' : '';
          watchlistContext += `- ${item.symbol} (${sector}): Current $${item.current_price}, Target Entry $${item.target_entry_price} ${atTarget}\n`;
          watchlistContext += `  Why watching: ${item.why_watching}\n`;
          watchlistContext += `  Why not buying now: ${item.why_not_buying_now}\n\n`;
        }
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
${preRankedStocks.longs.map(c => c.symbol).join(', ')}

**Short Candidates (${preRankedStocks.shorts.length} stocks):**
${preRankedStocks.shorts.map(c => c.symbol).join(', ')}

**Your Task for Phase 1:**
1. Review the pre-ranked candidates above
2. Split into TWO separate lists:
   - **15-20 LONG candidates** for Phase 2 deep analysis
   - **15-20 SHORT candidates** for Phase 3 deep analysis
3. Prioritize:
   - Watchlist stocks that are at or near target entry prices
   - Stocks with strong fundamental catalysts (earnings, news, sector rotation)
   - Diversification across asset classes and sectors
4. **IMPORTANT: Max 0-3 stocks per sub-sector** (e.g., 0-3 semiconductors, 0-3 software stocks, 0-3 banks)
   - Sub-sectors include: Semiconductors, Software, Cybersecurity, Cloud, Biotech, Pharma, Banks, etc.
   - Choose 0-3 based on quality and market conditions - not mandatory to pick 3
   - If market conditions are bad for a sub-sector, pick 0 (skip it entirely)
   - This prevents over-concentration in a specific sub-sector

Format your response EXACTLY like this:
LONG_CANDIDATES:
MSFT
NVDA
LLY
...
(15-20 stocks)

SHORT_CANDIDATES:
ZS
OKTA
NKE
...
(15-20 stocks)

REASONING:
[Brief explanation of your selection criteria and sector diversification]

${historyContext}

${trendContext}`;

      // Use pre-ranked stocks directly as candidates (no Opus Phase 1 needed)
      const phase1Duration = ((Date.now() - phase1Start) / 1000).toFixed(1);
      const candidates = preRankedStocks;

      console.log(`✅ Phase 1 complete (${phase1Duration}s)`);
      console.log('');
      console.log(`🎯 Phase 1 Results:`);
      console.log(`   Long candidates: ${candidates.longs.length} stocks`);
      console.log(`   Short candidates: ${candidates.shorts.length} stocks`);
      console.log(`   Longs: ${candidates.longs.map(c => c.symbol).join(', ')}`);
      console.log(`   Shorts: ${candidates.shorts.map(c => c.symbol).join(', ')}`);
      console.log('');

      // Fetch prices for all identified stocks (both long and short candidates)
      console.log('📊 Fetching prices for all candidates...');
      const allCandidates = [...candidates.longs.map(c => c.symbol), ...candidates.shorts.map(c => c.symbol)];
      const allSymbols = [...new Set([...portfolioSymbols, ...marketIndices, ...allCandidates])];
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

      // PHASE 2: Deep analysis of LONG candidates (50k thinking budget)
      console.log('');
      console.log('═══════════════════════════════════════');
      console.log('📈 PHASE 2: LONG ANALYSIS');
      console.log('═══════════════════════════════════════');
      console.log(`Analyzing ${candidates.longs.length} long candidates with 35k token thinking budget`);
      console.log('⏳ This will take 3-5 minutes...');
      console.log('');

      // Fetch stock profiles for long candidates
      console.log('📚 Fetching stock profiles for long candidates...');
      const longSymbols = candidates.longs.map(c => c.symbol);
      const longProfiles = await stockProfiles.getStockProfiles(longSymbols);
      const profileCount = Object.keys(longProfiles).length;
      const missingProfiles = longSymbols.filter(s => !longProfiles[s]).length;
      const staleProfiles = Object.values(longProfiles).filter(p => {
        const daysOld = Math.floor((Date.now() - new Date(p.last_updated).getTime()) / (1000 * 60 * 60 * 24));
        return daysOld > 14;
      }).length;

      console.log(`✅ Found profiles for ${profileCount}/${candidates.longs.length} long candidates`);
      if (missingProfiles > 0) {
        console.log(`   ⚠️ ${missingProfiles} stocks have no profile - will do full deep research`);
      }
      if (staleProfiles > 0) {
        console.log(`   ⚠️ ${staleProfiles} profiles are stale (>14 days) - Opus will refresh these`);
      }
      const freshProfiles = profileCount - staleProfiles;
      if (freshProfiles > 0) {
        console.log(`   ✅ ${freshProfiles} fresh profiles loaded - saving ~${freshProfiles * 15}k tokens vs full rebuild`);
      }

      // Build stock profile context
      let stockProfileContext = '';
      if (Object.keys(longProfiles).length > 0) {
        stockProfileContext = '\n\n**STOCK PROFILES (reference these for efficient analysis):**\n';
        Object.entries(longProfiles).forEach(([symbol, profile]) => {
          const daysOld = Math.floor((Date.now() - new Date(profile.last_updated).getTime()) / (1000 * 60 * 60 * 24));
          stockProfileContext += `\n${symbol} (profile ${daysOld} days old):\n`;
          stockProfileContext += `  Business: ${profile.business_model?.substring(0, 200) || 'N/A'}...\n`;
          stockProfileContext += `  Moats: ${profile.moats?.substring(0, 150) || 'N/A'}...\n`;
          stockProfileContext += `  Key Risks: ${profile.risks?.substring(0, 150) || 'N/A'}...\n`;
          if (daysOld > 14) {
            stockProfileContext += `  ⚠️ Profile is stale (${daysOld} days old) - do deeper refresh\n`;
          } else {
            stockProfileContext += `  ✅ Profile is fresh - focus on what changed since last update\n`;
          }
        });
      }

      // Also fetch recent analysis history for context
      const longStockHistory = {};
      for (const candidate of candidates.longs) {
        const symbol = candidate.symbol;
        const history = await trendLearning.getStockAnalysisHistory(symbol, 2);
        if (history.length > 0) {
          longStockHistory[symbol] = history;
        }
      }

      let recentAnalysisContext = '';
      if (Object.keys(longStockHistory).length > 0) {
        recentAnalysisContext = '\n\n**RECENT TRADE DECISIONS:**\n';
        Object.entries(longStockHistory).forEach(([symbol, history]) => {
          recentAnalysisContext += `${symbol}: `;
          recentAnalysisContext += history.map(h => `${h.analysis_date} ${h.recommendation}`).join(', ');
          recentAnalysisContext += '\n';
        });
      }

      // Get learning insights from weekly reviews
      const learningInsights = await learningFeedback.getRecentInsights(30);
      const learningContext = learningInsights || '';

      const phase2Question = `You are managing a $100k portfolio. You are in PHASE 2: LONG ANALYSIS.

**Deep Analysis Approach:**
Take your time with each stock. Don't rush through the analysis. For stocks with existing profiles, reference the profile and focus on what's changed (price action, news, catalysts). For stocks without profiles or with stale profiles (>14 days old), do a more comprehensive analysis. Think through multiple scenarios, evaluate risks thoroughly, and consider second-order effects.
${learningContext}
**Input:** ${candidates.longs.length} long candidates from Phase 1

**Long Candidates:**
${candidates.longs.map(c => {
  const price = fullMarketData[c.symbol]?.price || 'N/A';
  const change = fullMarketData[c.symbol]?.change_percentage || 0;
  const changeStr = change >= 0 ? `+${change}` : `${change}`;
  const sourceTag = c.source === 'watchlist' ? ` [${c.pathway || 'watchlist'}]` : ' [momentum]';
  const scoreTag = c.score ? ` (score: ${c.score})` : '';
  return `- ${c.symbol}${sourceTag}${scoreTag}: $${price} (${changeStr}%)${c.sourceReasons ? ` - ${c.sourceReasons}` : ''}`;
}).join('\n')}
${stockProfileContext}
${recentAnalysisContext}

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

**Your Task:** Analyze each candidate and provide BUY or PASS decisions.

**Analysis Framework (for each stock):**
1. Fundamental Analysis: Business quality, revenue/earnings growth, valuation, balance sheet, management
2. Technical Analysis: Price vs moving averages, support/resistance, volume, RSI/MACD, chart patterns
3. Catalyst Analysis: Earnings, product launches, sector trends, insider activity, news flow
4. Risk/Reward: Entry price, stop loss, target price, R/R ratio (minimum 2:1), position size

**Decision Criteria:**
- BUY: Strong fundamentals + favorable technicals + clear catalyst + R/R > 2:1
- PASS: Missing key criteria or better opportunities exist

**CRITICAL: 0-3 per sub-sector enforcement**
- Track sub-sector count as you analyze
- If sub-sector already has 3 BUY decisions, automatically PASS remaining candidates
- Prioritize highest conviction setups within each sub-sector

**Output Format (for each stock):**
SYMBOL: [ticker]
SUB-SECTOR: [specific sub-sector]
DECISION: BUY or PASS

[If BUY:]
ENTRY: $[price]
STOP: $[price] ([X]% risk)
TARGET: $[price] ([X]% upside)
POSITION_SIZE: [X]% of portfolio ($[amount])
CONVICTION: High/Medium
REASONING: [2-3 sentences]

[If PASS:]
REASONING: [1-2 sentences]

---

**Final Phase 2 Summary:**
EXECUTE_BUY:
- SYMBOL | QUANTITY | ENTRY | STOP | TARGET | SUBSECTOR
[repeat for each BUY]

TOTAL_BUY_RECOMMENDATIONS: [count]
SUB-SECTOR_BREAKDOWN: [list count per sub-sector]
TOTAL_CAPITAL_ALLOCATED: $[amount] ([X]% of portfolio)

${historyContext}`;

      const phase2Start = Date.now();
      const phase2Analysis = await claude.deepAnalysis(
        portfolio,
        fullMarketData,
        news,
        {},
        phase2Question,
        35000  // 35k token thinking budget for long analysis
      );
      const phase2Duration = ((Date.now() - phase2Start) / 1000).toFixed(1);

      // Log token usage for Phase 2
      const phase2Tokens = phase2Analysis.usage || {};
      console.log(`✅ Phase 2 complete (${phase2Duration}s)`);
      console.log(`   Token usage: ${phase2Tokens.input_tokens || 'N/A'} input, ${phase2Tokens.output_tokens || 'N/A'} output`);
      if (phase2Tokens.cache_read_input_tokens) {
        console.log(`   Cache: ${phase2Tokens.cache_read_input_tokens} tokens read from cache`);
      }
      console.log('');

      // PHASE 3: Deep analysis of SHORT candidates (50k thinking budget)
      console.log('');
      console.log('═══════════════════════════════════════');
      console.log('📉 PHASE 3: SHORT ANALYSIS');
      console.log('═══════════════════════════════════════');
      console.log(`Analyzing ${candidates.shorts.length} short candidates with 35k token thinking budget`);
      console.log('⏳ This will take 3-5 minutes...');
      console.log('');

      // Fetch stock profiles for short candidates
      console.log('📚 Fetching stock profiles for short candidates...');
      const shortSymbols = candidates.shorts.map(c => c.symbol);
      const shortProfiles = await stockProfiles.getStockProfiles(shortSymbols);
      console.log(`✅ Found profiles for ${Object.keys(shortProfiles).length} stocks`);

      // Build short stock profile context
      let shortProfileContext = '';
      if (Object.keys(shortProfiles).length > 0) {
        shortProfileContext = '\n\n**STOCK PROFILES (reference these for efficient analysis):**\n';
        Object.entries(shortProfiles).forEach(([symbol, profile]) => {
          const daysOld = Math.floor((Date.now() - new Date(profile.last_updated).getTime()) / (1000 * 60 * 60 * 24));
          shortProfileContext += `\n${symbol} (profile ${daysOld} days old):\n`;
          shortProfileContext += `  Business: ${profile.business_model?.substring(0, 200) || 'N/A'}...\n`;
          shortProfileContext += `  Key Risks: ${profile.risks?.substring(0, 150) || 'N/A'}...\n`;
          if (daysOld > 14) {
            shortProfileContext += `  ⚠️ Profile is stale (${daysOld} days old) - do deeper refresh\n`;
          } else {
            shortProfileContext += `  ✅ Profile is fresh - focus on what changed since last update\n`;
          }
        });
      }

      // Also fetch recent analysis history for context
      const shortStockHistory = {};
      for (const candidate of candidates.shorts) {
        const symbol = candidate.symbol;
        const history = await trendLearning.getStockAnalysisHistory(symbol, 2);
        if (history.length > 0) {
          shortStockHistory[symbol] = history;
        }
      }

      let shortRecentAnalysisContext = '';
      if (Object.keys(shortStockHistory).length > 0) {
        shortRecentAnalysisContext = '\n\n**RECENT TRADE DECISIONS:**\n';
        Object.entries(shortStockHistory).forEach(([symbol, history]) => {
          shortRecentAnalysisContext += `${symbol}: `;
          shortRecentAnalysisContext += history.map(h => `${h.analysis_date} ${h.recommendation}`).join(', ');
          shortRecentAnalysisContext += '\n';
        });
      }

      const phase3Question = `You are managing a $100k portfolio. You are in PHASE 3: SHORT ANALYSIS.

**Deep Analysis Approach:**
Take your time with each stock. Don't rush through the analysis. For stocks with existing profiles, reference the profile and focus on what's changed (price action, news, catalysts). For stocks without profiles or with stale profiles (>14 days old), do a more comprehensive analysis. Think through multiple scenarios, evaluate risks thoroughly, and consider second-order effects.
${learningContext}
**Input:** ${candidates.shorts.length} short candidates from Phase 1

**Short Candidates:**
${candidates.shorts.map(c => {
  const price = fullMarketData[c.symbol]?.price || 'N/A';
  const change = fullMarketData[c.symbol]?.change_percentage || 0;
  const changeStr = change >= 0 ? `+${change}` : `${change}`;
  const sourceTag = c.source === 'watchlist' ? ` [${c.pathway || 'watchlist'}]` : ' [momentum]';
  const scoreTag = c.score ? ` (score: ${c.score})` : '';
  return `- ${c.symbol}${sourceTag}${scoreTag}: $${price} (${changeStr}%)${c.sourceReasons ? ` - ${c.sourceReasons}` : ''}`;
}).join('\n')}
${shortProfileContext}
${shortRecentAnalysisContext}

**Current Portfolio:**
- Positions: ${portfolio.positions.length}
- Total Value: $${portfolio.totalValue.toLocaleString()}
- Cash Available: $${portfolio.cash.toLocaleString()}

${cashContext}
${vixContext}
${macroContext}
${performanceContext}
${sectorContext}
${optionsContext}
${marketRegimeContext}
${assetClassContext}

**Your Task:** Analyze each candidate and provide SHORT or PASS decisions.

**Analysis Framework (for each stock):**
1. Fundamental Weakness: Deteriorating business, declining revenue/earnings, excessive valuation, balance sheet concerns
2. Technical Confirmation (REQUIRED): Price below declining 200MA, RSI not oversold (>30), breakdown below support, bearish patterns
3. Catalyst Analysis: NO earnings within 2 weeks, sector headwinds, insider selling, negative news
4. Risk Assessment: Entry price, tight stop (5-8% above entry), target price, short squeeze risk, position size (5-10% max)

**Decision Criteria:**
- SHORT: Weak fundamentals + bearish technicals + clear catalyst + NO earnings + low squeeze risk
- PASS: Missing technical confirmation, earnings risk, high short interest, or better opportunities exist

**CRITICAL: 0-3 per sub-sector enforcement**
- Track sub-sector count as you analyze
- If sub-sector already has 3 SHORT decisions, automatically PASS remaining candidates
- Prioritize highest conviction setups within each sub-sector

**MANDATORY TECHNICAL CHECKLIST (must pass ALL):**
- [ ] Price below 200MA
- [ ] 200MA is declining
- [ ] RSI > 30 (not oversold)
- [ ] No earnings within 2 weeks
- [ ] Short interest < 20% of float

**Output Format (for each stock):**
SYMBOL: [ticker]
SUB-SECTOR: [specific sub-sector]
DECISION: SHORT or PASS

[If SHORT:]
ENTRY: $[price]
STOP: $[price] ([X]% risk, typically 5-8%)
TARGET: $[price] ([X]% downside)
POSITION_SIZE: [X]% of portfolio ($[amount], typically 5-10%)
CONVICTION: High/Medium
TECHNICAL_CHECKLIST: [confirm all 5 items checked]
REASONING: [2-3 sentences]

[If PASS:]
REASONING: [1-2 sentences, specify which technical criteria failed if applicable]

---

**Final Phase 3 Summary:**
EXECUTE_SHORT:
- SYMBOL | QUANTITY | ENTRY | STOP | TARGET | SUBSECTOR
[repeat for each SHORT]

TOTAL_SHORT_RECOMMENDATIONS: [count]
SUB-SECTOR_BREAKDOWN: [list count per sub-sector]
TOTAL_CAPITAL_ALLOCATED: $[amount] ([X]% of portfolio)

${historyContext}`;

      const phase3Start = Date.now();
      const phase3Analysis = await claude.deepAnalysis(
        portfolio,
        fullMarketData,
        news,
        {},
        phase3Question,
        35000  // 35k token thinking budget for short analysis
      );
      const phase3Duration = ((Date.now() - phase3Start) / 1000).toFixed(1);

      // Log token usage for Phase 3
      const phase3Tokens = phase3Analysis.usage || {};
      console.log(`✅ Phase 3 complete (${phase3Duration}s)`);
      console.log(`   Token usage: ${phase3Tokens.input_tokens || 'N/A'} input, ${phase3Tokens.output_tokens || 'N/A'} output`);
      if (phase3Tokens.cache_read_input_tokens) {
        console.log(`   Cache: ${phase3Tokens.cache_read_input_tokens} tokens read from cache`);
      }
      console.log('');

      // Extract per-stock reasoning from Phase 2 and Phase 3 for use in trade approvals
      const stockReasoningMap = this.extractStockReasoningFromPhases(
        phase2Analysis.analysis,
        phase3Analysis.analysis
      );
      console.log(`📝 Extracted reasoning for ${Object.keys(stockReasoningMap).length} stocks from Phase 2/3`);

      // Log which stocks have reasoning
      if (Object.keys(stockReasoningMap).length > 0) {
        console.log(`   Stocks with detailed reasoning: ${Object.keys(stockReasoningMap).join(', ')}`);
      } else {
        console.log(`   ⚠️ No detailed reasoning extracted - check Phase 2/3 output format`);
      }
      console.log('');

      // Save Phase 2 and Phase 3 to database for dashboard display
      await db.logAIDecision({
        type: 'phase2-long-analysis',
        symbol: null,
        recommendation: phase2Analysis.analysis,
        reasoning: `Phase 2: Deep long analysis of ${candidates.longs.length} candidates (35k token thinking budget)`,
        model: 'opus',
        confidence: 'high',
        inputTokens: phase2Analysis.usage?.input_tokens,
        outputTokens: phase2Analysis.usage?.output_tokens,
        totalTokens: (phase2Analysis.usage?.input_tokens || 0) + (phase2Analysis.usage?.output_tokens || 0),
        durationSeconds: parseInt(phase2Duration)
      });

      await db.logAIDecision({
        type: 'phase3-short-analysis',
        symbol: null,
        recommendation: phase3Analysis.analysis,
        reasoning: `Phase 3: Deep short analysis of ${candidates.shorts.length} candidates (35k token thinking budget)`,
        model: 'opus',
        confidence: 'high',
        inputTokens: phase3Analysis.usage?.input_tokens,
        outputTokens: phase3Analysis.usage?.output_tokens,
        totalTokens: (phase3Analysis.usage?.input_tokens || 0) + (phase3Analysis.usage?.output_tokens || 0),
        durationSeconds: parseInt(phase3Duration)
      });

      console.log('✅ Phase 2 and Phase 3 saved to database');
      console.log('');

      // PHASE 4: Portfolio construction combining insights from Phase 2 & 3 (20k thinking budget)
      console.log('');
      console.log('═══════════════════════════════════════');
      console.log('🎯 PHASE 4: PORTFOLIO CONSTRUCTION');
      console.log('═══════════════════════════════════════');
      console.log('Combining long and short insights with 45k token thinking budget');
      console.log('⏳ This will take 1-2 minutes...');
      console.log('');

      const phase4Question = `You are managing a $100k portfolio. You are in PHASE 4: PORTFOLIO CONSTRUCTION.

**CRITICAL OUTPUT FORMAT REQUIREMENT:**
You MUST output trades in this EXACT format for the parser to work:

EXECUTE_BUY: AVGO | 26 | 373.96 | 355.00 | 420.00 | deepValue | value_dip
EXECUTE_BUY: TSM | 26 | 377.12 | 360.00 | 415.00 | highGrowth | growth

EXECUTE_SHORT: NET | 45 | 177.72 | 186.60 | 151.06 | overvalued | short_overvalued
EXECUTE_SHORT: NOW | 95 | 84.23 | 88.44 | 71.60 | null | momentum_short

**CRITICAL STOP-LOSS RULES:**
- LONGS: Stop BELOW entry (e.g., entry $100, stop $95)
- SHORTS: Stop ABOVE entry (e.g., entry $100, stop $105) - you lose money when price RISES

IMPORTANT: Each trade MUST start with "EXECUTE_BUY:" or "EXECUTE_SHORT:" on the SAME line as the trade data.
DO NOT use table format. DO NOT add "shares" or "$" symbols. DO NOT add column headers.
Format: EXECUTE_BUY: SYMBOL | QUANTITY | ENTRY | STOP | TARGET | PATHWAY | INTENT
- PATHWAY: Original Saturday screening pathway (deepValue, highGrowth, etc.) or "null" if intraday discovery
- INTENT: Current trade intent based on setup (value_dip, growth, momentum, short_overvalued, etc.)

**PHASE 2 LONG ANALYSIS RESULTS:**
${phase2Analysis.analysis}

**PHASE 3 SHORT ANALYSIS RESULTS:**
${phase3Analysis.analysis}

**CANDIDATE PATHWAY CONTEXT:**
The following stocks came from Saturday's fundamental screening with specific pathways:
${Object.entries(pathwayMap).filter(([_, pathway]) => pathway).map(([symbol, pathway]) =>
  `- ${symbol}: ${pathway} (intent: ${intentMap[symbol]})`
).join('\n') || 'No pathway-tagged stocks in this batch'}

Pathway meanings:
- deepValue/cashMachine/qarp → Value plays, consider for dip-buying
- highGrowth/inflection → Growth plays, momentum-driven
- turnaround → Special situation, higher risk
- overvalued → Short candidate, overextended valuation
- null → Intraday momentum discovery (not from Saturday screening)

When constructing trades, preserve the pathway context and assign appropriate intent based on current setup.

**Current Market Prices:**
All prices below are LIVE quotes - use these exact prices for entry calculations.

Long Candidates:
${candidates.longs.map(c => {
  const price = fullMarketData[c.symbol]?.price || 'N/A';
  const change = fullMarketData[c.symbol]?.change_percentage || 0;
  const changeStr = change >= 0 ? `+${change}` : `${change}`;
  const sourceTag = c.source === 'watchlist' ? ` [${c.pathway || 'watchlist'}]` : ' [momentum]';
  const scoreTag = c.score ? ` (score: ${c.score})` : '';
  return `- ${c.symbol}${sourceTag}${scoreTag}: $${price} (${changeStr}%)${c.sourceReasons ? ` - ${c.sourceReasons}` : ''}`;
}).join('\n')}

Short Candidates:
${candidates.shorts.map(c => {
  const price = fullMarketData[c.symbol]?.price || 'N/A';
  const change = fullMarketData[c.symbol]?.change_percentage || 0;
  const changeStr = change >= 0 ? `+${change}` : `${change}`;
  const sourceTag = c.source === 'watchlist' ? ` [${c.pathway || 'watchlist'}]` : ' [momentum]';
  const scoreTag = c.score ? ` (score: ${c.score})` : '';
  return `- ${c.symbol}${sourceTag}${scoreTag}: $${price} (${changeStr}%)${c.sourceReasons ? ` - ${c.sourceReasons}` : ''}`;
}).join('\n')}

**Current Portfolio:**
- Positions: ${portfolio.positions.length}
- Total Value: $${portfolio.totalValue.toLocaleString()}
- Cash Available: $${portfolio.cash.toLocaleString()}

${marketRegimeContext}
${assetClassContext}

**Your Task:** Construct final portfolio with 12-14 positions total.

**PRIMARY GOAL: BEAT S&P 500 (SPY)**
Your portfolio must outperform SPY on a risk-adjusted basis. This means:
- Target: Outperform SPY by 5-10% annually (minimum goal, not a ceiling)
- Consider SPY's current momentum and trend when sizing positions
- Balance sector weights vs SPY to capture alpha opportunities
- Optimize for Sharpe ratio (return per unit of risk)
- Take concentrated bets where conviction is high and risk/reward is favorable

This is NOT about "safe diversification" - it's about beating the benchmark through superior stock selection and position sizing.

**Portfolio Constraints:**
- Total positions: 10-12 (combined longs + shorts)
- Max position size: 12% ($12,000)
- Min position size: 5% ($5,000)
- 0-3 stocks per sub-sector (ACROSS BOTH LONGS AND SHORTS COMBINED)

**Construction Process:**
1. Sub-Sector Limit Enforcement: Review all BUY and SHORT recommendations, count total per sub-sector (longs + shorts combined), eliminate lowest conviction if >3
2. Market Regime Allocation: Bull (60-70% long, 30-40% short), Bear (30-40% long, 60-70% short), Neutral (50-50%)
3. Diversification Check: Max 30% in any single sector, balance growth/value and cyclical/defensive
4. Position Sizing: High conviction + low vol (10-12%), High conviction + high vol (8-10%), Medium conviction (6-8%), Shorts (5-10%)
5. Final Risk Assessment: Portfolio beta, sector concentration, event risk, liquidity

**Output Format:**

**FINAL PORTFOLIO CONSTRUCTION:**

**LONG POSITIONS:**
1. SYMBOL | QUANTITY | ENTRY | STOP | TARGET | SUBSECTOR | ALLOCATION
[repeat for each long, sorted by allocation %]

**SHORT POSITIONS:**
1. SYMBOL | QUANTITY | ENTRY | STOP | TARGET | SUBSECTOR | ALLOCATION
[repeat for each short, sorted by allocation %]

**PORTFOLIO SUMMARY:**
- Total Positions: [count]
- Long Positions: [count] ([X]% of capital)
- Short Positions: [count] ([X]% of capital)
- Cash Reserve: [X]%
- Sub-Sector Breakdown: [list each sub-sector with count]
- Sector Allocation: [list major sectors with %]

**ELIMINATED POSITIONS (if any):**
- SYMBOL | REASON

**RISK METRICS:**
- Estimated Portfolio Beta: [X.XX]
- Largest Position: [X]%
- Largest Sector: [X]%
- Net Market Exposure: [X]% (long % - short %)

**FINAL EXECUTION COMMANDS:**

EXECUTE_BUY: SYMBOL | QUANTITY | ENTRY | STOP | TARGET | PATHWAY | INTENT
EXECUTE_BUY: SYMBOL | QUANTITY | ENTRY | STOP | TARGET | PATHWAY | INTENT
[one EXECUTE_BUY line per long position]

EXECUTE_SHORT: SYMBOL | QUANTITY | ENTRY | STOP | TARGET | PATHWAY | INTENT
EXECUTE_SHORT: SYMBOL | QUANTITY | ENTRY | STOP | TARGET | PATHWAY | INTENT
[one EXECUTE_SHORT line per short position]

Remember: Each trade MUST have "EXECUTE_BUY:" or "EXECUTE_SHORT:" prefix on the SAME line as the trade data.
Include PATHWAY (from Saturday screening or "null") and INTENT (current trade rationale).

**RATIONALE:**
[2-3 sentences explaining portfolio construction logic, market regime consideration, and key risk/reward thesis]

${historyContext}`;

      const phase4Start = Date.now();
      const analysis = await claude.deepAnalysis(
        portfolio,
        fullMarketData,
        news,
        {},
        phase4Question,
        45000  // 45k token thinking budget for portfolio construction
      );
      const phase4Duration = ((Date.now() - phase4Start) / 1000).toFixed(1);
      const totalDuration = ((Date.now() - phase1Start) / 1000).toFixed(1);

      // Log token usage for Phase 4
      const phase4Tokens = analysis.usage || {};

      console.log('');
      console.log('═══════════════════════════════════════');
      console.log('✅ 4-PHASE OPUS ANALYSIS COMPLETE');
      console.log('═══════════════════════════════════════');
      console.log('Phase 1 Duration:', phase1Duration, 'seconds (pre-ranking)');
      console.log('Phase 2 Duration:', phase2Duration, 'seconds (long analysis, 35k tokens)');
      console.log('Phase 3 Duration:', phase3Duration, 'seconds (short analysis, 35k tokens)');
      console.log('Phase 4 Duration:', phase4Duration, 'seconds (portfolio construction, 45k tokens)');
      console.log('Total Duration:', totalDuration, 'seconds');
      console.log('');
      console.log('📊 PHASE-BY-PHASE TOKEN USAGE:');
      console.log(`   Phase 2: ${phase2Tokens.input_tokens || 'N/A'} input, ${phase2Tokens.output_tokens || 'N/A'} output`);
      console.log(`   Phase 3: ${phase3Tokens.input_tokens || 'N/A'} input, ${phase3Tokens.output_tokens || 'N/A'} output`);
      console.log(`   Phase 4: ${phase4Tokens.input_tokens || 'N/A'} input, ${phase4Tokens.output_tokens || 'N/A'} output`);

      const totalInputTokens = (phase2Tokens.input_tokens || 0) + (phase3Tokens.input_tokens || 0) + (phase4Tokens.input_tokens || 0);
      const totalOutputTokens = (phase2Tokens.output_tokens || 0) + (phase3Tokens.output_tokens || 0) + (phase4Tokens.output_tokens || 0);
      console.log(`   Total: ${totalInputTokens.toLocaleString()} input, ${totalOutputTokens.toLocaleString()} output`);
      console.log('');
      console.log('Response length:', analysis.analysis.length, 'characters');
      console.log('Model used:', analysis.model);

      console.log('');
      console.log('📊 ANALYSIS PREVIEW (first 1500 chars):');
      console.log('─────────────────────────────────────');
      console.log(analysis.analysis.substring(0, 1500));
      console.log('─────────────────────────────────────');
      console.log('');

      // Thinking block is stored internally but not displayed to user

      console.log('💾 Saving analysis to database...');

      // Log the decision with token usage
      const allAnalyzedStocks = [...candidates.longs.map(c => c.symbol), ...candidates.shorts.map(c => c.symbol)];
      const analysisId = await db.logAIDecision({
        type: 'deep-analysis',
        symbol: null,
        recommendation: analysis.analysis,
        reasoning: `4-phase deep analysis. Phase 1: ${candidates.longs.length} longs + ${candidates.shorts.length} shorts identified. Phase 2: Long analysis (50k tokens). Phase 3: Short analysis (50k tokens). Phase 4: Portfolio construction (20k tokens).`,
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
        description: `4-phase analysis: ${candidates.longs.length} longs + ${candidates.shorts.length} shorts analyzed`,
        actionTaken: analysis.analysis.substring(0, 500) // First 500 chars as summary
      });
      console.log('✅ Trend pattern saved');
      console.log('');

      // Get VIX regime for stock analysis metadata
      const currentRegime = await vixRegime.getRegime();

      // Save stock analyses to learning database for each analyzed ticker
      console.log('💾 Saving stock analyses to learning database...');
      const { saveStockAnalysis } = await import('./trend-learning.js');

      for (const ticker of allAnalyzedStocks) {
        try {
          // Extract analysis for this specific ticker from the full analysis text
          const tickerMention = analysis.analysis.includes(ticker);
          if (tickerMention) {
            await saveStockAnalysis({
              symbol: ticker,
              date: new Date().toISOString().split('T')[0],
              type: 'daily',
              price: fullMarketData[ticker]?.price || 0,
              thesis: `Analyzed in 4-phase deep analysis with ${allAnalyzedStocks.length} stocks`,
              recommendation: analysis.analysis.includes(`BUY: ${ticker}`) ? 'buy' :
                            analysis.analysis.includes(`SHORT: ${ticker}`) ? 'short' : 'hold',
              confidence: 'medium',
              keyFactors: [`Included in ${allAnalyzedStocks.length}-stock analysis`, `VIX: ${currentRegime.vix}`]
            });
          }
        } catch (error) {
          console.warn(`⚠️ Could not save analysis for ${ticker}:`, error.message);
        }
      }
      console.log(`✅ Saved ${allAnalyzedStocks.length} stock analyses to learning database`);
      console.log('');

      // Parse recommendations and execute trades automatically
      console.log('🔍 Parsing trade recommendations...');
      const recommendations = await this.parseRecommendations(analysis.analysis);

      if (recommendations.length > 0) {
        console.log(`✅ Found ${recommendations.length} trade recommendations`);

        // Validate sector constraints (0-3 per sub-sector)
        console.log('🔍 Validating sector constraints...');
        const sectorValidator = (await import('./sector-validator.js')).default;
        const validation = sectorValidator.validateTrades(recommendations);

        if (!validation.valid) {
          console.log(`⚠️ Sector constraint violations detected:`);
          validation.violations.forEach(v => {
            console.log(`   - ${v.symbol} rejected: ${v.reason}`);
          });
          console.log(`✅ Adjusted to ${validation.adjustedTrades.length} trades (from ${recommendations.length})`);
          console.log('   Sub-sector breakdown:');
          validation.subSectorBreakdown.forEach(sb => {
            console.log(`   - ${sb.subSector}: ${sb.count} stocks (${sb.symbols.join(', ')})`);
          });
        } else {
          console.log(`✅ All trades pass sector constraints`);
        }

        // Use validated trades
        const validatedRecommendations = validation.adjustedTrades;

        // Get portfolio state and VIX regime
        const portfolio = await analysisEngine.getPortfolioState();
        const regime = await vixRegime.getRegime();

        // STEP 1: Apply VIX adjustment to all trade quantities BEFORE sector validation
        console.log(`\n📊 Applying VIX regime adjustments (${regime.name}: ${(regime.positionSizeMultiplier * 100).toFixed(0)}% multiplier)...`);
        for (const rec of validatedRecommendations) {
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
        const adjustedRecs = await this.validateAndAdjustAssetClassAllocation(validatedRecommendations, portfolio);

        // Batch submit all trades for approval
        const submittedTrades = [];
        const approvalIds = [];

        for (const rec of adjustedRecs) {
          const action = rec.type === 'short' ? 'SHORT' : 'BUY';
          console.log(`   💰 Preparing trade: ${action} ${rec.quantity} ${rec.symbol} at $${rec.entryPrice}...`);

          // Use detailed reasoning from Phase 2/3 if available, otherwise create descriptive fallback
          let detailedReasoning = stockReasoningMap[rec.symbol];

          if (!detailedReasoning) {
            // Create descriptive fallback from available data
            const action = rec.type === 'short' ? 'Short' : 'Long';
            const pathwayDesc = rec.pathway ? ` (${rec.pathway} pathway)` : '';
            const intentDesc = rec.intent ? ` - ${rec.intent}` : '';
            detailedReasoning = `${action} position in ${rec.symbol}${pathwayDesc}${intentDesc}. Entry: $${rec.entryPrice}, Stop: $${rec.stopLoss}, Target: $${rec.takeProfit}. ${rec.reasoning || 'See Phase 4 analysis for full rationale.'}`;
          }

          try {
            const approvalId = await tradeApproval.submitForApproval({
              symbol: rec.symbol,
              action: rec.type === 'short' ? 'sell_short' : 'buy',
              quantity: rec.quantity,
              entryPrice: rec.entryPrice,
              stopLoss: rec.stopLoss,
              takeProfit: rec.takeProfit,
              orderType: 'limit',
              pathway: rec.pathway || null,
              intent: rec.intent || 'momentum',
              reasoning: detailedReasoning
            }, true);  // skipEmail = true for batch

            submittedTrades.push({
              symbol: rec.symbol,
              action: rec.type === 'short' ? 'sell_short' : 'buy',
              quantity: rec.quantity,
              entryPrice: rec.entryPrice,
              stopLoss: rec.stopLoss,
              takeProfit: rec.takeProfit,
              reasoning: rec.reasoning
            });
            approvalIds.push(approvalId);

            console.log(`   ✅ ${rec.symbol} queued for approval`);
          } catch (error) {
            console.error(`   ❌ Failed to submit trade for ${rec.symbol}:`, error.message);
            await email.sendErrorAlert(error, `Trade submission: ${rec.symbol}`);
          }
        }

        // Send single batch email for all trades
        if (submittedTrades.length > 0) {
          console.log(`\n📧 Sending batch approval email for ${submittedTrades.length} trades...`);
          await tradeApproval.sendBatchApprovalEmail(approvalIds, submittedTrades);
          console.log(`✅ Batch approval email sent`);
        }

        console.log('✅ All trades processed');
      } else {
        console.log('ℹ️  No trade recommendations found (holding cash)');
      }
      console.log('');

      // Parse and update watchlist
      console.log('👀 Parsing watchlist updates...');
      const watchlistItems = await this.parseWatchlist(analysis.analysis);

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
   * Extract per-stock reasoning from Phase 2 and Phase 3 analyses
   * Returns a map of symbol -> reasoning text
   */
  extractStockReasoningFromPhases(phase2Text, phase3Text) {
    const reasoningMap = {};

    // Extract from Phase 2 (long analysis)
    const phase2Sections = phase2Text.split(/(?=SYMBOL:\s*[A-Z]{1,5})/gi);
    for (const section of phase2Sections) {
      const symbolMatch = section.match(/SYMBOL:\s*([A-Z]{1,5})/i);
      if (!symbolMatch) continue;

      const symbol = symbolMatch[1].trim();

      // Look for REASONING: field (most explicit)
      let reasoningMatch = section.match(/REASONING:\s*(.+?)(?=\n\n|SYMBOL:|---|\n[A-Z]+:|$)/is);

      if (reasoningMatch) {
        reasoningMap[symbol] = reasoningMatch[1].trim();
      } else {
        // Fallback: Look for text after DECISION: BUY
        const buyMatch = section.match(/DECISION:\s*BUY\s+(.+?)(?=\n\n|SYMBOL:|---|\n[A-Z]+:|$)/is);
        if (buyMatch) {
          // Extract meaningful text, skip field labels
          let reasoning = buyMatch[1]
            .replace(/ENTRY:|STOP:|TARGET:|POSITION_SIZE:|CONVICTION:|SUB-SECTOR:/gi, '')
            .replace(/\$[\d.]+/g, '')
            .replace(/\d+%/g, '')
            .replace(/High|Medium|Low/gi, '')
            .trim();

          // Take first 2-3 sentences (up to 400 chars)
          const sentences = reasoning.match(/[^.!?]+[.!?]+/g);
          if (sentences && sentences.length > 0) {
            reasoning = sentences.slice(0, 3).join(' ').trim();
          }

          if (reasoning.length > 20) {
            reasoningMap[symbol] = reasoning.substring(0, 400);
          }
        }
      }
    }

    // Extract from Phase 3 (short analysis)
    const phase3Sections = phase3Text.split(/(?=SYMBOL:\s*[A-Z]{1,5})/gi);
    for (const section of phase3Sections) {
      const symbolMatch = section.match(/SYMBOL:\s*([A-Z]{1,5})/i);
      if (!symbolMatch) continue;

      const symbol = symbolMatch[1].trim();

      // Look for REASONING: field
      let reasoningMatch = section.match(/REASONING:\s*(.+?)(?=\n\n|SYMBOL:|---|\n[A-Z]+:|$)/is);

      if (reasoningMatch) {
        reasoningMap[symbol] = reasoningMatch[1].trim();
      } else {
        // Fallback: Look for text after DECISION: SHORT
        const shortMatch = section.match(/DECISION:\s*SHORT\s+(.+?)(?=\n\n|SYMBOL:|---|\n[A-Z]+:|$)/is);
        if (shortMatch) {
          let reasoning = shortMatch[1]
            .replace(/ENTRY:|STOP:|TARGET:|POSITION_SIZE:|CONVICTION:|TECHNICAL_CHECKLIST:|SUB-SECTOR:/gi, '')
            .replace(/\$[\d.]+/g, '')
            .replace(/\d+%/g, '')
            .replace(/High|Medium|Low/gi, '')
            .trim();

          // Take first 2-3 sentences
          const sentences = reasoning.match(/[^.!?]+[.!?]+/g);
          if (sentences && sentences.length > 0) {
            reasoning = sentences.slice(0, 3).join(' ').trim();
          }

          if (reasoning.length > 20) {
            reasoningMap[symbol] = reasoning.substring(0, 400);
          }
        }
      }
    }

    return reasoningMap;
  }

  /**
   * Extract long and short candidates from Phase 1 analysis
   */
  extractLongShortCandidates(analysisText) {
    const longCandidates = [];
    const shortCandidates = [];

    // Extract LONG_CANDIDATES section
    const longSection = analysisText.match(/LONG_CANDIDATES:[\s\S]*?(?=SHORT_CANDIDATES:|REASONING:|$)/i);
    if (longSection) {
      const lines = longSection[0].split('\n');
      for (const line of lines) {
        const match = line.match(/\b([A-Z]{1,5})\b/);
        if (match && match[1] !== 'LONG' && match[1] !== 'CANDIDATES') {
          longCandidates.push(match[1]);
        }
      }
    }

    // Extract SHORT_CANDIDATES section
    const shortSection = analysisText.match(/SHORT_CANDIDATES:[\s\S]*?(?=REASONING:|$)/i);
    if (shortSection) {
      const lines = shortSection[0].split('\n');
      for (const line of lines) {
        const match = line.match(/\b([A-Z]{1,5})\b/);
        if (match && match[1] !== 'SHORT' && match[1] !== 'CANDIDATES') {
          shortCandidates.push(match[1]);
        }
      }
    }

    return {
      longs: [...new Set(longCandidates)].slice(0, 20),
      shorts: [...new Set(shortCandidates)].slice(0, 20)
    };
  }

  /**
   * Extract ticker symbols from Phase 1 analysis (legacy - kept for backward compatibility)
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
      const sector = await this.getSector(rec.symbol);
      if (!recsByAssetClass[sector]) {
        recsByAssetClass[sector] = [];
      }
      recsByAssetClass[sector].push(rec);
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
  async parseRecommendations(analysisText) {
    const recommendations = [];

    try {
      // Try JSON parsing first
      const jsonMatch = analysisText.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.trades && Array.isArray(parsed.trades)) {
            console.log('✅ Parsed trades from JSON block');
            return await Promise.all(parsed.trades.map(async t => ({
              type: t.action === 'short' ? 'short' : 'long',
              symbol: t.symbol,
              quantity: t.quantity,
              entryPrice: t.entry_price,
              stopLoss: t.stop_loss,
              takeProfit: t.take_profit,
              assetClass: t.asset_class || await this.getSector(t.symbol),
              intent: t.intent || 'momentum', // Default to momentum if not specified
              reasoning: t.reasoning || ''
            })));
          }
        } catch (jsonError) {
          console.warn('⚠️ JSON block found but failed to parse, falling back to regex');
        }
      }

      // Fallback to regex parsing
      // Find all trade markers first to extract reasoning between them
      const allTradeMatches = [];

      // Parse EXECUTE_BUY (with optional pathway and intent)
      const buyPattern = /EXECUTE_BUY:\s*([A-Z]{1,5})\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)(?:\s*\|\s*([a-zA-Z_]+)\s*\|\s*([a-zA-Z_]+))?/gi;
      let match;
      while ((match = buyPattern.exec(analysisText)) !== null) {
        allTradeMatches.push({
          type: 'long',
          symbol: match[1],
          quantity: parseInt(match[2]),
          entryPrice: parseFloat(match[3]),
          stopLoss: parseFloat(match[4]),
          takeProfit: parseFloat(match[5]),
          pathway: match[6] && match[6] !== 'null' ? match[6] : null,
          intent: match[7] || 'momentum',
          index: match.index,
          endIndex: match.index + match[0].length
        });
      }

      // Parse EXECUTE_SHORT (with optional pathway and intent)
      const shortPattern = /EXECUTE_SHORT:\s*([A-Z]{1,5})\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)(?:\s*\|\s*([a-zA-Z_]+)\s*\|\s*([a-zA-Z_]+))?/gi;
      while ((match = shortPattern.exec(analysisText)) !== null) {
        allTradeMatches.push({
          type: 'short',
          symbol: match[1],
          quantity: parseInt(match[2]),
          entryPrice: parseFloat(match[3]),
          stopLoss: parseFloat(match[4]),
          takeProfit: parseFloat(match[5]),
          pathway: match[6] && match[6] !== 'null' ? match[6] : null,
          intent: match[7] || 'momentum_short',
          index: match.index,
          endIndex: match.index + match[0].length
        });
      }

      // Sort by position in text
      allTradeMatches.sort((a, b) => a.index - b.index);

      console.log(`\n📋 Found ${allTradeMatches.length} EXECUTE commands in Phase 4 output`);
      if (allTradeMatches.length > 0) {
        console.log('   Parsing trades:');
        allTradeMatches.forEach((t, i) => {
          console.log(`   ${i + 1}. ${t.type.toUpperCase()} ${t.symbol} | ${t.quantity} | $${t.entryPrice} | $${t.stopLoss} | $${t.takeProfit} | ${t.pathway || 'null'} | ${t.intent}`);
        });
      }

      // Extract reasoning for each trade (text between current trade and next trade)
      for (let i = 0; i < allTradeMatches.length; i++) {
        const trade = allTradeMatches[i];
        const nextTrade = allTradeMatches[i + 1];

        // Extract text from end of current trade line to start of next trade (or end of text)
        const reasoningStart = trade.endIndex;
        const reasoningEnd = nextTrade ? nextTrade.index : analysisText.length;
        let reasoning = analysisText.substring(reasoningStart, reasoningEnd).trim();

        // Clean up reasoning - remove common separators and extra whitespace
        reasoning = reasoning
          .replace(/^[\s\-\*]+/, '') // Remove leading separators
          .replace(/EXECUTE_(BUY|SHORT):.*$/s, '') // Remove any trailing trade commands
          .trim();

        // Limit reasoning length to avoid bloat
        if (reasoning.length > 1000) {
          reasoning = reasoning.substring(0, 1000) + '...';
        }

        // Validate stop-loss and take-profit
        if (trade.type === 'long') {
          if (trade.stopLoss >= trade.entryPrice) {
            console.warn(`   ❌ SKIPPED ${trade.symbol}: Invalid stop-loss $${trade.stopLoss} (must be below entry $${trade.entryPrice})`);
            continue;
          }
          if (trade.takeProfit <= trade.entryPrice) {
            console.warn(`   ❌ SKIPPED ${trade.symbol}: Invalid take-profit $${trade.takeProfit} (must be above entry $${trade.entryPrice})`);
            continue;
          }
        } else {
          if (trade.stopLoss <= trade.entryPrice) {
            console.warn(`   ❌ SKIPPED ${trade.symbol}: Invalid stop-loss $${trade.stopLoss} (must be ABOVE entry $${trade.entryPrice} for shorts)`);
            continue;
          }
          if (trade.takeProfit >= trade.entryPrice) {
            console.warn(`   ❌ SKIPPED ${trade.symbol}: Invalid take-profit $${trade.takeProfit} (must be BELOW entry $${trade.entryPrice} for shorts)`);
            continue;
          }
        }

        console.log(`   ✅ VALIDATED ${trade.symbol}: ${trade.type.toUpperCase()} passed all checks`);

        // Get sector for symbol
        const sector = await this.getSector(trade.symbol);

        recommendations.push({
          type: trade.type,
          symbol: trade.symbol,
          quantity: trade.quantity,
          entryPrice: trade.entryPrice,
          stopLoss: trade.stopLoss,
          takeProfit: trade.takeProfit,
          assetClass: sector,
          pathway: trade.pathway || null,
          intent: trade.intent || (trade.type === 'long' ? 'momentum' : 'momentum_short'),
          reasoning: reasoning || `${trade.type === 'long' ? 'Long' : 'Short'} position in ${trade.symbol}`
        });
      }

      if (recommendations.length === 0) {
        console.log('\nℹ️ No EXECUTE_BUY or EXECUTE_SHORT commands found in analysis');
        console.log('   Expected format: EXECUTE_BUY: SYMBOL | QUANTITY | ENTRY | STOP | TARGET');
        console.log('   Or: EXECUTE_SHORT: SYMBOL | QUANTITY | ENTRY | STOP | TARGET');
      } else {
        console.log(`\n✅ Successfully parsed ${recommendations.length} trades from ${allTradeMatches.length} EXECUTE commands`);
        if (recommendations.length < allTradeMatches.length) {
          console.log(`   ⚠️ ${allTradeMatches.length - recommendations.length} trades were skipped due to validation failures (see warnings above)`);
        }
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
  async parseWatchlist(analysisText) {
    const watchlistItems = [];

    try {
      const watchlistPattern = /WATCHLIST_ADD:\s*([A-Z]{1,5})\s*\|\s*([^|]+)\|\s*\$?([\d.]+)\s*\|\s*\$?([\d.]+)\s*\|\s*\$?([\d.]+)\s*\|\s*([^|]+)\|\s*([^|\n]+)/gi;

      let match;
      while ((match = watchlistPattern.exec(analysisText)) !== null) {
        const symbol = match[1].trim();
        watchlistItems.push({
          symbol: symbol,
          asset_class: await this.getSector(symbol),
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

      // Calculate portfolio risk metrics
      const riskMetrics = await portfolioRiskMetrics.calculateRiskMetrics(portfolio.totalValue);

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
        riskMetrics, // Add risk metrics
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
      const sector = await this.getSector(symbol);

      const trade = {
        action,
        symbol,
        quantity,
        price,
        assetClass: sector
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
            original_intent: options.intent || 'momentum',
            current_intent: options.intent || 'momentum'
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
            original_intent: options.intent || 'momentum',
            current_intent: options.intent || 'momentum'
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
