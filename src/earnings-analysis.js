import * as db from './db.js';
import tradier from './tradier.js';
import claude from './claude.js';
import tavily from './tavily.js';
import email from './email.js';

/**
 * Earnings Day Analysis Module
 * Handles special analysis and decisions around earnings announcements
 */

/**
 * Get positions with earnings today or tomorrow
 */
export async function getPositionsWithUpcomingEarnings(daysAhead = 1) {
  try {
    const lots = await db.getAllPositionLots();
    const symbols = [...new Set(lots.map(lot => lot.symbol))];

    const positionsWithEarnings = [];

    for (const symbol of symbols) {
      const earning = await db.getNextEarning(symbol);

      if (earning) {
        const earningsDate = new Date(earning.earnings_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const daysUntil = Math.floor((earningsDate - today) / (1000 * 60 * 60 * 24));

        if (daysUntil >= 0 && daysUntil <= daysAhead) {
          const symbolLots = lots.filter(lot => lot.symbol === symbol && lot.quantity > 0);
          positionsWithEarnings.push({
            symbol,
            earningsDate: earning.earnings_date,
            earningsTime: earning.earnings_time,
            daysUntil,
            lots: symbolLots
          });
        }
      }
    }

    return positionsWithEarnings;

  } catch (error) {
    console.error('Error getting positions with upcoming earnings:', error);
    return [];
  }
}

/**
 * Analyze position before earnings
 */
export async function analyzeBeforeEarnings(position) {
  try {
    console.log(`\n📊 Analyzing ${position.symbol} before earnings...`);
    console.log(`   Earnings: ${position.earningsDate} (${position.earningsTime})`);
    console.log(`   Days until: ${position.daysUntil}`);

    // Get latest news
    const news = await tavily.searchNews(`${position.symbol} earnings preview`, 3);
    const newsText = tavily.formatResults(news);

    // Get current price
    const quote = await tradier.getQuote(position.symbol);
    const currentPrice = quote.last;

    // Calculate position details
    const totalQuantity = position.lots.reduce((sum, lot) => sum + lot.quantity, 0);
    const avgCostBasis = position.lots.reduce((sum, lot) => sum + (lot.quantity * lot.cost_basis), 0) / totalQuantity;
    const gainPercent = ((currentPrice - avgCostBasis) / avgCostBasis * 100).toFixed(2);

    // Get thesis from first lot
    const thesis = position.lots[0]?.thesis || 'No thesis available';

    // Ask Claude Opus for analysis
    const prompt = `
You are analyzing ${position.symbol} which has earnings ${position.earningsTime === 'bmo' ? 'BEFORE market open' : 'AFTER market close'} on ${position.earningsDate}.

POSITION DETAILS:
- Entry: $${avgCostBasis.toFixed(2)}
- Current: $${currentPrice.toFixed(2)}
- Gain: ${gainPercent}%
- Quantity: ${totalQuantity} shares
- Investment thesis: ${thesis}

RECENT NEWS:
${newsText}

QUESTION: Should we hold through earnings, trim 50%, or sell completely?

Consider:
1. Is the thesis still valid?
2. What's the earnings risk vs reward?
3. How much of the gain should we protect?
4. Is the stock overextended or has room to run?

Provide a clear recommendation: HOLD, TRIM_50, or SELL
Include your reasoning in 2-3 sentences.
`;

    const analysis = await claude.analyze(prompt, {
      model: 'opus',
      maxTokens: 500
    });

    console.log(`\n🧠 Opus Analysis:`);
    console.log(analysis.analysis);

    // Parse recommendation
    let recommendation = 'HOLD';
    if (analysis.analysis.includes('TRIM_50') || analysis.analysis.includes('trim 50%')) {
      recommendation = 'TRIM_50';
    } else if (analysis.analysis.includes('SELL')) {
      recommendation = 'SELL';
    }

    return {
      symbol: position.symbol,
      recommendation,
      reasoning: analysis.analysis,
      currentPrice,
      gainPercent,
      totalQuantity,
      earningsDate: position.earningsDate,
      earningsTime: position.earningsTime
    };

  } catch (error) {
    console.error(`Error analyzing ${position.symbol} before earnings:`, error);
    return {
      symbol: position.symbol,
      recommendation: 'HOLD',
      reasoning: 'Error in analysis - defaulting to HOLD',
      error: error.message
    };
  }
}

/**
 * Execute earnings day decision
 */
export async function executeEarningsDecision(analysis) {
  try {
    console.log(`\n💼 Executing earnings decision for ${analysis.symbol}: ${analysis.recommendation}`);

    if (analysis.recommendation === 'HOLD') {
      console.log('✅ Holding through earnings');

      // Send notification
      await email.sendEmail(
        `📊 Earnings Decision: HOLD ${analysis.symbol}`,
        `
          <h2>Holding Through Earnings</h2>
          <p><strong>Symbol:</strong> ${analysis.symbol}</p>
          <p><strong>Earnings:</strong> ${analysis.earningsDate} (${analysis.earningsTime})</p>
          <p><strong>Current Price:</strong> $${analysis.currentPrice.toFixed(2)}</p>
          <p><strong>Gain:</strong> ${analysis.gainPercent}%</p>
          <h3>Reasoning:</h3>
          <p>${analysis.reasoning}</p>
        `
      );

      return { success: true, action: 'HOLD' };
    }

    if (analysis.recommendation === 'TRIM_50') {
      console.log('✂️ Trimming 50% before earnings');

      const lots = await db.getPositionLots(analysis.symbol);
      const trimQuantity = Math.floor(analysis.totalQuantity * 0.5);

      // Sell 50%
      const order = await tradier.placeOrder(analysis.symbol, 'sell', trimQuantity, 'market');

      if (order.status === 'ok' || order.status === 'filled') {
        console.log(`✅ Trim order placed: ${order.id}`);

        // Log trade
        await db.logTrade({
          symbol: analysis.symbol,
          action: 'sell',
          quantity: trimQuantity,
          price: analysis.currentPrice,
          orderId: order.id,
          status: order.status,
          reasoning: `Earnings trim: ${analysis.reasoning}`
        });

        // Update lots (trim proportionally)
        for (const lot of lots) {
          if (lot.quantity > 0) {
            const lotTrimQty = Math.floor(lot.quantity * 0.5);
            await db.updatePositionLot(lot.id, {
              quantity: lot.quantity - lotTrimQty
            });
          }
        }

        // Send notification
        await email.sendTradeConfirmation({
          action: 'sell',
          symbol: analysis.symbol,
          quantity: trimQuantity,
          price: analysis.currentPrice,
          stopLoss: null,
          takeProfit: null,
          reasoning: `Earnings trim (50%): ${analysis.reasoning}`
        });

        return { success: true, action: 'TRIM_50', order };
      }
    }

    if (analysis.recommendation === 'SELL') {
      console.log('🔴 Selling completely before earnings');

      // Sell all
      const order = await tradier.placeOrder(analysis.symbol, 'sell', analysis.totalQuantity, 'market');

      if (order.status === 'ok' || order.status === 'filled') {
        console.log(`✅ Sell order placed: ${order.id}`);

        // Log trade
        await db.logTrade({
          symbol: analysis.symbol,
          action: 'sell',
          quantity: analysis.totalQuantity,
          price: analysis.currentPrice,
          orderId: order.id,
          status: order.status,
          reasoning: `Earnings sell: ${analysis.reasoning}`
        });

        // Delete all lots
        const lots = await db.getPositionLots(analysis.symbol);
        for (const lot of lots) {
          await db.deletePositionLot(lot.id);
        }

        // Delete aggregate position
        await db.deletePosition(analysis.symbol);

        // Send notification
        await email.sendTradeConfirmation({
          action: 'sell',
          symbol: analysis.symbol,
          quantity: analysis.totalQuantity,
          price: analysis.currentPrice,
          stopLoss: null,
          takeProfit: null,
          reasoning: `Earnings sell (100%): ${analysis.reasoning}`
        });

        return { success: true, action: 'SELL', order };
      }
    }

    return { success: false, error: 'Unknown recommendation' };

  } catch (error) {
    console.error('Error executing earnings decision:', error);
    await email.sendErrorAlert(error, `Earnings decision execution failed for ${analysis.symbol}`);
    return { success: false, error: error.message };
  }
}

/**
 * Run earnings day analysis (called during daily analysis)
 */
export async function runEarningsDayAnalysis(daysAhead = 5) {
  try {
    console.log(`\n📊 Checking for earnings in next ${daysAhead} days...`);

    // Check for earnings in specified days ahead
    const positions = await getPositionsWithUpcomingEarnings(daysAhead);

    if (positions.length === 0) {
      console.log(`✅ No positions with earnings in next ${daysAhead} days`);
      return { analyzed: 0, decisions: [] };
    }

    console.log(`\n⚠️ Found ${positions.length} positions with upcoming earnings:`);
    positions.forEach(pos => {
      console.log(`   • ${pos.symbol}: ${pos.earningsDate} (${pos.earningsTime}) - ${pos.daysUntil} days away`);
    });

    const decisions = [];

    for (const position of positions) {
      // Only analyze if earnings are tomorrow (give 1 day notice)
      if (position.daysUntil === 1) {
        const analysis = await analyzeBeforeEarnings(position);
        decisions.push(analysis);

        // If recommendation is not HOLD, execute it
        if (analysis.recommendation !== 'HOLD') {
          await executeEarningsDecision(analysis);
        }

        // Wait 3 seconds between analyses
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else if (position.daysUntil === 0) {
        // Earnings today - just notify
        console.log(`   ⚠️ ${position.symbol} has earnings TODAY - monitoring closely`);
      }
    }

    console.log(`\n✅ Earnings analysis complete: ${decisions.length} decisions made`);
    return { analyzed: decisions.length, decisions };

  } catch (error) {
    console.error('Error running earnings day analysis:', error);
    throw error;
  }
}

/**
 * Get weekly earnings report (for Sunday review)
 */
export async function getWeeklyEarningsReport() {
  try {
    const positions = await getPositionsWithUpcomingEarnings(7);

    if (positions.length === 0) {
      return 'No positions with earnings in the next 7 days.';
    }

    let report = `📅 UPCOMING EARNINGS (Next 7 Days):\n\n`;

    for (const pos of positions) {
      report += `• ${pos.symbol}: ${pos.earningsDate} (${pos.earningsTime}) - ${pos.daysUntil} days\n`;
      report += `  Lots: ${pos.lots.length}, Total shares: ${pos.lots.reduce((sum, lot) => sum + lot.quantity, 0)}\n\n`;
    }

    return report;

  } catch (error) {
    console.error('Error generating weekly earnings report:', error);
    return 'Error generating earnings report';
  }
}

export default {
  getPositionsWithUpcomingEarnings,
  analyzeBeforeEarnings,
  executeEarningsDecision,
  runEarningsDayAnalysis,
  getWeeklyEarningsReport
};
