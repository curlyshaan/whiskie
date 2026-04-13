import * as db from './db.js';
import claude from './claude.js';
import tradier from './tradier.js';
import stockProfiles from './stock-profiles.js';
import email from './email.js';

/**
 * Weekly Portfolio Review
 * Deep dive on current holdings + watchlist
 * Opus reflects on performance, lessons learned, and portfolio health
 */

export async function runWeeklyPortfolioReview() {
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('📊 WEEKLY PORTFOLIO REVIEW');
  console.log('═══════════════════════════════════════');
  console.log('');

  try {
    // Get current positions
    const positions = await db.query('SELECT * FROM positions WHERE quantity != 0 ORDER BY symbol');
    console.log(`📋 Current positions: ${positions.rows.length}`);

    // Get watchlists
    const mainWatchlist = await db.getWatchlist();
    const saturdayWatchlist = await db.query('SELECT * FROM saturday_watchlist WHERE status = $1', ['active']);

    console.log(`👀 Watchlist stocks: ${mainWatchlist.length + saturdayWatchlist.rows.length}`);

    // Get this week's trades
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const trades = await db.query(
      'SELECT * FROM trades WHERE executed_at > $1 ORDER BY executed_at DESC',
      [weekAgo]
    );
    console.log(`📈 Trades this week: ${trades.rows.length}`);

    // Get portfolio snapshots for performance tracking
    const snapshots = await db.query(
      'SELECT * FROM portfolio_snapshots ORDER BY snapshot_date DESC LIMIT 7'
    );

    // Get stock profiles for holdings
    const holdingSymbols = positions.rows.map(p => p.symbol);
    const profiles = await stockProfiles.getStockProfiles(holdingSymbols);

    // Get current quotes for all positions
    const quotes = {};
    for (const position of positions.rows) {
      try {
        const quote = await tradier.getQuote(position.symbol);
        quotes[position.symbol] = quote;
      } catch (error) {
        console.warn(`Could not fetch quote for ${position.symbol}`);
      }
    }

    // Build comprehensive review prompt
    const reviewPrompt = buildReviewPrompt(
      positions.rows,
      quotes,
      profiles,
      trades.rows,
      snapshots.rows,
      mainWatchlist,
      saturdayWatchlist.rows
    );

    console.log('🤔 Running Opus weekly review (20k token thinking budget)...');
    const reviewStart = Date.now();

    const review = await claude.deepAnalysis(
      {},
      {},
      [],
      {},
      reviewPrompt,
      20000  // 20k token thinking budget
    );

    const reviewDuration = ((Date.now() - reviewStart) / 1000).toFixed(1);
    console.log(`✅ Review complete (${reviewDuration}s)`);

    // Save review to database
    await db.query(
      `INSERT INTO learning_insights (
        insight_date, insight_type, insight_text, confidence, created_at
      ) VALUES ($1, $2, $3, $4, NOW())`,
      [
        new Date().toISOString().split('T')[0],
        'weekly_review',
        review.analysis,
        'high'
      ]
    );

    // Send email summary
    await email.sendWeeklyReview(review.analysis, positions.rows, trades.rows);

    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('✅ WEEKLY REVIEW COMPLETE');
    console.log('═══════════════════════════════════════');
    console.log('');

    return review;

  } catch (error) {
    console.error('❌ Error in weekly portfolio review:', error);
    throw error;
  }
}

