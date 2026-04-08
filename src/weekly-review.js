import * as db from './db.js';
import tradier from './tradier.js';
import claude from './claude.js';
import tavily from './tavily.js';
import email from './email.js';
import performanceAnalyzer from './performance-analyzer.js';
import trendLearning from './trend-learning.js';
import sectorRotation from './sector-rotation.js';
import { getWeeklyEarningsReport } from './earnings-analysis.js';

/**
 * Weekly Review Module
 * Deep review of all positions every Sunday with Claude Opus
 */

/**
 * Audit watchlist for stale/missed entries
 */
async function auditWatchlist() {
  try {
    const watchlist = await db.getWatchlist();
    const stale = [];
    const missed = [];

    for (const item of watchlist) {
      const quote = await tradier.getQuote(item.symbol);
      const daysOnWatchlist = Math.floor((Date.now() - new Date(item.added_date)) / 86400000);

      // Missed opportunity: price ran past target exit without buying
      if (quote.last > item.target_exit_price) {
        missed.push({ ...item, currentPrice: quote.last });
      }
      // Stale: on watchlist >30 days and price 10%+ above target entry
      else if (daysOnWatchlist > 30 && quote.last > item.target_entry_price * 1.10) {
        stale.push({ ...item, daysOnWatchlist, currentPrice: quote.last });
      }
    }

    // Archive stale/missed entries instead of deleting
    for (const item of stale) {
      await db.query(
        `UPDATE watchlist
         SET status = 'archived_stale',
             last_reviewed = NOW(),
             why_not_buying_now = $1
         WHERE symbol = $2`,
        [`Archived: On watchlist ${item.daysOnWatchlist} days, price moved >10% above target entry`, item.symbol]
      );
      console.log(`   📦 Archived stale entry: ${item.symbol}`);
    }

    for (const item of missed) {
      await db.query(
        `UPDATE watchlist
         SET status = 'missed_opportunity',
             last_reviewed = NOW(),
             why_not_buying_now = $1
         WHERE symbol = $2`,
        [`Missed: Price $${item.currentPrice.toFixed(2)} exceeded target exit $${item.target_exit_price} without entry`, item.symbol]
      );
      console.log(`   📦 Archived missed opportunity: ${item.symbol} (ran to $${item.currentPrice.toFixed(2)})`);
    }

    return {
      stale,
      missed,
      remaining: watchlist.length - stale.length - missed.length
    };
  } catch (error) {
    console.error('Error auditing watchlist:', error);
    return { stale: [], missed: [], remaining: 0 };
  }
}

/**
 * Review a single position with Claude Opus
 */
