import * as db from './db.js';
import tradier from './tradier.js';
import claude from './claude.js';
import tavily from './tavily.js';
import email from './email.js';
import { getWeeklyEarningsReport } from './earnings-analysis.js';

/**
 * Weekly Review Module
 * Deep review of all positions every Sunday with Claude Opus
 */

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

    // Ask Claude Opus for deep review
    const prompt = `
You are conducting a weekly review of ${symbol}.

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

QUESTIONS:
1. Is the thesis still valid? Any concerns?
2. Should we adjust stop-loss levels? If yes, what should they be?
3. Should we adjust take-profit levels? If yes, what should they be?
4. Should we trim any lots now? If yes, which ones and how much?
5. Any other actions needed (e.g., add to position, close completely)?

Provide specific recommendations with exact price levels.
Format your response as:

THESIS: [Valid/Broken/Weakening] - [explanation]
STOP-LOSS: [Keep current/Adjust to $X] - [reasoning]
TAKE-PROFIT: [Keep current/Adjust to $X] - [reasoning]
TRIM: [No/Yes - Lot X, Y% at $Z] - [reasoning]
OTHER: [Any other actions]
`;

    const analysis = await claude.analyze(prompt, {
      model: 'opus',
      maxTokens: 1000
    });

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

  // Parse trim recommendation
  if (analysisText.includes('TRIM: Yes')) {
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

    const reviews = [];

    // Review each position
    for (const symbol of symbols) {
      const symbolLots = allLots.filter(lot => lot.symbol === symbol && lot.quantity > 0);

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

    // Get earnings report
    const earningsReport = await getWeeklyEarningsReport();

    // Check portfolio balance
    const portfolio = await checkPortfolioBalance();

    // Send weekly summary email
    await sendWeeklySummaryEmail(reviews, earningsReport, portfolio);

    console.log(`\n✅ Weekly review complete: ${reviews.length} positions reviewed`);
    return { reviewed: reviews.length, reviews };

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
async function sendWeeklySummaryEmail(reviews, earningsReport, portfolio) {
  try {
    let html = `
      <h2>📅 Weekly Portfolio Review</h2>
      <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>

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

    html += `<h3>Position Reviews</h3>`;

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
