import * as db from './db.js';
import fmp from './fmp.js';
import claude from './claude.js';
import newsSearch from './news-search.js';
import email from './email.js';
import tradier from './tradier.js';
import thesisManager from './thesis-manager.js';
import { resolveMarketPrice } from './utils.js';
import optionsAnalyzer from './options-analyzer.js';
import { ensureFreshStockProfile } from './stock-profiles.js';

async function isCanonicalSaturdayWatchlistSymbol(symbol) {
  const rows = await db.getCanonicalSaturdayWatchlistRows(['active', 'pending'], { includePromoted: true }).catch(() => []);
  return rows.some(row => String(row.symbol || '').toUpperCase() === String(symbol || '').trim().toUpperCase());
}

async function getEarningsSurpriseHistory(symbol) {
  const [surprises, earningsHistory] = await Promise.all([
    fmp.getEarningsSurprises(symbol, 8).catch(() => []),
    fmp.getHistoricalEarnings(symbol, 8).catch(() => [])
  ]);

  const avgSurprisePct = surprises.length
    ? surprises.reduce((sum, row) => sum + Number(row.epsSurprisePercent || row.epssurprisepct || 0), 0) / surprises.length
    : 0;

  const beatRate = surprises.length
    ? surprises.filter(row => Number(row.epsActual ?? row.epsactual ?? 0) > Number(row.epsEstimated ?? row.epsestimate ?? 0)).length / surprises.length
    : null;

  return {
    recentSurprises: surprises.slice(0, 4),
    recentEarnings: earningsHistory.slice(0, 4),
    avgSurprisePct: Number(avgSurprisePct.toFixed(2)),
    beatRate: beatRate == null ? null : Number((beatRate * 100).toFixed(0))
  };
}

async function getPostEarningsContext(symbol) {
  const [newsHealth, quote, surpriseHistory] = await Promise.all([
    newsSearch.getStructuredEarningsContextWithHealth(symbol, { maxResults: 4, timeRange: 'week' }),
    fmp.getQuote(symbol).catch(() => null),
    getEarningsSurpriseHistory(symbol).catch(() => null)
  ]);

  return {
    news: newsHealth.results || [],
    newsHealth,
    quote,
    surpriseHistory
  };
}

function toDateOnlyString(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().split('T')[0];
}

function classifyDipSeverity(reactionPct) {
  const numeric = Number(reactionPct);
  if (!Number.isFinite(numeric) || numeric > -4) return 'none';
  if (numeric <= -10) return 'deep';
  if (numeric <= -7) return 'standard';
  return 'mild';
}

function computeLiveReactionDipPct({
  session,
  liveReactionPct,
  dipBasisPct,
  earningsDate = null
} = {}) {
  const normalizedLive = Number.isFinite(Number(liveReactionPct)) ? Number(liveReactionPct) : null;
  const normalizedBasis = Number.isFinite(Number(dipBasisPct)) ? Number(dipBasisPct) : null;
  if (session === 'post_market') {
    return normalizedLive ?? normalizedBasis;
  }

  const today = getTodayDateOnlyString();
  const normalizedEarningsDate = toDateOnlyString(earningsDate);
  if (session === 'pre_market' && normalizedEarningsDate && today === normalizedEarningsDate) {
    return normalizedLive ?? normalizedBasis;
  }

  return normalizedBasis ?? normalizedLive;
}

function percentChange(baseValue, comparisonValue) {
  const base = Number(baseValue);
  const comparison = Number(comparisonValue);
  if (!Number.isFinite(base) || !Number.isFinite(comparison) || base === 0) return null;
  return Number((((comparison - base) / base) * 100).toFixed(2));
}

function normalizeEarningsSession(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['pre_market', 'bmo', 'before_market_open'].includes(normalized)) return 'pre_market';
  if (['post_market', 'amc', 'after_market_close'].includes(normalized)) return 'post_market';
  return 'unknown';
}

function getTodayDateOnlyString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function getEasternMinutesSinceMidnight(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return (Number(lookup.hour) * 60) + Number(lookup.minute);
}

