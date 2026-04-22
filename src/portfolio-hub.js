import * as db from './db.js';
import { buildPortfolioHubRecommendation } from './portfolio-hub-advisor.js';
import { buildPortfolioHubSymbolContext } from './portfolio-hub-context.js';
import { PORTFOLIO_HUB_POLICY } from './portfolio-hub-policy.js';

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

export async function buildPortfolioHubView() {
  await db.seedPortfolioHubAccounts(DEFAULT_PORTFOLIO_HUB_ACCOUNTS).catch(() => {});

  const [accounts, transactions, whiskiePositions] = await Promise.all([
    db.getPortfolioHubAccounts().catch(() => []),
    db.listPortfolioHubTransactions().catch(() => []),
    db.getPositions().catch(() => [])
  ]);

  if (!transactions.length && !accounts.length) {
    return {
      accounts: [],
      holdings: [],
      transactions: [],
      sectorAllocation: [],
      accountAllocation: [],
      summary: { totalValue: 0, investedValue: 0, cash: 0, cashPct: 0, unrealizedPnL: 0, unrealizedPnLPct: 0 },
      insights: []
    };
  }

  const grouped = new Map();
  const groupedByAccountSymbol = new Map();
  const cashByAccount = new Map(accounts.map(account => [account.id, Number(account.cash_balance || 0)]));
  const whiskiePositionsMap = new Map((whiskiePositions || []).map(position => [String(position.symbol || '').toUpperCase(), position]));

  for (const tx of [...transactions].reverse()) {
    const type = String(tx.transaction_type || '').toLowerCase();
    if (type === 'cash_adjustment' || type === 'deposit' || type === 'withdraw') continue;

    const symbol = String(tx.symbol || '').toUpperCase();
    if (!symbol) continue;
    const accountSymbolKey = `${tx.account_id}:${symbol}`;
    if (!grouped.has(symbol)) {
      grouped.set(symbol, { symbol, shares: 0, totalCost: 0, accounts: [], positionType: 'long' });
    }
    if (!groupedByAccountSymbol.has(accountSymbolKey)) {
      groupedByAccountSymbol.set(accountSymbolKey, { accountId: tx.account_id, symbol, shares: 0, totalCost: 0 });
    }

    const row = grouped.get(symbol);
    const accountRow = groupedByAccountSymbol.get(accountSymbolKey);
    const shares = Number(tx.shares || 0);
    const price = Number(tx.price || 0);
    const signedShares = ['buy', 'cover'].includes(type) ? shares : ['sell', 'short'].includes(type) ? -shares : shares;

    row.shares += signedShares;
    row.totalCost += Math.abs(signedShares) * price;
    row.accounts.push(tx.account_name);
    row.positionType = row.shares < 0 ? 'short' : 'long';
    accountRow.shares += signedShares;
    accountRow.totalCost += Math.abs(signedShares) * price;
  }

  for (const [symbol, row] of grouped.entries()) {
    if (Math.abs(row.shares) < 0.0001) grouped.delete(symbol);
  }

  const symbols = [...grouped.keys()];
  const { earningsMap, stockInfoMap, profileMap, quoteMap } = await buildPortfolioHubSymbolContext(symbols, whiskiePositionsMap);

  let investedValue = 0;
  let totalCost = 0;
  let longExposure = 0;
  let shortExposure = 0;
  let longCost = 0;
  let shortCost = 0;
  const longSectorTotals = new Map();
  const shortSectorTotals = new Map();
  const holdings = [];

  for (const symbol of symbols) {
    const row = grouped.get(symbol);
    const quote = quoteMap.get(symbol) || null;
    const whiskiePosition = whiskiePositionsMap.get(symbol) || null;
    const stockInfo = stockInfoMap.get(symbol) || null;
    const profile = profileMap?.[symbol] || null;
    const currentPrice = Number(quote?.price || quote?.previousClose || quote?.close || 0);
    const absShares = Math.abs(row.shares);
    const avgCost = absShares > 0 ? row.totalCost / absShares : 0;
    const marketValue = currentPrice * absShares;
    const unrealizedPnL = row.positionType === 'short' ? (avgCost - currentPrice) * absShares : (currentPrice - avgCost) * absShares;
    const unrealizedPnLPct = row.totalCost > 0 ? (unrealizedPnL / row.totalCost) * 100 : 0;
    const sector = whiskiePosition?.sector || stockInfo?.sector || profile?.industry_sector || quote?.sector || stockInfo?.industry || quote?.industry || 'Unknown';
    const directionalLevels = normalizeDirectionalLevels(
      row.positionType,
      currentPrice,
      whiskiePosition?.stop_loss ?? null,
      whiskiePosition?.take_profit ?? null
    );

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
      whiskiePathway: whiskiePosition?.pathway || whiskiePosition?.strategy_type || null,
      stopLoss: directionalLevels.stopLoss,
      takeProfit: directionalLevels.takeProfit,
      whiskieView: ''
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
  const sectorWeightMap = new Map(sectorAllocation.map(row => [row.sector, row.weightPct]));

  holdings.forEach(row => {
    const sectorWeightPct = sectorWeightMap.get(row.sector) || 0;
    row.whiskieView = buildPortfolioHubRecommendation(row, {
      sectorWeightPct,
      hasWhiskiePosition: Boolean(whiskiePositionsMap.get(row.symbol))
    });
    row.sectorWeightPct = sectorWeightPct;
  });

  const accountAllocation = accounts.map(account => {
    const marketValue = [...groupedByAccountSymbol.values()]
      .filter(row => row.accountId === account.id && Math.abs(row.shares) > 0.0001)
      .reduce((sum, row) => {
        const holding = holdings.find(item => item.symbol === row.symbol);
        return sum + (Math.abs(row.shares) * Number(holding?.currentPrice || 0));
      }, 0);
    const accountCash = Number(cashByAccount.get(account.id) || 0);
    const accountTotal = marketValue + accountCash;
    return {
      account_name: account.account_name,
      cash: accountCash,
      marketValue,
      totalValue: accountTotal,
      weightPct: totalValue > 0 ? (accountTotal / totalValue) * 100 : 0
    };
  }).sort((a, b) => b.totalValue - a.totalValue);

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

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const adviceHistory = await db.getPortfolioHubAdviceHistorySince(startOfToday).catch(() => []);
  const dayStartSnapshot = adviceHistory[0] || null;
  const baselineTotalValue = Number(dayStartSnapshot?.snapshot_payload?.totalPortfolioValue || totalValue);
  const performancePct = baselineTotalValue > 0 ? ((totalValue - baselineTotalValue) / baselineTotalValue) * 100 : 0;
  const longPerformancePct = longCost > 0 ? ((longExposure - longCost) / longCost) * 100 : 0;
  const shortPerformancePct = shortCost > 0 ? ((shortExposure - shortCost) / shortCost) * 100 : 0;
  const performanceSeries = adviceHistory
    .map(row => ({
      label: new Date(row.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' }),
      combined: Number(row.snapshot_payload?.portfolioReturnPct ?? 0),
      long: Number(row.long_return_pct ?? 0),
      short: Number(row.short_return_pct ?? 0),
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
      sectorSnapshot: sectorAllocation
    }))
  ).catch(() => {});

  return {
    accounts,
    holdings,
    transactions,
    sectorAllocation,
    shortSectorExposure,
    accountAllocation,
    summary: {
      ...summary,
      performancePct,
      baselineTotalValue,
      longPerformancePct,
      shortPerformancePct
    },
    insights,
    sectorTrimCandidates,
    performanceSeries
  };
}