export async function reviewPosition(symbol, lots) {
  try {
    console.log(`\n🔍 Reviewing ${symbol}...`);

    // Get current price
    const quote = await tradier.getQuote(symbol);
    const currentPrice = quote.last;

    // Calculate aggregate metrics
    const totalQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
    const totalCost = lots.reduce((sum, lot) => sum + (lot.quantity * lot.cost_basis), 0);
    const avgCostBasis = totalCost / totalQuantity;
    const gainPercent = ((currentPrice - avgCostBasis) / avgCostBasis * 100).toFixed(2);
    const totalValue = totalQuantity * currentPrice;
    const totalGain = totalValue - totalCost;

    // Get entry date (oldest lot)
    const oldestLot = lots.reduce((oldest, lot) =>
      new Date(lot.entry_date) < new Date(oldest.entry_date) ? lot : oldest
    );
    const daysHeld = oldestLot.days_held;

    // Get thesis
    const thesis = lots[0]?.thesis || 'No thesis available';

    // Get next earnings
    const earning = await db.getNextEarning(symbol);
    const earningsInfo = earning
      ? `${earning.earnings_date} (${earning.earnings_time})`
      : 'No upcoming earnings';

    // Get recent news
    const news = await tavily.searchNews(`${symbol} stock news`, 3);
    const newsText = tavily.formatResults(news);

    // Build lot details
    let lotDetails = '';
    lots.forEach((lot, i) => {
      const lotGain = ((currentPrice - lot.cost_basis) / lot.cost_basis * 100).toFixed(2);
      lotDetails += `\nLot ${i + 1} (${lot.lot_type}):
  - Quantity: ${lot.quantity} shares
  - Entry: $${lot.cost_basis.toFixed(2)} on ${lot.entry_date}
  - Days held: ${lot.days_held}
  - Days to long-term: ${lot.days_to_long_term || 'N/A'}
  - Gain: ${lotGain}%
  - Stop-loss: $${lot.stop_loss?.toFixed(2) || 'None'}
  - Take-profit: $${lot.take_profit?.toFixed(2) || 'None'}
  - Trim level: ${lot.trim_level}
  - Trailing stop: ${lot.trailing_stop_active ? 'Active' : 'Inactive'}`;
    });

    // Ask Claude Opus for deep review with enhanced forward-looking questions
    const prompt = `
You are conducting a WEEKLY STRATEGIC REVIEW of ${symbol}.

POSITION SUMMARY:
- Entry: $${avgCostBasis.toFixed(2)} (${daysHeld} days ago)
- Current: $${currentPrice.toFixed(2)}
- Gain: ${gainPercent}%
- Total value: $${totalValue.toFixed(2)}
- Total gain: $${totalGain.toFixed(2)}
- Investment thesis: ${thesis}
- Next earnings: ${earningsInfo}

LOT DETAILS:
${lotDetails}

RECENT NEWS:
${newsText}

QUESTIONS FOR WEEKLY STRATEGIC REVIEW:
1. Is this position still the best use of this capital vs all available alternatives in the current market?
2. Has anything changed in the thesis since entry that requires updating stop/profit levels or position size?
3. Are there catalysts in the next 4 weeks (earnings, product launches, regulatory decisions) that change the risk profile?
4. Should any lots be reclassified (e.g., swing → long-term or vice versa) based on how the position has evolved?
5. What is the probability-weighted expected return for holding vs exiting now? Consider both upside scenarios and downside risks.
6. Is the sector this represents still a priority for the portfolio going into next week, or should capital be rotated?

Provide specific recommendations with exact price levels.
Format your response as:

THESIS: [Valid/Broken/Weakening] - [explanation with forward-looking view]
STOP-LOSS: [Keep current/Adjust to $X] - [reasoning based on volatility and upcoming catalysts]
TAKE-PROFIT: [Keep current/Adjust to $X/Remove for trailing stop] - [reasoning]
POSITION ACTION: [Hold/Trim/Add/Exit] - [specific recommendation]
FORWARD CATALYSTS: [List any upcoming events in next 4 weeks that matter]
OTHER: [Any other strategic actions]
`;

    const analysis = await claude.analyze(prompt, { model: 'opus' });

    console.log(`\n🧠 Opus Review for ${symbol}:`);
    console.log(analysis.analysis);
    // Note: Thinking block is stored but not displayed

    // Parse recommendations
    const recommendations = parseOpusRecommendations(analysis.analysis, lots, currentPrice);

    return {
      symbol,
      currentPrice,
      gainPercent,
      daysHeld,
      lots,
      analysis: analysis.analysis,
      recommendations
    };

  } catch (error) {
    console.error(`Error reviewing ${symbol}:`, error);
    return {
      symbol,
      error: error.message,
      recommendations: { keepCurrent: true }
    };
  }
}

/**
 * Parse Opus recommendations into actionable items
 */
function parseOpusRecommendations(analysisText, lots, currentPrice) {
  const recommendations = {
    thesisValid: true,
    adjustStopLoss: false,
    newStopLoss: null,
    adjustTakeProfit: false,
    newTakeProfit: null,
    trim: false,
    trimDetails: null,
    otherActions: null
  };

  // Parse thesis
  if (analysisText.includes('THESIS: Broken') || analysisText.includes('THESIS: Weakening')) {
    recommendations.thesisValid = false;
  }

  // Parse stop-loss adjustment
  const stopMatch = analysisText.match(/STOP-LOSS:.*?\$(\d+\.?\d*)/i);
  if (stopMatch && analysisText.includes('Adjust to')) {
    recommendations.adjustStopLoss = true;
    recommendations.newStopLoss = parseFloat(stopMatch[1]);
  }

  // Parse take-profit adjustment
  const tpMatch = analysisText.match(/TAKE-PROFIT:.*?\$(\d+\.?\d*)/i);
  if (tpMatch && analysisText.includes('Adjust to')) {
    recommendations.adjustTakeProfit = true;
    recommendations.newTakeProfit = parseFloat(tpMatch[1]);
  }

  // Parse position action (FIXED: was looking for "TRIM: Yes", now looks for "POSITION ACTION: Trim/Exit")
  if (analysisText.includes('POSITION ACTION: Trim') || analysisText.includes('POSITION ACTION: Exit')) {
    recommendations.trim = true;
    // Try to extract trim details
    const trimMatch = analysisText.match(/Lot (\d+).*?(\d+)%/i);
    if (trimMatch) {
      recommendations.trimDetails = {
        lotIndex: parseInt(trimMatch[1]) - 1,
        percent: parseInt(trimMatch[2])
      };
    }
  }

  // Parse other actions
  const otherMatch = analysisText.match(/OTHER: (.+?)(?:\n|$)/i);
  if (otherMatch) {
    recommendations.otherActions = otherMatch[1].trim();
  }

  return recommendations;
}

