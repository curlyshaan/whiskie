import * as db from './db.js';
import { buildPortfolioHubRecommendation } from './portfolio-hub-advisor.js';
import { buildPortfolioHubSymbolContext } from './portfolio-hub-context.js';
import { PORTFOLIO_HUB_POLICY } from './portfolio-hub-policy.js';
import claude from './claude.js';
import tavily from './tavily.js';
import vixRegime from './vix-regime.js';
import riskManager from './risk-manager.js';
import { ensureFreshStockProfile } from './stock-profiles.js';

export const DEFAULT_PORTFOLIO_HUB_ACCOUNTS = [
  'Sai-Webull-Cash',
  'Sai-Webull-Margin',
  'Sai-Webull-IRA',
  'Sai-Fidelity-IRA',
  'Sai-Tradier-Cash',
  'Sara-Webull-Cash',
  'Sara-Webull-IRA'
];

function normalizeDirectionalLevels(positionType, currentPrice, stopLoss, takeProfit) {
  const normalizedStop = Number(stopLoss);
  const normalizedTarget = Number(takeProfit);
  const validCurrent = Number(currentPrice);

  const result = {
    stopLoss: Number.isFinite(normalizedStop) ? normalizedStop : null,
    takeProfit: Number.isFinite(normalizedTarget) ? normalizedTarget : null
  };

  if (!Number.isFinite(validCurrent) || validCurrent <= 0) {
    return result;
  }

  if (positionType === 'short') {
    if (result.stopLoss != null && result.stopLoss <= validCurrent) result.stopLoss = null;
    if (result.takeProfit != null && result.takeProfit >= validCurrent) result.takeProfit = null;
    return result;
  }

  if (result.stopLoss != null && result.stopLoss >= validCurrent) result.stopLoss = null;
  if (result.takeProfit != null && result.takeProfit <= validCurrent) result.takeProfit = null;
  return result;
}

function normalizePerformancePointValue(row, metricMode = 'pct') {
  if (metricMode === 'value') {
    return {
      combined: Number(row.performance_value ?? 0),
      long: Number(row.long_performance_value ?? 0),
      short: Number(row.short_performance_value ?? 0)
    };
  }

  return {
    combined: Number(row.snapshot_payload?.portfolioReturnPct ?? row.snapshot_payload?.performancePct ?? 0),
    long: Number(row.long_return_pct ?? 0),
    short: Number(row.short_return_pct ?? 0)
  };
}

function formatPerformancePointLabel(date, range = 'week') {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  if (range === 'day') {
    return value.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
  }
  if (range === 'week') {
    return value.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  }
  return value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
}

function selectHistoryWindow(range = 'week') {
  const start = new Date();
  if (range === 'week') {
    start.setDate(start.getDate() - 7);
  } else if (range === 'month') {
    start.setDate(start.getDate() - 30);
  } else {
    start.setHours(0, 0, 0, 0);
  }
  return start;
}

function buildPersistedOpusReview(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    actionLabel: raw.actionLabel || 'Hold',
    summary: raw.summary || '',
    detail: raw.detail || '',
    shareCountText: raw.shareCountText || null,
    plannedTotalShares: Number.isFinite(Number(raw.plannedTotalShares)) ? Number(raw.plannedTotalShares) : null,
    targetPositionShares: Number.isFinite(Number(raw.targetPositionShares)) ? Number(raw.targetPositionShares) : null,
    executedShares: Number.isFinite(Number(raw.executedShares)) ? Number(raw.executedShares) : 0,
    remainingShares: Number.isFinite(Number(raw.remainingShares)) ? Number(raw.remainingShares) : null,
    stageLabel: raw.stageLabel || null,
    targetWeightPct: Number.isFinite(Number(raw.targetWeightPct)) ? Number(raw.targetWeightPct) : null,
    stopLoss: raw.stopLoss ?? null,
    takeProfit: raw.takeProfit ?? null,
    confidence: raw.confidence || null,
    reasoning: raw.reasoning || '',
    source: 'opus'
  };
}