function shiftDateByDays(dateString, dayDelta) {
  const date = new Date(`${dateString}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + dayDelta);
  return date.toISOString().split('T')[0];
}

function nextTradingDay(dateString) {
  let cursor = shiftDateByDays(dateString, 1);
  while (cursor) {
    const date = new Date(`${cursor}T12:00:00Z`);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) return cursor;
    cursor = shiftDateByDays(cursor, 1);
  }
  return null;
}

export function previousTradingDay(dateString) {
  let cursor = shiftDateByDays(dateString, -1);
  while (cursor) {
    const date = new Date(`${cursor}T12:00:00Z`);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) return cursor;
    cursor = shiftDateByDays(cursor, -1);
  }
  return null;
}

export function getTradingDayDifference(fromDate, toDate = new Date()) {
  const startString = toDateOnlyString(fromDate);
  const endString = toDateOnlyString(toDate);
  if (!startString || !endString) return Number.POSITIVE_INFINITY;
  if (startString === endString) return 0;

  let cursor = startString;
  let count = 0;
  while (cursor && cursor < endString) {
    cursor = nextTradingDay(cursor);
    if (cursor && cursor <= endString) {
      count += 1;
    }
  }
  return count;
}

export function isRecentPostEarningsCandidate(row = null, maxTradingDays = 2, now = new Date()) {
  if (!row?.earnings_date) return false;
  const earningsDate = toDateOnlyString(row.earnings_date);
  if (!earningsDate) return false;

  const session = normalizeEarningsSession(row.session_normalized || row.earnings_time);
  const referenceDate = session === 'post_market'
    ? nextTradingDay(earningsDate)
    : earningsDate;

  if (!referenceDate) return false;
  const tradingDayAge = getTradingDayDifference(referenceDate, now);
  return Number.isFinite(tradingDayAge) && tradingDayAge >= 0 && tradingDayAge <= maxTradingDays;
}

function getPostEarningsAnalysisReadiness(earningsDate, earningsSession, now = new Date()) {
  const normalizedDate = toDateOnlyString(earningsDate);
  const session = normalizeEarningsSession(earningsSession);
  const today = getTodayDateOnlyString();
  const currentMinutes = getEasternMinutesSinceMidnight(now);

  if (!normalizedDate) {
    return {
      ready: false,
      session,
      targetAnalysisDate: null,
      fallbackUsed: false,
      reason: 'missing_earnings_date'
    };
  }

  if (session === 'pre_market') {
    return {
      ready: today > normalizedDate || (today === normalizedDate && currentMinutes >= 10 * 60),
      session,
      targetAnalysisDate: normalizedDate,
      fallbackUsed: false,
      reason: today < normalizedDate
        ? 'pre_market_before_earnings_date'
        : today === normalizedDate && currentMinutes < 10 * 60
          ? 'pre_market_waiting_for_10am'
          : 'ready'
    };
  }

  if (session === 'post_market') {
    const targetDate = nextTradingDay(normalizedDate);
    return {
      ready: Boolean(targetDate && (today > targetDate || (today === targetDate && currentMinutes >= 10 * 60))),
      session,
      targetAnalysisDate: targetDate,
      fallbackUsed: false,
      reason: !targetDate
        ? 'missing_next_trading_day'
        : today < targetDate
          ? 'post_market_waiting_for_next_trading_day'
          : today === targetDate && currentMinutes < 10 * 60
            ? 'post_market_waiting_for_10am'
            : 'ready'
    };
  }

  return {
    ready: today > normalizedDate || (today === normalizedDate && currentMinutes >= 10 * 60),
    session: 'unknown',
    targetAnalysisDate: normalizedDate,
    fallbackUsed: true,
    reason: today < normalizedDate
      ? 'unknown_before_earnings_date'
      : today === normalizedDate && currentMinutes < 10 * 60
        ? 'unknown_waiting_for_10am_fallback'
        : 'ready'
  };
}

async function buildPostEarningsReactionSnapshot(symbol, earningsDate, earningsSession, currentPrice) {
  const normalizedDate = toDateOnlyString(earningsDate);
  const session = normalizeEarningsSession(earningsSession);
  const readiness = getPostEarningsAnalysisReadiness(normalizedDate, session);
  if (!normalizedDate) {
    return {
      source: 'unavailable',
      session,
      analysisReady: false,
      targetAnalysisDate: null,
      preEarningsClose: null,
      earningsDayOpen: null,
      earningsDayClose: null,
      comparisonOpen: null,
      comparisonClose: null,
      comparisonSessionDate: null,
      currentPrice: Number.isFinite(Number(currentPrice)) ? Number(currentPrice) : null,
      reactionPct: null,
      gapPct: null,
      closeToCloseReactionPct: null,
      intradayReactionPct: null,
      liveReactionPct: null,
      liveReactionDipPct: null,
      dipBasisPct: null,
      dipThresholdPct: -4,
      isDip: false,
      dipSeverity: 'none'
    };
  }

  const lookbackStart = new Date(normalizedDate);
  lookbackStart.setDate(lookbackStart.getDate() - 5);
  const comparisonDate = session === 'post_market'
    ? nextTradingDay(normalizedDate)
    : normalizedDate;
  const historyEndDate = comparisonDate || normalizedDate;
  const history = await fmp.getHistoricalPriceEodFull(
    symbol,
    toDateOnlyString(lookbackStart),
    historyEndDate
  ).catch(() => []);

  const sorted = Array.isArray(history)
    ? [...history].sort((a, b) => String(a.date).localeCompare(String(b.date)))
    : [];
  const earningsIndex = sorted.findIndex(row => String(row.date) === normalizedDate);
  const earningsRow = earningsIndex >= 0 ? sorted[earningsIndex] : null;
  const preEarningsRow = earningsIndex > 0 ? sorted[earningsIndex - 1] : sorted[sorted.length - 2] || null;
  const comparisonRow = comparisonDate
    ? sorted.find(row => String(row.date) === comparisonDate) || null
    : null;

  const preEarningsClose = Number(preEarningsRow?.close || 0) || null;
  const earningsDayOpen = Number(earningsRow?.open || 0) || null;
  const earningsDayClose = Number(earningsRow?.close || 0) || null;
  const comparisonOpen = Number(comparisonRow?.open || 0) || null;
  const comparisonClose = Number(comparisonRow?.close || 0) || null;
  const normalizedCurrentPrice = Number.isFinite(Number(currentPrice)) ? Number(currentPrice) : null;

  const gapPct = percentChange(preEarningsClose, earningsDayOpen);
  const closeToCloseReactionPct = percentChange(preEarningsClose, comparisonClose);
  const intradayReactionPct = percentChange(comparisonOpen, comparisonClose);
  const liveReactionPct = percentChange(preEarningsClose, normalizedCurrentPrice);
  const dipBasisCandidates = [gapPct, closeToCloseReactionPct].filter(Number.isFinite);
  const dipBasisPct = dipBasisCandidates.length ? Math.min(...dipBasisCandidates) : null;
  const liveReactionDipPct = computeLiveReactionDipPct({
    session,
    liveReactionPct,
    dipBasisPct,
    earningsDate: normalizedDate
  });
  const reactionPct = closeToCloseReactionPct ?? liveReactionPct ?? gapPct;
  const dipSeverity = classifyDipSeverity(liveReactionDipPct);
  const comparisonDataReady = session !== 'post_market' || Number.isFinite(comparisonClose);
  const analysisReady = readiness.ready && comparisonDataReady;
  const pendingReason = !comparisonDataReady ? 'post_market_missing_comparison_session_data' : readiness.reason;

  return {
    source: preEarningsClose ? 'fmp_eod_pre_close' : 'fallback',
    earningsDate: normalizedDate,
    earningsSession: session,
    analysisReady,
    targetAnalysisDate: readiness.targetAnalysisDate,
    fallbackUsed: readiness.fallbackUsed,
    pendingReason,
    preEarningsClose,
    earningsDayOpen,
    earningsDayClose,
    comparisonOpen,
    comparisonSessionDate: comparisonDate,
    comparisonClose,
    currentPrice: normalizedCurrentPrice,
    reactionPct,
    gapPct,
    closeToCloseReactionPct,
    intradayReactionPct,
    liveReactionPct,
    liveReactionDipPct,
    dipBasisPct,
    dipThresholdPct: -4,
    isDip: analysisReady && Number.isFinite(liveReactionDipPct) && liveReactionDipPct <= -4,
    dipSeverity
  };
}

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
          const symbolLots = lots.filter(lot => lot.symbol === symbol);
          const isShort = symbolLots.some(lot => lot.position_type === 'short' || lot.quantity < 0);

          if (symbolLots.length === 0) {
            continue;
          }

          positionsWithEarnings.push({
            symbol,
            earningsDate: earning.earnings_date,
            earningsTime: earning.session_normalized || earning.earnings_time,
            daysUntil,
            lots: symbolLots,
            isShort
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
    const context = await getPostEarningsContext(position.symbol);
    const newsText = `${context.newsHealth?.degraded ? `TAVILY DEGRADED: ${context.newsHealth.providerStatus}${context.newsHealth.warning ? ` — ${context.newsHealth.warning}` : ''}\n` : ''}${newsSearch.formatResults(context.news)}`;

    // Get current price
    const quote = await fmp.getQuote(position.symbol);
    let marketOpen = false;
    try {
      marketOpen = await tradier.isMarketOpen();
    } catch (error) {
      console.warn(`⚠️ Could not determine market-open state for ${position.symbol}, defaulting to closed-market pricing:`, error.message);
    }
    const currentPrice = resolveMarketPrice(quote, { marketOpen, fallback: 0 });

    // Calculate position details
    const totalQuantity = position.lots.reduce((sum, lot) => sum + Math.abs(lot.quantity), 0);
    const totalCost = position.lots.reduce((sum, lot) => sum + (Math.abs(lot.quantity) * lot.cost_basis), 0);
    const avgCostBasis = totalQuantity > 0 ? totalCost / totalQuantity : 0;
    const gainPercent = position.isShort
      ? ((avgCostBasis - currentPrice) / avgCostBasis * 100).toFixed(2)
      : ((currentPrice - avgCostBasis) / avgCostBasis * 100).toFixed(2);

    // Get thesis from first lot
    const thesis = position.lots[0]?.thesis || 'No thesis available';
    let optionsContext = 'Options earnings context unavailable';
    let optionsReview = null;
    try {
      optionsReview = await optionsAnalyzer.analyzeSymbol({
        symbol: position.symbol,
        intentHorizon: 'short_term',
        eventMode: 'earnings'
      });
      optionsContext = JSON.stringify({
        recommendation: optionsReview.recommendation,
        optionsSentiment: optionsReview.optionsSentiment,
        warnings: optionsReview.warnings?.slice(0, 3) || []
      }, null, 2);
    } catch (error) {
      console.warn(`⚠️ Could not load options earnings context for ${position.symbol}:`, error.message);
    }

    const surpriseHistory = await getEarningsSurpriseHistory(position.symbol).catch(() => null);
    const portfolio = await db.getPortfolioSnapshot?.().catch(() => null);
    const portfolioValue = Number(portfolio?.total_value || 0);
    const positionValue = currentPrice * totalQuantity;
    const positionPct = portfolioValue > 0 ? (positionValue / portfolioValue) * 100 : null;

    // Ask Claude Opus for analysis
    const prompt = `
You are analyzing ${position.symbol} which has earnings ${(position.earningsTime === 'bmo' || position.earningsTime === 'pre_market') ? 'BEFORE market open' : (position.earningsTime === 'amc' || position.earningsTime === 'post_market') ? 'AFTER market close' : 'with unknown session'} on ${position.earningsDate}.

POSITION DETAILS:
- Type: ${position.isShort ? 'SHORT' : 'LONG'}
- Entry: $${avgCostBasis.toFixed(2)}
- Current: $${currentPrice.toFixed(2)}
- ${position.isShort ? 'Profit' : 'Gain'}: ${gainPercent}%
- Quantity: ${totalQuantity} shares
- Position size: ${positionPct == null ? 'unknown' : `${positionPct.toFixed(1)}% of portfolio`}
- Investment thesis: ${thesis}

RECENT NEWS:
${context.newsHealth?.degraded ? `TAVILY DEGRADED: ${context.newsHealth.providerStatus}${context.newsHealth.warning ? ` — ${context.newsHealth.warning}` : ''}\n` : ''}${newsText}

OPTIONS EARNINGS CONTEXT:
${optionsContext}

EARNINGS SURPRISE HISTORY:
${JSON.stringify(context.surpriseHistory || {}, null, 2)}

QUESTION: Should we ${position.isShort ? 'cover (close short)' : 'hold through earnings'}, trim 50%, or ${position.isShort ? 'cover completely' : 'sell completely'}?

${position.isShort ? `
SHORT-SPECIFIC CONSIDERATIONS:
1. Earnings can gap stock UP 10-20% overnight (unlimited loss risk)
2. Is the bearish thesis strong enough to hold through gap risk?
3. Swing shorts should generally be covered before earnings
4. Long-term structural shorts can hold if thesis is rock-solid
5. Consider: Is this a momentum short or fundamental deterioration short?
` : `
LONG CONSIDERATIONS:
1. Is the thesis still valid?
2. What's the earnings risk vs reward?
3. How much of the gain should we protect?
4. Is the stock overextended or has room to run?
`}

Provide a clear recommendation: ${position.isShort ? 'COVER, COVER_50, or HOLD' : 'HOLD, TRIM_50, or SELL'}
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
    if (position.isShort) {
      // Short position recommendations
      if (analysis.analysis.includes('COVER_50') || analysis.analysis.includes('cover 50%')) {
        recommendation = 'COVER_50';
      } else if (analysis.analysis.includes('COVER')) {
        recommendation = 'COVER';
      }
    } else {
      // Long position recommendations
      if (analysis.analysis.includes('TRIM_50') || analysis.analysis.includes('trim 50%')) {
        recommendation = 'TRIM_50';
      } else if (analysis.analysis.includes('SELL')) {
        recommendation = 'SELL';
      }
    }

    return {
      symbol: position.symbol,
      recommendation,
      reasoning: analysis.analysis,
      thesisState: thesisManager.extractThesisState(analysis.analysis),
      currentPrice,
      gainPercent,
      totalQuantity,
      earningsDate: position.earningsDate,
      earningsTime: position.earningsTime,
      optionsReview,
      surpriseHistory,
      positionPct
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

    await thesisManager.persistPositionManagementUpdate(analysis.symbol, {
      thesisSummary: analysis.reasoning,
      thesisState: analysis.thesisState || 'unchanged',
      holdingPosture: analysis.recommendation === 'SELL'
        ? 'exit'
        : analysis.recommendation === 'TRIM_50'
          ? 'trim'
          : analysis.recommendation === 'COVER'
            ? 'cover'
            : analysis.recommendation === 'COVER_50'
              ? 'trim'
              : 'hold'
    });

    if (analysis.recommendation === 'HOLD') {
      console.log('✅ Holding through earnings');

      // Send notification
      await email.sendEmail(
        email.alertEmail,
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

        await db.query('BEGIN');
        try {
          for (const lot of lots) {
            if (lot.quantity > 0) {
              const lotTrimQty = Math.floor(lot.quantity * 0.5);
              await db.query(
                `UPDATE position_lots
                 SET quantity = quantity - $1,
                     last_reviewed = CURRENT_TIMESTAMP
                 WHERE id = $2`,
                [lotTrimQty, lot.id]
              );
            }
          }
          await db.query('COMMIT');
        } catch (lotError) {
          await db.query('ROLLBACK');
          throw lotError;
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

export async function analyzeAfterEarnings(symbol, earningOverride = null) {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  if (!normalizedSymbol) throw new Error('Symbol is required');

  if (await isCanonicalSaturdayWatchlistSymbol(normalizedSymbol)) {
    await ensureFreshStockProfile(normalizedSymbol, { staleAfterDays: 14, incrementalRefreshDays: 14 }).catch(() => null);
  }

  const normalizedOverride = earningOverride?.earnings_date ? earningOverride : null;
  const [positionLots, context, fallbackPastEarning, profile, stockInfo] = await Promise.all([
    db.getPositionLots(normalizedSymbol).catch(() => []),
    getPostEarningsContext(normalizedSymbol),
    normalizedOverride ? Promise.resolve(null) : db.getMostRecentPastEarning(normalizedSymbol).catch(() => null),
    db.getLatestStockProfile(normalizedSymbol).catch(() => null),
    db.getStockInfo(normalizedSymbol).catch(() => null)
  ]);

  const relevantEarning = normalizedOverride || fallbackPastEarning;

  const currentPrice = Number(resolveMarketPrice(context.quote, { marketOpen: false, fallback: 0 }));
  const earningsSession = normalizeEarningsSession(relevantEarning?.session_normalized || relevantEarning?.earnings_time);
  const readiness = getPostEarningsAnalysisReadiness(relevantEarning?.earnings_date || null, earningsSession);
  if (!readiness.ready) {
    return {
      symbol: normalizedSymbol,
      skipped: true,
      reason: readiness.reason,
      readiness
    };
  }
  const reactionSnapshot = await buildPostEarningsReactionSnapshot(
    normalizedSymbol,
    relevantEarning?.earnings_date || null,
    earningsSession,
    currentPrice
  ).catch(() => null);
  if (!reactionSnapshot?.analysisReady) {
    return {
      symbol: normalizedSymbol,
      skipped: true,
      reason: reactionSnapshot?.pendingReason || 'post_earnings_snapshot_not_ready',
      readiness,
      reactionSnapshot
    };
  }
  const newsText = `${context.newsHealth?.degraded ? `TAVILY DEGRADED: ${context.newsHealth.providerStatus}${context.newsHealth.warning ? ` — ${context.newsHealth.warning}` : ''}\n` : ''}${newsSearch.formatResults(context.news || [])}`;
  const hasPosition = Array.isArray(positionLots) && positionLots.length > 0;
  const totalQuantity = hasPosition
    ? positionLots.reduce((sum, lot) => sum + Math.abs(Number(lot.quantity || 0)), 0)
    : 0;
  const avgCostBasis = hasPosition && totalQuantity > 0
    ? positionLots.reduce((sum, lot) => sum + (Math.abs(Number(lot.quantity || 0)) * Number(lot.cost_basis || 0)), 0) / totalQuantity
    : null;
  const reactionPct = avgCostBasis && currentPrice
    ? (((currentPrice - avgCostBasis) / avgCostBasis) * 100).toFixed(2)
    : null;
  const prompt = `
You are reviewing ${normalizedSymbol} immediately after an earnings event.

Company:
${JSON.stringify(stockInfo || {}, null, 2)}

Current price: $${currentPrice.toFixed(2)}
Upcoming/last earnings calendar record:
${JSON.stringify(relevantEarning || {}, null, 2)}

Analysis timing gate:
${JSON.stringify(readiness, null, 2)}

Deterministic post-earnings reaction metrics:
${JSON.stringify(reactionSnapshot || {}, null, 2)}

Current lots:
${JSON.stringify(positionLots, null, 2)}

Stock profile:
${profile ? JSON.stringify({
  business_model: profile.business_model,
  catalysts: profile.catalysts,
  risks: profile.risks,
  valuation_framework: profile.valuation_framework,
  profile_version: profile.profile_version
}, null, 2) : 'No profile available'}

Recent post-earnings news:
${newsText}

Historical earnings context:
${JSON.stringify(context.surpriseHistory || {}, null, 2)}

Position context:
- Has existing position: ${hasPosition ? 'YES' : 'NO'}
- Average cost basis: ${avgCostBasis == null ? 'N/A' : `$${avgCostBasis.toFixed(2)}`}
- Price vs cost basis: ${reactionPct == null ? 'N/A' : `${reactionPct}%`}

Your job:
1. Decide whether the post-earnings reaction is a buyable dip, a thesis confirmation, a broken setup, or just noise.
1a. Treat liveReactionDipPct as the primary deterministic dip metric for buy-the-overreaction decisions. For post-market names and same-day pre-market names, it should reflect the live move versus the pre-earnings close. For older events, fall back to dipBasisPct.
2. Weigh earnings result, guidance, capex, margin commentary, reaction magnitude, and whether the profile still supports ownership.
2a. If there is an existing position, explicitly decide whether adding shares fits the portfolio and current setup rather than assuming every dip is buyable.
3. If there is no position, decide whether this should become a watchlist candidate.

Return EXACTLY:
RECOMMENDATION: BUY_DIP | ADD_TO_WATCHLIST | HOLD | PASS
CONFIDENCE: HIGH | MEDIUM | LOW
WHY: 2-4 concise sentences
TRIGGER: one concise sentence describing what would confirm or invalidate the setup
`;

  const response = await claude.analyze(prompt, { model: 'opus', maxTokens: 400 });
  const text = String(response?.analysis || '').trim();
  const recommendation = text.match(/RECOMMENDATION:\s*(BUY_DIP|ADD_TO_WATCHLIST|HOLD|PASS)/i)?.[1]?.toUpperCase() || 'HOLD';
  const confidence = text.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i)?.[1]?.toUpperCase() || 'MEDIUM';
  const trigger = text.match(/TRIGGER:\s*([\s\S]*?)$/i)?.[1]?.trim() || '';

  await db.logEarningsAnalysis({
    symbol: normalizedSymbol,
    analysisPhase: 'post_earnings',
    recommendation,
    reasoning: text,
    positionSnapshot: positionLots,
    earningsSnapshot: relevantEarning,
    optionsSnapshot: context.surpriseHistory,
    signalSnapshot: reactionSnapshot
  });

  return {
    symbol: normalizedSymbol,
    recommendation,
    confidence,
    reasoning: text,
    trigger,
    currentPrice,
    readiness,
    reactionSnapshot,
    surpriseHistory: context.surpriseHistory,
    hasPosition
  };
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
      // Analyze 2 days ahead for post-market earnings, 1 day ahead otherwise
      const shouldAnalyze = position.daysUntil === 1 || (position.daysUntil === 2 && (position.earningsTime === 'amc' || position.earningsTime === 'post_market'));
      if (shouldAnalyze) {
        const analysis = await analyzeBeforeEarnings(position);
        decisions.push(analysis);

        await db.logEarningsAnalysis({
          symbol: analysis.symbol,
          analysisPhase: 'pre_earnings',
          recommendation: analysis.recommendation,
          reasoning: analysis.reasoning,
          positionSnapshot: {
            totalQuantity: analysis.totalQuantity,
            gainPercent: analysis.gainPercent,
            positionPct: analysis.positionPct
          },
          earningsSnapshot: {
            earningsDate: analysis.earningsDate,
            earningsTime: analysis.earningsTime
          },
          optionsSnapshot: {
            optionsReview: analysis.optionsReview,
            surpriseHistory: analysis.surpriseHistory
          }
        });

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
    console.log('\n📉 Checking for recent post-earnings opportunities...');
    const activeWatchlistRows = await db.getCanonicalSaturdayWatchlistRows(['active'], { includePromoted: true }).catch(() => []);
    const activeWatchlistSymbols = new Set(
      (activeWatchlistRows || []).map(row => String(row.symbol || '').toUpperCase()).filter(Boolean)
    );
    const recentEarnings = await db.getRecentAndUpcomingEarnings(4, 0).catch(() => []);
    const recentSymbols = [...new Set(
      (recentEarnings || [])
        .filter(row => isRecentPostEarningsCandidate(row, 2))
        .filter(row => activeWatchlistSymbols.has(String(row.symbol || '').toUpperCase()))
        .map(row => String(row.symbol || '').toUpperCase())
        .filter(Boolean)
    )];

    const postEarnings = [];
    for (const symbol of recentSymbols) {
      try {
        const analysis = await analyzeAfterEarnings(symbol);
        if (analysis?.skipped) {
          console.log(`   ⏳ ${symbol}: skipped (${analysis.reason})`);
          continue;
        }
        postEarnings.push(analysis);
        console.log(`   ✅ ${symbol}: ${analysis.recommendation} (${analysis.confidence || 'MEDIUM'})`);
      } catch (error) {
        console.error(`   ❌ Post-earnings analysis failed for ${symbol}: ${error.message}`);
      }
    }

    return {
      analyzed: decisions.length,
      decisions,
      postEarningsAnalyzed: postEarnings.length,
      postEarnings
    };

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
  analyzeAfterEarnings,
  executeEarningsDecision,
  runEarningsDayAnalysis,
  getWeeklyEarningsReport,
  isRecentPostEarningsCandidate,
  getTradingDayDifference,
  nextTradingDay,
  previousTradingDay
};