function buildReviewPrompt(positions, quotes, profiles, trades, snapshots, mainWatchlist, saturdayWatchlist) {
  // Calculate P&L for each position
  const positionDetails = positions.map(pos => {
    const quote = quotes[pos.symbol];
    const currentPrice = quote?.last || pos.current_price;
    const unrealizedPnL = (currentPrice - pos.avg_cost) * pos.quantity;
    const unrealizedPnLPercent = ((currentPrice - pos.avg_cost) / pos.avg_cost * 100).toFixed(2);
    const profile = profiles.find(p => p.symbol === pos.symbol);

    return {
      symbol: pos.symbol,
      quantity: pos.quantity,
      avgCost: pos.avg_cost,
      currentPrice,
      unrealizedPnL: unrealizedPnL.toFixed(2),
      unrealizedPnLPercent,
      marketValue: (currentPrice * pos.quantity).toFixed(2),
      daysHeld: Math.floor((Date.now() - new Date(pos.opened_at).getTime()) / (1000 * 60 * 60 * 24)),
      profile: profile ? {
        businessModel: profile.business_model?.substring(0, 200),
        risks: profile.risks?.substring(0, 200),
        catalysts: profile.catalysts?.substring(0, 200)
      } : null
    };
  });

  // Calculate portfolio performance
  const totalValue = positionDetails.reduce((sum, p) => sum + parseFloat(p.marketValue), 0);
  const totalUnrealizedPnL = positionDetails.reduce((sum, p) => sum + parseFloat(p.unrealizedPnL), 0);

  // Week-over-week performance
  const weekPerformance = snapshots.length >= 2 ?
    ((snapshots[0].total_value - snapshots[6]?.total_value) / snapshots[6]?.total_value * 100).toFixed(2) : 'N/A';

  return `You are conducting your weekly portfolio review. This is a time for deep reflection on your holdings, recent decisions, and lessons learned.

**CURRENT PORTFOLIO (${positions.length} positions, $${totalValue.toFixed(0)} total value)**

${positionDetails.map(p => `
**${p.symbol}** - ${p.quantity} shares @ $${p.avgCost} avg
- Current: $${p.currentPrice} | P&L: $${p.unrealizedPnL} (${p.unrealizedPnLPercent}%)
- Market value: $${p.marketValue} | Days held: ${p.daysHeld}
${p.profile ? `- Business: ${p.profile.businessModel}...
- Key risks: ${p.profile.risks}...
- Catalysts: ${p.profile.catalysts}...` : '- No profile available'}
`).join('\n')}

**PORTFOLIO METRICS**
- Total unrealized P&L: $${totalUnrealizedPnL.toFixed(2)}
- Week-over-week performance: ${weekPerformance}%
- Number of positions: ${positions.length}

**THIS WEEK'S TRADES (${trades.length} trades)**
${trades.map(t => `- ${t.action.toUpperCase()} ${t.quantity} ${t.symbol} @ $${t.price} on ${new Date(t.executed_at).toLocaleDateString()}`).join('\n')}

**WATCHLISTS**
- Main watchlist: ${mainWatchlist.map(w => w.symbol).join(', ')}
- Saturday watchlist (long): ${saturdayWatchlist.filter(w => w.intent === 'LONG').map(w => `${w.symbol} (${w.pathway})`).join(', ')}
- Saturday watchlist (short): ${saturdayWatchlist.filter(w => w.intent === 'SHORT').map(w => `${w.symbol} (${w.pathway})`).join(', ')}

**YOUR TASK: WEEKLY REFLECTION**

Conduct a thorough review and provide:

1. **POSITION HEALTH CHECK**
   - Which positions are performing as expected? Which aren't?
   - Are any theses broken or invalidated?
   - Should any positions be trimmed, exited, or added to?

2. **TRADE REVIEW**
   - What worked well this week? What didn't?
   - Were entries/exits well-timed?
   - Any mistakes or missed opportunities?

3. **LESSONS LEARNED**
   - What patterns are you noticing?
   - What should you do more of? Less of?
   - Any behavioral biases showing up?

4. **WATCHLIST ASSESSMENT**
   - Are watchlist stocks still compelling?
   - Any new catalysts or risks emerging?
   - Should any be promoted to trades or removed?

5. **NEXT WEEK'S FOCUS**
   - What should you prioritize?
   - Any upcoming earnings or events to watch?
   - Portfolio adjustments needed?

Be honest and self-critical. This is for learning and improvement, not justification.`;
}

export default {
  runWeeklyPortfolioReview
};