function computeExecutedPlanShares(row, opusReview, transactions = []) {
  if (!opusReview || !opusReview.actionLabel || !Number.isFinite(Number(opusReview.plannedTotalShares))) return 0;
  const createdAt = opusReview.createdAt ? new Date(opusReview.createdAt) : null;
  const symbol = String(row.symbol || '').toUpperCase();
  const positionType = String(row.positionType || '').toLowerCase();

  return (transactions || []).reduce((sum, tx) => {
    if (String(tx.symbol || '').toUpperCase() !== symbol) return sum;

    if (createdAt && !Number.isNaN(createdAt.getTime())) {
      const txCreatedAt = new Date(tx.created_at || tx.trade_date || 0);
      if (!Number.isNaN(txCreatedAt.getTime()) && txCreatedAt < createdAt) return sum;
    }

    const type = String(tx.transaction_type || '').toLowerCase();
    if (positionType === 'long' && type === 'sell') return sum + Math.abs(Number(tx.shares || 0));
    if (positionType === 'short' && type === 'cover') return sum + Math.abs(Number(tx.shares || 0));
    return sum;
  }, 0);
}

function inferTargetPositionShares(row, opusReview) {
  const explicitTarget = Number(opusReview?.targetPositionShares);
  if (Number.isFinite(explicitTarget) && explicitTarget >= 0) {
    return explicitTarget;
  }

  const plannedTotalShares = Number(opusReview?.plannedTotalShares);
  const currentShares = Math.abs(Number(row?.shares || 0));
  const action = String(opusReview?.actionLabel || '').toLowerCase();

  if (!Number.isFinite(plannedTotalShares) || plannedTotalShares < 0 || !Number.isFinite(currentShares)) {
    return null;
  }

  if ((action === 'trim' || action === 'reduce' || action === 'cover') && plannedTotalShares <= currentShares) {
    const summary = String(opusReview?.summary || '').toLowerCase();
    const detail = String(opusReview?.detail || '').toLowerCase();
    if (summary.includes('position') || detail.includes('position') || summary.includes('oversized')) {
      return plannedTotalShares;
    }
  }

  return null;
}

function buildAdviceKey(symbol, positionType) {
  return `${String(symbol || '').toUpperCase()}:${String(positionType || '').toLowerCase()}`;
}

async function buildPortfolioHubMarketContext(portfolioHub) {
  const [regime, spyRegime, macroNews] = await Promise.all([
    vixRegime.getRegime().catch(() => null),
    riskManager.getMarketRegime().catch(() => 'unknown'),
    tavily.searchStructuredMacroContext({ maxResults: 5, timeRange: 'week' }).catch(() => [])
  ]);

  const allocationGuide = riskManager.getTargetAllocation(spyRegime || 'unknown');
  const summary = {
    vixRegime: regime ? {
      name: regime.name,
      vix: regime.vix,
      positionSizeMultiplier: regime.positionSizeMultiplier,
      minCashReserve: regime.minCashReserve,
      maxLongAllocation: regime.maxLongAllocation,
      maxShortAllocation: regime.maxShortAllocation,
      newPositionsAllowed: regime.newPositionsAllowed,
      newShortsAllowed: regime.newShortsAllowed,
      description: regime.description
    } : null,
    spyTrendRegime: spyRegime,
    targetAllocation: allocationGuide,
    currentExposure: {
      cashPct: portfolioHub.summary.cashPct,
      longExposurePct: portfolioHub.summary.longExposurePct,
      shortExposurePct: portfolioHub.summary.shortExposurePct,
      netExposurePct: portfolioHub.summary.netExposurePct
    },
    macroNews: macroNews.map(item => ({
      title: item.title,
      url: item.url,
      content: item.content,
      published_date: item.published_date || null
    }))
  };

  return {
    summary,
    formattedMacroNews: tavily.formatResults(macroNews)
  };
}