/**
 * Execute recommendations from Opus review
 */
export async function executeReviewRecommendations(review) {
  try {
    const { symbol, lots, recommendations, currentPrice } = review;

    console.log(`\n💼 Executing recommendations for ${symbol}...`);

    // If thesis broken, consider selling
    if (!recommendations.thesisValid) {
      console.log(`⚠️ Thesis broken for ${symbol} - flagging for manual review`);
      await email.sendEmail(
        `⚠️ Thesis Broken: ${symbol}`,
        `
          <h2>Weekly Review Alert</h2>
          <p><strong>Symbol:</strong> ${symbol}</p>
          <p><strong>Issue:</strong> Investment thesis is broken or weakening</p>
          <p><strong>Recommendation:</strong> Review position and consider selling</p>
          <h3>Opus Analysis:</h3>
          <pre>${review.analysis}</pre>
        `
      );
    }

    // Adjust stop-loss
    if (recommendations.adjustStopLoss && recommendations.newStopLoss) {
      console.log(`🔒 Adjusting stop-loss to $${recommendations.newStopLoss.toFixed(2)}`);

      for (const lot of lots) {
        if (lot.quantity > 0) {
          await db.updatePositionLot(lot.id, {
            stop_loss: recommendations.newStopLoss
          });

          // Cancel old OCO and place new one
          if (lot.oco_order_id) {
            try {
              await tradier.cancelOrder(lot.oco_order_id);
              await new Promise(resolve => setTimeout(resolve, 1000));

              const takeProfit = recommendations.adjustTakeProfit
                ? recommendations.newTakeProfit
                : lot.take_profit;

              if (takeProfit) {
                const newOCO = await tradier.placeOCOOrder(
                  symbol,
                  lot.quantity,
                  recommendations.newStopLoss,
                  takeProfit
                );
                await db.updatePositionLot(lot.id, { oco_order_id: newOCO.id });
              } else {
                const stopOrder = await tradier.placeStopOrder(
                  symbol,
                  'sell',
                  lot.quantity,
                  recommendations.newStopLoss
                );
                await db.updatePositionLot(lot.id, { oco_order_id: stopOrder.id });
              }

              console.log(`✅ Updated OCO for lot ${lot.id}`);
            } catch (error) {
              console.error(`⚠️ Failed to update OCO for lot ${lot.id}:`, error.message);
            }
          }

          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    // Adjust take-profit
    if (recommendations.adjustTakeProfit && recommendations.newTakeProfit && !recommendations.adjustStopLoss) {
      console.log(`🎯 Adjusting take-profit to $${recommendations.newTakeProfit.toFixed(2)}`);

      for (const lot of lots) {
        if (lot.quantity > 0 && !lot.trailing_stop_active) {
          await db.updatePositionLot(lot.id, {
            take_profit: recommendations.newTakeProfit
          });

          // Update OCO order
          if (lot.oco_order_id && lot.stop_loss) {
            try {
              await tradier.cancelOrder(lot.oco_order_id);
              await new Promise(resolve => setTimeout(resolve, 1000));

              const newOCO = await tradier.placeOCOOrder(
                symbol,
                lot.quantity,
                lot.stop_loss,
                recommendations.newTakeProfit
              );
              await db.updatePositionLot(lot.id, { oco_order_id: newOCO.id });
              console.log(`✅ Updated OCO for lot ${lot.id}`);
            } catch (error) {
              console.error(`⚠️ Failed to update OCO for lot ${lot.id}:`, error.message);
            }
          }

          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    console.log(`✅ Recommendations executed for ${symbol}`);
    return { success: true };

  } catch (error) {
    console.error(`Error executing recommendations for ${review.symbol}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Run weekly synthesis with extended thinking
 */
async function runWeeklySynthesis(reviews, weeklyPerf, watchlistAudit, sectorRanking) {
  try {
    console.log('\n🧠 Running weekly strategic synthesis with Opus...');

    const prompt = `
You are conducting a WEEKLY STRATEGIC REVIEW of a $100k portfolio.

WEEK PERFORMANCE:
${JSON.stringify(weeklyPerf, null, 2)}

POSITION REVIEWS THIS WEEK:
${reviews.map(r => `${r.symbol}: ${r.gainPercent}% gain (${r.daysHeld} days held)\n${r.analysis}`).join('\n---\n')}

WATCHLIST AUDIT:
- Stale entries removed: ${watchlistAudit.stale.length > 0 ? watchlistAudit.stale.map(s => s.symbol).join(', ') : 'None'}
- Missed opportunities: ${watchlistAudit.missed.length > 0 ? watchlistAudit.missed.map(m => `${m.symbol} (ran to $${m.currentPrice} past exit $${m.target_exit_price})`).join(', ') : 'None'}
- Remaining watchlist entries: ${watchlistAudit.remaining}

QUESTIONS FOR STRATEGIC REVIEW:
1. What is the portfolio's overall trajectory this week vs market? Are we beating, matching, or lagging the S&P 500?
2. Which positions are underperforming their thesis and should be considered for exit?
3. Are there any sector over/underweights that need correcting next week?
4. What are the 2-3 highest-conviction opportunities for next week based on current market conditions?
5. Should any parameters change (stop-loss %, position sizing, cash target) based on what we learned this week?
6. What worked well this week that we should do more of?
7. What didn't work — and what should we stop doing or adjust?

Provide strategic recommendations for the coming week with specific actionable items.
`;

    const synthesis = await claude.analyze(prompt, { model: 'opus' });

    console.log('\n📊 Weekly Strategic Synthesis:');
    console.log(synthesis.analysis);

    return synthesis;
  } catch (error) {
    console.error('Error running weekly synthesis:', error);
    return { analysis: 'Synthesis failed: ' + error.message };
  }
}

/**
 * Run full weekly review (Sunday 9 PM)
 */
export async function runWeeklyReview() {
  try {
    console.log('\n═══════════════════════════════════════');
    console.log('📅 WEEKLY PORTFOLIO REVIEW');
    console.log('═══════════════════════════════════════\n');

    // Get all positions
    const allLots = await db.getAllPositionLots();
    const symbols = [...new Set(allLots.map(lot => lot.symbol))];

    if (symbols.length === 0) {
      console.log('✅ No positions to review');
      return { reviewed: 0 };
    }

    console.log(`Found ${symbols.length} positions to review\n`);

    // Run performance analysis
    console.log('📊 Analyzing weekly performance...');
    const weeklyPerf = await performanceAnalyzer.analyzePerformance();

    // Run sector rotation analysis
    console.log('📊 Running sector rotation analysis...');
    const sectorRanking = await sectorRotation.analyzeSectorStrength();

    // Save to database for the week's daily analyses to use
    if (sectorRanking && sectorRanking.length > 0) {
      await db.query(
        `INSERT INTO performance_metrics (metric_name, metric_value, period, calculated_at)
         VALUES ('sector_rotation_cache', $1, 'weekly', NOW())
         ON CONFLICT (metric_name, period) DO UPDATE
         SET metric_value = $1, calculated_at = NOW()`,
        [JSON.stringify(sectorRanking)]
      ).catch(() => {});
      console.log(`✅ Sector rotation cached for daily use\n`);
    }

    // Audit watchlist
    console.log('🔍 Auditing watchlist...');
    const watchlistAudit = await auditWatchlist();
    console.log(`   Archived ${watchlistAudit.stale.length} stale entries`);
    console.log(`   Archived ${watchlistAudit.missed.length} missed opportunities`);
    console.log(`   ${watchlistAudit.remaining} entries remaining\n`);

    const reviews = [];

    // Review each position (FIXED: removed quantity > 0 filter to include shorts)
    for (const symbol of symbols) {
      const symbolLots = allLots.filter(lot => lot.symbol === symbol);

      if (symbolLots.length > 0) {
        const review = await reviewPosition(symbol, symbolLots);
        reviews.push(review);

        // Execute recommendations
        if (!review.error) {
          await executeReviewRecommendations(review);
        }

        // Wait 5 seconds between reviews (Opus is slow)
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    // Run weekly synthesis with extended thinking
    const synthesis = await runWeeklySynthesis(reviews, weeklyPerf, watchlistAudit, sectorRanking);

    // Run weekly trend learning (strategic patterns)
    console.log('🧠 Running weekly trend learning...');
    const weeklyLearning = await trendLearning.runWeeklyTrendLearning(reviews, weeklyPerf);

    // Get earnings report
    const earningsReport = await getWeeklyEarningsReport();

    // Check portfolio balance
    const portfolio = await checkPortfolioBalance();

    // Send weekly summary email
    await sendWeeklySummaryEmail(reviews, earningsReport, portfolio, synthesis, weeklyPerf, watchlistAudit);

    console.log(`\n✅ Weekly review complete: ${reviews.length} positions reviewed`);
    return { reviewed: reviews.length, reviews, synthesis };

  } catch (error) {
    console.error('Error running weekly review:', error);
    await email.sendErrorAlert(error, 'Weekly review failed');
    throw error;
  }
}

/**
 * Check portfolio balance and rebalancing needs
 */
async function checkPortfolioBalance() {
  try {
    const positions = await db.getPositions();
    const balances = await tradier.getBalances();

    const totalValue = parseFloat(balances.total_equity) || 100000;
    const cash = parseFloat(balances.total_cash) || 100000;
    const invested = totalValue - cash;

    const cashPercent = (cash / totalValue * 100).toFixed(2);

    const issues = [];

    // Check if any position > 15%
    for (const pos of positions) {
      const posValue = pos.quantity * pos.current_price;
      const posPercent = (posValue / totalValue * 100).toFixed(2);

      if (posPercent > 15) {
        issues.push(`${pos.symbol} is ${posPercent}% of portfolio (max: 15%)`);
      }
    }

    // Check cash reserve
    if (cashPercent < 5) {
      issues.push(`Cash reserve is ${cashPercent}% (target: 10%)`);
    } else if (cashPercent > 15) {
      issues.push(`Cash reserve is ${cashPercent}% (target: 10%) - consider deploying`);
    }

    return {
      totalValue,
      cash,
      invested,
      cashPercent,
      positionCount: positions.length,
      issues
    };

  } catch (error) {
    console.error('Error checking portfolio balance:', error);
    return { error: error.message };
  }
}

/**
 * Send weekly summary email
 */
async function sendWeeklySummaryEmail(reviews, earningsReport, portfolio, synthesis, weeklyPerf, watchlistAudit) {
  try {
    let html = `
      <h2>📅 Weekly Portfolio Review</h2>
      <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>

      <h3>📊 Weekly Performance</h3>
      ${weeklyPerf ? `
        <p><strong>Total Trades:</strong> ${weeklyPerf.totalTrades}</p>
        <p><strong>Winners:</strong> ${weeklyPerf.winners} | <strong>Losers:</strong> ${weeklyPerf.losers}</p>
        <p><strong>Win Rate:</strong> ${weeklyPerf.winRate}</p>
        <p><strong>Avg Win:</strong> ${weeklyPerf.avgWin} | <strong>Avg Loss:</strong> ${weeklyPerf.avgLoss}</p>
        <p><strong>Profit Factor:</strong> ${weeklyPerf.profitFactor}</p>
      ` : '<p>No performance data available</p>'}

      <h3>🔍 Watchlist Audit</h3>
      <p><strong>Stale entries removed:</strong> ${watchlistAudit.stale.length}</p>
      <p><strong>Missed opportunities:</strong> ${watchlistAudit.missed.length}</p>
      <p><strong>Active watchlist entries:</strong> ${watchlistAudit.remaining}</p>

      <h3>Portfolio Summary</h3>
      <p><strong>Total Value:</strong> $${portfolio.totalValue?.toLocaleString() || 'N/A'}</p>
      <p><strong>Cash:</strong> $${portfolio.cash?.toLocaleString() || 'N/A'} (${portfolio.cashPercent}%)</p>
      <p><strong>Positions:</strong> ${portfolio.positionCount}</p>
    `;

    if (portfolio.issues && portfolio.issues.length > 0) {
      html += `
        <h3>⚠️ Portfolio Issues</h3>
        <ul>
          ${portfolio.issues.map(issue => `<li>${issue}</li>`).join('')}
        </ul>
      `;
    }

    html += `
      <h3>🧠 Weekly Strategic Synthesis</h3>
      <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px; white-space: pre-wrap;">${synthesis.analysis}</pre>

      <h3>Position Reviews</h3>
    `;

    for (const review of reviews) {
      if (review.error) {
        html += `
          <h4>${review.symbol} - Error</h4>
          <p>Error: ${review.error}</p>
        `;
      } else {
        html += `
          <h4>${review.symbol} - ${review.gainPercent}% (${review.daysHeld} days)</h4>
          <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px; white-space: pre-wrap;">${review.analysis}</pre>
        `;
      }
    }

    html += `
      <h3>📅 Upcoming Earnings</h3>
      <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px;">${earningsReport}</pre>
    `;

    await email.sendEmail('📅 Weekly Portfolio Review', html);

  } catch (error) {
    console.error('Error sending weekly summary email:', error);
  }
}

export default {
  reviewPosition,
  executeReviewRecommendations,
  runWeeklyReview
};