async function buildPortfolioHubStockNewsContext(holdings = [], sectorTrimCandidates = []) {
  const overloadedSymbols = new Set(
    (sectorTrimCandidates || [])
      .flatMap(item => item.candidates || [])
      .map(candidate => String(candidate.symbol || '').toUpperCase())
      .filter(Boolean)
  );

  const ranked = [...(holdings || [])]
    .map(row => {
      let priority = 0;
      if (overloadedSymbols.has(row.symbol)) priority += 100;
      priority += Math.min(50, Number(row.weightPct || 0));
      if (row.positionType === 'short') priority += 15;
      if (row.whiskieActionLabel && row.whiskieActionLabel !== 'Hold') priority += 20;
      if (row.nextEarningsDate) priority += 10;
      return { ...row, _priority: priority };
    })
    .sort((a, b) => b._priority - a._priority)
    .slice(0, 6);

  const stockNewsRows = await Promise.all(
    ranked.map(async row => {
      const results = await tavily.searchStructuredStockContext(row.symbol, {
        maxResults: 4,
        timeRange: 'month',
        context: {
          holdingPosture: row.whiskieHoldingPosture,
          pathway: row.whiskiePathway,
          actionLabel: row.whiskieActionLabel
        }
      }).catch(() => []);

      return {
        symbol: row.symbol,
        positionType: row.positionType,
        actionLabel: row.whiskieActionLabel,
        weightPct: row.weightPct,
        formattedNews: tavily.formatResults(results),
        items: results.map(item => ({
          title: item.title,
          url: item.url,
          content: item.content,
          published_date: item.published_date || null
        }))
      };
    })
  );

  return stockNewsRows;
}

async function ensurePortfolioHubProfiles(holdings = []) {
  const symbols = [...new Set((holdings || []).map(row => String(row.symbol || '').toUpperCase()).filter(Boolean))];
  if (!symbols.length) return [];

  const existingProfiles = await db.getLatestStockProfilesForSymbols(symbols).catch(() => ({}));
  const missingSymbols = symbols.filter(symbol => !existingProfiles[symbol]);

  if (!missingSymbols.length) {
    return [];
  }

  const built = [];
  for (const symbol of missingSymbols) {
    try {
      const result = await ensureFreshStockProfile(symbol, { staleAfterDays: 14, incrementalRefreshDays: 14 });
      built.push({ symbol, action: result?.action || 'built' });
    } catch (error) {
      built.push({ symbol, action: 'failed', error: error.message });
    }
  }

  return built;
}

export async function buildPortfolioHubView(options = {}) {
  const performanceRange = ['week', 'month'].includes(String(options.performanceRange || 'week'))
    ? String(options.performanceRange || 'week')
    : 'week';
  const performanceMetric = String(options.performanceMetric || 'pct') === 'value' ? 'value' : 'pct';
  const shouldPersistHistory = options.persistHistory === true;

  await db.seedPortfolioHubAccounts(DEFAULT_PORTFOLIO_HUB_ACCOUNTS).catch(() => {});

  const [accounts, transactions] = await Promise.all([
    db.getPortfolioHubAccounts().catch(() => []),
    db.listPortfolioHubTransactions().catch(() => [])
  ]);

  if (!transactions.length && !accounts.length) {
    return {
      accounts: [],
      holdings: [],
      transactions: [],
      sectorAllocation: [],
      summary: { totalValue: 0, investedValue: 0, cash: 0, cashPct: 0, unrealizedPnL: 0, unrealizedPnLPct: 0 },
      insights: []
    };
  }

  const grouped = new Map();
  const cashByAccount = new Map(accounts.map(account => [account.id, Number(account.cash_balance || 0)]));

  for (const tx of [...transactions].reverse()) {
    const type = String(tx.transaction_type || '').toLowerCase();
    if (type === 'cash_adjustment' || type === 'deposit' || type === 'withdraw') continue;

    const symbol = String(tx.symbol || '').toUpperCase();
    if (!symbol) continue;
    const positionType = type === 'short' || type === 'cover' ? 'short' : 'long';
    const groupKey = `${symbol}:${positionType}`;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, { symbol, shares: 0, totalCost: 0, accounts: [], positionType });
    }

    const row = grouped.get(groupKey);
    const shares = Number(tx.shares || 0);
    const price = Number(tx.price || 0);
    const signedShares = ['buy', 'short'].includes(type) ? shares : ['sell', 'cover'].includes(type) ? -shares : shares;

    row.shares += signedShares;
    row.totalCost += Math.abs(signedShares) * price;
    row.accounts.push(tx.account_name);
  }

  for (const [groupKey, row] of grouped.entries()) {
    if (Math.abs(row.shares) < 0.0001) grouped.delete(groupKey);
  }

  const symbols = [...new Set([...grouped.values()].map(row => row.symbol))];
  const { earningsMap, stockInfoMap, quoteMap, whiskieContextMap } = await buildPortfolioHubSymbolContext(symbols);
  const latestAdviceRows = await db.getLatestPortfolioHubAdviceHistory(symbols).catch(() => []);
  const latestAdviceMap = new Map(
    (latestAdviceRows || []).map(row => [buildAdviceKey(row.symbol, row.position_type), row])
  );
  const latestFullReviewAt = latestAdviceRows
    .map(row => row.opus_review_created_at)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0] || null;

  let investedValue = 0;
  let totalCost = 0;
  let longExposure = 0;
  let shortExposure = 0;
  let longCost = 0;
  let shortCost = 0;
  const longSectorTotals = new Map();
  const shortSectorTotals = new Map();
  const holdings = [];

  for (const row of grouped.values()) {
    const symbol = row.symbol;
    const quote = quoteMap.get(symbol) || null;
    const whiskieContext = whiskieContextMap.get(symbol) || null;
    const stockInfo = stockInfoMap.get(symbol) || null;
    const currentPrice = Number(quote?.price || quote?.previousClose || quote?.close || 0);
    const absShares = Math.abs(row.shares);
    const avgCost = absShares > 0 ? row.totalCost / absShares : 0;
    const marketValue = currentPrice * absShares;
    const unrealizedPnL = row.positionType === 'short' ? (avgCost - currentPrice) * absShares : (currentPrice - avgCost) * absShares;
    const unrealizedPnLPct = row.totalCost > 0 ? (unrealizedPnL / row.totalCost) * 100 : 0;
    const sector = stockInfo?.sector || quote?.sector || 'Unknown';
    const directionalLevels = normalizeDirectionalLevels(
      row.positionType,
      currentPrice,
      null,
      null
    );
    const latestAdvice = latestAdviceMap.get(buildAdviceKey(symbol, row.positionType)) || null;
    const persistedOpusReview = buildPersistedOpusReview(latestAdvice?.opus_review);
    if (persistedOpusReview) {
      persistedOpusReview.createdAt = latestAdvice?.opus_review_created_at || latestAdvice?.created_at || null;
      persistedOpusReview.executedShares = computeExecutedPlanShares(row, persistedOpusReview, transactions);
      const inferredTargetPositionShares = inferTargetPositionShares(row, persistedOpusReview);
      if (Number.isFinite(Number(inferredTargetPositionShares))) {
        persistedOpusReview.targetPositionShares = inferredTargetPositionShares;
        persistedOpusReview.remainingShares = Math.max(
          0,
          Math.round(Math.abs(Number(row.shares || 0)) - Number(inferredTargetPositionShares))
        );
      } else if (Number.isFinite(Number(persistedOpusReview.plannedTotalShares))) {
        persistedOpusReview.remainingShares = Math.max(
          0,
          Math.round(Number(persistedOpusReview.plannedTotalShares) - Number(persistedOpusReview.executedShares || 0))
        );
      }
    }

    investedValue += marketValue;
    totalCost += row.totalCost;
    if (row.positionType === 'short') {
      shortExposure += marketValue;
      shortCost += row.totalCost;
      shortSectorTotals.set(sector, (shortSectorTotals.get(sector) || 0) + marketValue);
    } else {
      longExposure += marketValue;
      longCost += row.totalCost;
      longSectorTotals.set(sector, (longSectorTotals.get(sector) || 0) + marketValue);
    }

    holdings.push({
      symbol,
      shares: row.shares,
      positionType: row.positionType,
      avgCost,
      currentPrice,
      marketValue,
      unrealizedPnL,
      unrealizedPnLPct,
      sector,
      nextEarningsDate: earningsMap.get(symbol) || null,
      whiskiePathway: whiskieContext?.pathway || null,
      whiskieNotes: whiskieContext?.thesisSummary || null,
      whiskieCatalysts: whiskieContext?.catalystSummary || null,
      whiskieSourceReasons: whiskieContext?.sourceReasons || [],
      whiskieLastAction: whiskieContext?.lastAction || null,
      whiskieHoldingPosture: whiskieContext?.holdingPosture || null,
      sectorSource: stockInfo?.sectorSource || (stockInfo?.sector ? 'stock_universe' : quote?.sector ? 'quote' : 'unknown'),
      stopLoss: persistedOpusReview?.stopLoss ?? directionalLevels.stopLoss,
      takeProfit: persistedOpusReview?.takeProfit ?? directionalLevels.takeProfit,
      whiskieView: '',
      whiskieActionLabel: 'Hold',
      opusReview: persistedOpusReview,
      opusReviewCreatedAt: latestAdvice?.opus_review_created_at || null
    });
  }

  const cash = [...cashByAccount.values()].reduce((sum, value) => sum + value, 0);
  const totalValue = investedValue + cash;

  holdings.sort((a, b) => b.marketValue - a.marketValue);
  holdings.forEach(row => {
    row.weightPct = totalValue > 0 ? (row.marketValue / totalValue) * 100 : 0;
  });

  const sectorAllocation = [...longSectorTotals.entries()]
    .map(([sector, value]) => ({ sector, value, weightPct: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
  const shortSectorExposure = [...shortSectorTotals.entries()]
    .map(([sector, value]) => ({ sector, value, weightPct: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
  const longSectorWeightMap = new Map(sectorAllocation.map(row => [row.sector, row.weightPct]));
  const shortSectorWeightMap = new Map(shortSectorExposure.map(row => [row.sector, row.weightPct]));

  holdings.forEach(row => {
    const sectorWeightPct = row.positionType === 'short'
      ? (shortSectorWeightMap.get(row.sector) || 0)
      : (longSectorWeightMap.get(row.sector) || 0);
    const recommendation = buildPortfolioHubRecommendation(row, {
      sectorWeightPct,
      whiskiePathway: row.whiskiePathway,
      totalPortfolioValue: totalValue,
      opusReview: row.opusReview
    });
    row.whiskieActionLabel = recommendation.actionLabel;
    row.whiskieView = recommendation.summary;
    row.whiskieDetail = recommendation.detail;
    row.whiskieShareCountText = recommendation.shareCountText || null;
    row.whiskiePlanProgressText = recommendation.planProgressText || null;
    row.sectorWeightPct = sectorWeightPct;
    row.stopLoss = recommendation.stopLoss ?? row.stopLoss;
    row.takeProfit = recommendation.takeProfit ?? row.takeProfit;
    row.whiskieSource = recommendation.source || (row.opusReview ? 'opus' : 'policy');
    row.whiskieConfidence = recommendation.confidence || row.opusReview?.confidence || null;
  });

  const summary = {
    totalValue,
    investedValue,
    cash,
    cashPct: totalValue > 0 ? (cash / totalValue) * 100 : 0,
    longExposure,
    shortExposure,
    longExposurePct: totalValue > 0 ? (longExposure / totalValue) * 100 : 0,
    shortExposurePct: totalValue > 0 ? (shortExposure / totalValue) * 100 : 0,
    netExposure: longExposure - shortExposure,
    netExposurePct: totalValue > 0 ? ((longExposure - shortExposure) / totalValue) * 100 : 0,
    unrealizedPnL: investedValue - totalCost,
    unrealizedPnLPct: totalCost > 0 ? ((investedValue - totalCost) / totalCost) * 100 : 0
  };

  const sectorTrimCandidates = sectorAllocation
    .filter(row => row.weightPct > PORTFOLIO_HUB_POLICY.long.sectorConcentrationThresholdPct)
    .map(row => {
      const candidates = holdings
        .filter(holding => holding.sector === row.sector && holding.positionType === 'long')
        .sort((a, b) => {
          const scoreA = (a.weightPct || 0) + Math.max(Number(a.unrealizedPnLPct || 0), 0);
          const scoreB = (b.weightPct || 0) + Math.max(Number(b.unrealizedPnLPct || 0), 0);
          return scoreB - scoreA;
        })
        .slice(0, 3)
        .map(holding => ({
          symbol: holding.symbol,
          action: holding.unrealizedPnLPct > 15 ? 'trim 15-25%' : holding.weightPct > 10 ? 'trim 10-20%' : 'reduce 5-10%',
          rationale: `weight ${holding.weightPct.toFixed(1)}%, P/L ${holding.unrealizedPnLPct.toFixed(1)}%`
        }));

      return {
        sector: row.sector,
        sectorWeightPct: row.weightPct,
        candidates
      };
    });

  const historyStart = selectHistoryWindow(performanceRange);
  const adviceHistory = await db.getPortfolioHubAdviceHistorySince(historyStart).catch(() => []);
  const historyRows = adviceHistory.filter(row => String(row.view_scope || 'day') === performanceRange);
  const baselineRow = historyRows[0] || adviceHistory[0] || null;
  const baselineTotalValue = Number(baselineRow?.total_portfolio_value || baselineRow?.baseline_total_value || baselineRow?.snapshot_payload?.totalPortfolioValue || totalValue);
  const performancePct = baselineTotalValue > 0 ? ((totalValue - baselineTotalValue) / baselineTotalValue) * 100 : 0;
  const longPerformancePct = longCost > 0 ? ((longExposure - longCost) / longCost) * 100 : 0;
  const shortPerformancePct = shortCost > 0 ? ((shortExposure - shortCost) / shortCost) * 100 : 0;
  const performanceValue = totalValue - baselineTotalValue;
  const longPerformanceValue = longExposure - longCost;
  const shortPerformanceValue = shortExposure - shortCost;
  const performanceSeries = historyRows
    .map(row => ({
      label: formatPerformancePointLabel(row.created_at, performanceRange),
      ...normalizePerformancePointValue(row, performanceMetric),
      sectors: row.sector_snapshot || []
    }))
    .filter(point => Number.isFinite(point.combined));

  const insights = [];
  if (holdings[0]) insights.push(`Largest holding is ${holdings[0].symbol} at ${holdings[0].weightPct.toFixed(1)}% of combined portfolio value.`);
  if (summary.cashPct > 20) insights.push(`Cash is ${summary.cashPct.toFixed(1)}% of the combined portfolio, which provides meaningful dry powder.`);
  const upcomingEarnings = holdings.filter(row => row.nextEarningsDate).slice(0, 5);
  if (upcomingEarnings.length) insights.push(`Upcoming earnings to monitor: ${upcomingEarnings.map(row => `${row.symbol} (${row.nextEarningsDate})`).join(', ')}.`);
  if (sectorAllocation[0]) insights.push(`Top sector exposure is ${sectorAllocation[0].sector} at ${sectorAllocation[0].weightPct.toFixed(1)}% of portfolio value.`);
  insights.push(`Current sizing policy targets: max long target weight ${PORTFOLIO_HUB_POLICY.long.maxTargetWeightPct}%, max short concentration ${PORTFOLIO_HUB_POLICY.short.concentrationWeightPct}%, max sector concentration ${PORTFOLIO_HUB_POLICY.long.sectorConcentrationThresholdPct}%.`);
  sectorTrimCandidates.forEach(item => {
    if (!item.candidates.length) return;
    insights.push(`Reduce ${item.sector} exposure (${item.sectorWeightPct.toFixed(1)}%): ${item.candidates.map(candidate => `${candidate.symbol} ${candidate.action} (${candidate.rationale})`).join(', ')}.`);
  });
  const explicitActions = holdings.filter(row => row.whiskieView).slice(0, 5).map(row => `${row.symbol}: ${row.whiskieView}`);
  if (explicitActions.length) insights.push(`Sizing actions: ${explicitActions.join(' | ')}`);

  if (shouldPersistHistory) {
    await db.recordPortfolioHubAdviceHistory(
      holdings.map(row => ({
        symbol: row.symbol,
        positionType: row.positionType,
        weightPct: row.weightPct,
        sector: row.sector,
        sectorWeightPct: row.sectorWeightPct,
        unrealizedPnLPct: row.unrealizedPnLPct,
        whiskiePathway: row.whiskiePathway,
        recommendation: row.whiskieView,
        snapshotPayload: {
          ...row,
          totalPortfolioValue: totalValue,
          portfolioReturnPct: performancePct
        },
        longReturnPct: longPerformancePct,
        shortReturnPct: shortPerformancePct,
        sectorSnapshot: sectorAllocation,
        viewScope: performanceRange,
        metricMode: performanceMetric,
        totalPortfolioValue: totalValue,
        baselineTotalValue,
        performanceValue,
        longPerformanceValue,
        shortPerformanceValue,
        sourceLabel: row.whiskieSource,
        opusReview: row.opusReview,
        opusReviewCreatedAt: row.opusReviewCreatedAt
      }))
    ).catch(() => {});
  }

  return {
    accounts,
    holdings,
    transactions,
    sectorAllocation,
    shortSectorExposure,
    summary: {
      ...summary,
      performancePct,
      performanceValue,
      baselineTotalValue,
      longPerformancePct,
      shortPerformancePct,
      longPerformanceValue,
      shortPerformanceValue
    },
    insights,
    sectorTrimCandidates,
    performanceSeries,
    performanceRange,
    performanceMetric,
    latestFullReviewAt
  };
}

export async function runPortfolioHubOpusReview() {
  const portfolioHub = await buildPortfolioHubView({ performanceRange: 'day', performanceMetric: 'pct', persistHistory: false });
  const holdings = Array.isArray(portfolioHub.holdings) ? portfolioHub.holdings : [];
  if (!holdings.length) {
    return { reviewedAt: new Date().toISOString(), holdings: [] };
  }
  const profileBuildResults = await ensurePortfolioHubProfiles(holdings);
  const marketContext = await buildPortfolioHubMarketContext(portfolioHub);
  const stockNewsContext = await buildPortfolioHubStockNewsContext(holdings, portfolioHub.sectorTrimCandidates || []);

  const prompt = `You are reviewing a household portfolio dashboard called Portfolio Hub. Return JSON only.

For each holding, provide:
- symbol
- actionLabel: one of Add, Trim, Reduce, Hold, Cover
- summary: one short sentence with exact-share guidance when action is not Hold
- detail: one short sentence explaining why
- shareCountText: exact share guidance like "Add 3 shares" or "Trim 2 shares"
- plannedTotalShares: total shares planned to execute across the full staged adjustment, not the final share count
- targetPositionShares: optional final target share count after the adjustment is complete
- stageLabel: short label like "Stage 1 of 2" or "Initial trim"
- targetWeightPct: optional end-state target weight percent if useful
- confidence: low, medium, or high
- stopLoss: number or null
- takeProfit: number or null
- reasoning: short internal explanation

Rules:
- Use exact-share guidance, not percentages.
- Only include stopLoss or takeProfit when confidence is medium or high.
- Keep guidance conservative and integer-share based.
- Respect long vs short direction.
- If no action is needed, use Hold and shareCountText null.
- This is not the Whiskie live bot. Treat the portfolio as mostly long-term/future-oriented and use market conditions as a softer overlay rather than a trading mandate.
- Split your thinking into two buckets:
  1. Core long-term holdings: slower changes, tolerate volatility, lower turnover
  2. Tactical / swing / short holdings: more responsive to VIX, SPY regime, and macro/news conditions
- In weak or volatile conditions, reduce new-add aggressiveness, prefer higher cash buffers, and be stricter on tactical positions than on core holdings.
- In strong conditions, you may allow somewhat more tactical adds, but do not churn core long-term holdings.
- Use staged execution memory: if a position needs a 4-share trim overall, set plannedTotalShares to 4 and let the immediate shareCountText reflect only the next step.
- If the recommendation is really about ending share count, also provide targetPositionShares explicitly.
- Never use plannedTotalShares to mean the final number of shares to hold.
- Assume future runs may compare plannedTotalShares with executed shares logged after the review, so avoid repeating the same full trim as if nothing was done.

Portfolio summary:
${JSON.stringify(portfolioHub.summary, null, 2)}

Market regime context:
${JSON.stringify(marketContext.summary, null, 2)}

Structured Tavily macro context:
${marketContext.formattedMacroNews}

Structured Tavily stock context for highest-priority holdings only:
${JSON.stringify(stockNewsContext, null, 2)}

Profile build results for holdings that were missing a Whiskie stock profile:
${JSON.stringify(profileBuildResults, null, 2)}

Holdings:
${JSON.stringify(holdings.map(row => ({
    symbol: row.symbol,
    positionType: row.positionType,
    shares: row.shares,
    avgCost: row.avgCost,
    currentPrice: row.currentPrice,
    marketValue: row.marketValue,
    weightPct: row.weightPct,
    unrealizedPnLPct: row.unrealizedPnLPct,
    sector: row.sector,
    nextEarningsDate: row.nextEarningsDate,
    whiskiePathway: row.whiskiePathway,
    whiskieNotes: row.whiskieNotes,
    whiskieCatalysts: row.whiskieCatalysts,
    whiskieHoldingPosture: row.whiskieHoldingPosture,
    existingPolicyView: row.whiskieView,
    allocationBucketHint: row.whiskieHoldingPosture && /core|long/i.test(String(row.whiskieHoldingPosture)) ? 'core_long_term' : row.positionType === 'short' ? 'tactical_short' : 'tactical_or_unclear'
  })), null, 2)}`;

  const response = await claude.analyze(prompt, { model: 'opus' });
  const rawText = String(response?.analysis || '').trim();
  const startIndex = rawText.search(/[\[{]/);
  const endIndex = Math.max(rawText.lastIndexOf('}'), rawText.lastIndexOf(']'));
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error('Opus portfolio review did not return JSON');
  }

  const parsed = JSON.parse(rawText.slice(startIndex, endIndex + 1));
  const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed.holdings) ? parsed.holdings : [];
  const bySymbol = new Map(entries.map(item => [String(item.symbol || '').toUpperCase(), item]));
  const reviewedAt = new Date().toISOString();

  await db.recordPortfolioHubAdviceHistory(
    holdings.map(row => {
      const opusReview = bySymbol.get(row.symbol) || null;
      return {
        symbol: row.symbol,
        positionType: row.positionType,
        weightPct: row.weightPct,
        sector: row.sector,
        sectorWeightPct: row.sectorWeightPct,
        unrealizedPnLPct: row.unrealizedPnLPct,
        whiskiePathway: row.whiskiePathway,
        recommendation: opusReview?.summary || row.whiskieView || '',
        snapshotPayload: {
          ...row,
          totalPortfolioValue: portfolioHub.summary.totalValue,
          portfolioReturnPct: portfolioHub.summary.performancePct
        },
        longReturnPct: portfolioHub.summary.longPerformancePct,
        shortReturnPct: portfolioHub.summary.shortPerformancePct,
        sectorSnapshot: portfolioHub.sectorAllocation,
        viewScope: 'day',
        metricMode: 'pct',
        totalPortfolioValue: portfolioHub.summary.totalValue,
        baselineTotalValue: portfolioHub.summary.baselineTotalValue,
        performanceValue: portfolioHub.summary.performanceValue,
        longPerformanceValue: portfolioHub.summary.longPerformanceValue,
        shortPerformanceValue: portfolioHub.summary.shortPerformanceValue,
        sourceLabel: 'opus',
        opusReview,
        opusReviewCreatedAt: reviewedAt
      };
    })
  );

  return {
    reviewedAt,
    holdings: holdings.map(row => ({
      symbol: row.symbol,
      positionType: row.positionType,
      opusReview: bySymbol.get(row.symbol) || null
    }))
  };
}
