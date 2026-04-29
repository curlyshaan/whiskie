import * as db from './db.js';
import { buildPortfolioHubRecommendation } from './portfolio-hub-advisor.js';
import { buildPortfolioHubSymbolContext } from './portfolio-hub-context.js';
import { PORTFOLIO_HUB_POLICY } from './portfolio-hub-policy.js';
import claude from './claude.js';
import tavily from './tavily.js';
import vixRegime from './vix-regime.js';
import riskManager from './risk-manager.js';
import newsCacheService from './services/news-cache-service.js';
import profileBuildService from './services/profile-build-service.js';
import portfolioRiskMetrics from './portfolio-risk-metrics.js';
import etfManager from './etf-manager.js';
import email from './email.js';

export const DEFAULT_PORTFOLIO_HUB_ACCOUNTS = [
  'Sai-Webull-Cash',
  'Sai-Webull-Margin',
  'Sai-Webull-IRA',
  'Sai-Fidelity-IRA',
  'Sai-Tradier-Cash',
  'Sara-Webull-Cash',
  'Sara-Webull-IRA'
];

const PORTFOLIO_HUB_LOCKS = {
  opusReview: 'portfolio_hub_opus_review',
  recommendedPositions: 'portfolio_hub_recommended_positions'
};

const PORTFOLIO_HUB_RECOMMENDATION_MIN_SCORE = 60;
const PORTFOLIO_HUB_RECOMMENDATION_ALLOWED_CONVICTIONS = new Set(['medium', 'high']);
const PORTFOLIO_HUB_RECOMMENDATION_DIFF_FIELDS = [
  'direction',
  'conviction',
  'starterShares',
  'starterPositionValue',
  'entryZone',
  'stopLoss',
  'takeProfit',
  'targetFramework',
  'relationshipType',
  'relatedHoldingSymbol',
  'relatedHoldingAction',
  'pathway'
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

function sumExecutedAdviceShares(symbol, positionType, adviceRows = []) {
  const normalizedSymbol = String(symbol || '').toUpperCase();
  const normalizedPositionType = String(positionType || '').toLowerCase();

  return (adviceRows || []).reduce((sum, row) => {
    if (String(row.symbol || '').toUpperCase() !== normalizedSymbol) return sum;
    if (String(row.position_type || '').toLowerCase() !== normalizedPositionType) return sum;

    const actionLabel = String(row.opus_review?.actionLabel || '').toLowerCase();
    if (!['trim', 'reduce', 'cover'].includes(actionLabel)) return sum;

    return sum + Math.abs(Number(row.executed_shares || 0));
  }, 0);
}

function getLatestUnimplementedAdviceRow(symbol, positionType, adviceRows = []) {
  const normalizedSymbol = String(symbol || '').toUpperCase();
  const normalizedPositionType = String(positionType || '').toLowerCase();

  return (adviceRows || []).find(row => {
    if (String(row.symbol || '').toUpperCase() !== normalizedSymbol) return false;
    if (String(row.position_type || '').toLowerCase() !== normalizedPositionType) return false;
    return !Boolean(row.implemented);
  }) || null;
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

function buildRecommendationChangeKey(symbol, positionType, changeType, summary) {
  return [
    String(symbol || '').toUpperCase(),
    String(positionType || '').toLowerCase(),
    String(changeType || '').toLowerCase(),
    String(summary || '').trim().toLowerCase()
  ].join(':');
}

function buildPortfolioHubAccountBreakdown(holdings = [], accounts = []) {
  const accountNameById = new Map((accounts || []).map(account => [account.id, account.name]));
  const grouped = new Map();

  for (const holding of holdings || []) {
    const symbol = String(holding.symbol || '').toUpperCase();
    if (!symbol) continue;
    const positionType = String(holding.positionType || 'long').toLowerCase();
    const accountEntries = Array.isArray(holding.accountBreakdown) ? holding.accountBreakdown : [];
    const key = `${symbol}:${positionType}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        symbol,
        positionType,
        entries: []
      });
    }

    const row = grouped.get(key);
    for (const entry of accountEntries) {
      const shares = Math.abs(Number(entry.shares || 0));
      if (!Number.isFinite(shares) || shares <= 0) continue;
      row.entries.push({
        accountName: entry.accountName || accountNameById.get(entry.accountId) || 'Unknown',
        shares
      });
    }
  }

  return [...grouped.values()]
    .map(row => ({
      ...row,
      entries: row.entries.sort((a, b) => (
        a.accountName.localeCompare(b.accountName) || a.shares - b.shares
      ))
    }))
    .sort((a, b) => (
      a.symbol.localeCompare(b.symbol) || a.positionType.localeCompare(b.positionType)
    ));
}

function confidenceScore(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'high') return 15;
  if (normalized === 'medium') return 8;
  if (normalized === 'low') return 3;
  return 0;
}

function classifyReviewActionTaxonomy(item = {}) {
  const action = String(item.actionLabel || '').toLowerCase();
  const summary = String(item.summary || '').toLowerCase();
  const detail = String(item.detail || '').toLowerCase();

  if (action === 'trim' && (summary.includes('start') || detail.includes('start'))) return 'trim_and_start';
  if (action === 'trim') return 'trim_existing';
  if (action === 'reduce') return 'rotate_from_existing';
  if (action === 'add') return 'add_to_existing';
  if (action === 'cover') return 'cover_short';
  return 'hold_existing';
}

function classifyRecommendedPositionTaxonomy(item = {}) {
  const relationship = String(item.relationshipType || '').toLowerCase();
  const direction = String(item.direction || '').toLowerCase();
  if (relationship === 'existing_holding') return 'add_to_existing';
  if (relationship === 'replacement_candidate') return 'rotate_from_existing';
  if (direction === 'short') return 'start_short';
  return 'start_new';
}

function scoreRecommendedPositionItem(item = {}, portfolioHub = {}, stockInfoMap = new Map()) {
  const symbol = String(item.symbol || '').toUpperCase();
  const relationship = String(item.relationshipType || '').toLowerCase();
  const direction = String(item.direction || '').toLowerCase();
  const info = stockInfoMap.get(symbol) || {};
  const sectorKey = String(info.sector || '').trim().toLowerCase();
  const sectorWeight = Number((portfolioHub.sectorAllocation || []).find(row => String(row.sector || '').trim().toLowerCase() === sectorKey)?.weightPct || 0);
  const cashPct = Number(portfolioHub.summary?.cashPct || 0);

  const breakdown = {
    conviction: confidenceScore(item.conviction),
    longBias: direction === 'long' ? 10 : 2,
    diversification: relationship === 'complementary' ? 12 : relationship === 'replacement_candidate' ? 7 : 3,
    sectorPenalty: sectorWeight >= PORTFOLIO_HUB_POLICY.long.sectorConcentrationThresholdPct ? -12 : Math.max(0, 8 - Math.round(sectorWeight / 5)),
    cashSupport: cashPct >= 10 ? 8 : cashPct >= 5 ? 4 : 0,
    pathwayBonus: item.pathway ? 5 : 0
  };

  const score = Object.values(breakdown).reduce((sum, value) => sum + Number(value || 0), 0);
  return { score, breakdown };
}

function passesRecommendedPositionQualityGate(item = {}) {
  const conviction = String(item.conviction || '').toLowerCase();
  const score = Number(item.deterministicScore || 0);
  if (!PORTFOLIO_HUB_RECOMMENDATION_ALLOWED_CONVICTIONS.has(conviction)) {
    return false;
  }
  if (conviction === 'high') {
    return true;
  }
  return score >= PORTFOLIO_HUB_RECOMMENDATION_MIN_SCORE;
}

function normalizeRecommendedPositionAlertShape(item = {}) {
  return {
    symbol: String(item.symbol || '').toUpperCase(),
    direction: item.direction || null,
    conviction: item.conviction || null,
    starterShares: item.starterShares ?? item.starter_shares ?? null,
    starterPositionValue: item.starterPositionValue ?? item.starter_position_value ?? null,
    entryZone: item.entryZone ?? item.entry_zone ?? null,
    stopLoss: item.stopLoss ?? item.stop_loss ?? null,
    takeProfit: item.takeProfit ?? item.take_profit ?? null,
    targetFramework: item.targetFramework ?? item.target_framework ?? null,
    relationshipType: item.relationshipType ?? item.relationship_type ?? null,
    relatedHoldingSymbol: item.relatedHoldingSymbol ?? item.related_holding_symbol ?? null,
    relatedHoldingAction: item.relatedHoldingAction ?? item.related_holding_action ?? null,
    pathway: item.pathway ?? null,
    deterministicScore: item.deterministicScore ?? item.deterministic_score ?? null,
    deterministicRank: item.deterministicRank ?? item.deterministic_rank ?? null
  };
}

function diffRecommendedPositionRuns(previousRun = null, currentRun = null) {
  const previousItems = Array.isArray(previousRun?.items) ? previousRun.items.map(normalizeRecommendedPositionAlertShape) : [];
  const currentItems = Array.isArray(currentRun?.items) ? currentRun.items.map(normalizeRecommendedPositionAlertShape) : [];
  const previousMap = new Map(previousItems.map(item => [item.symbol, item]));
  const currentMap = new Map(currentItems.map(item => [item.symbol, item]));

  const added = currentItems.filter(item => !previousMap.has(item.symbol));
  const removed = previousItems.filter(item => !currentMap.has(item.symbol));
  const changed = [];

  for (const item of currentItems) {
    const previous = previousMap.get(item.symbol);
    if (!previous) continue;

    const changedFields = PORTFOLIO_HUB_RECOMMENDATION_DIFF_FIELDS.filter(field => {
      return JSON.stringify(previous[field] ?? null) !== JSON.stringify(item[field] ?? null);
    });

    if (changedFields.length) {
      changed.push({
        symbol: item.symbol,
        changedFields,
        previous,
        current: item
      });
    }
  }

  return {
    added,
    removed,
    changed,
    previousRun: previousRun ? { id: previousRun.id, generated_at: previousRun.generated_at } : null,
    currentRun: currentRun ? { id: currentRun.id, generated_at: currentRun.generated_at } : null
  };
}

async function sendPortfolioHubRecommendationDiffEmail(previousRun, currentRun) {
  const diff = diffRecommendedPositionRuns(previousRun, currentRun);
  if (!diff.added.length && !diff.changed.length) {
    return diff;
  }

  await email.sendPortfolioHubRecommendationAlert(diff);
  return diff;
}

function scoreReviewItem(item = {}, holding = {}) {
  const action = String(item.actionLabel || '').toLowerCase();
  const pnlPct = Math.abs(Number(holding.unrealizedPnLPct || 0));
  const weightPct = Number(holding.weightPct || 0);
  const breakdown = {
    conviction: confidenceScore(item.confidence),
    actionUrgency: ['trim', 'reduce', 'cover'].includes(action) ? 12 : action === 'add' ? 8 : 2,
    concentration: Math.min(12, Math.round(weightPct)),
    pnlMagnitude: Math.min(10, Math.round(pnlPct / 2)),
    ruleClarity: item.shareCountText ? 6 : 2
  };
  const score = Object.values(breakdown).reduce((sum, value) => sum + Number(value || 0), 0);
  return { score, breakdown };
}

function safeDateValue(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function normalizeNumericField(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 0 ? numeric : null;
}

function buildChangeItems(currentRow, previousAdviceRow) {
  const currentReview = currentRow?.opusReview || null;
  if (!currentReview) return [];

  const previousReview = buildPersistedOpusReview(previousAdviceRow?.opus_review);
  const currentAction = String(currentReview.actionLabel || 'Hold').trim();
  const previousAction = String(previousReview?.actionLabel || 'Hold').trim();
  const currentShareText = String(currentReview.shareCountText || '').trim();
  const previousShareText = String(previousReview?.shareCountText || '').trim();
  const currentStopLoss = normalizeNumericField(currentReview.stopLoss);
  const previousStopLoss = normalizeNumericField(previousReview?.stopLoss);
  const currentTakeProfit = normalizeNumericField(currentReview.takeProfit);
  const previousTakeProfit = normalizeNumericField(previousReview?.takeProfit);
  const items = [];
  const hasPreviousReview = Boolean(previousReview);
  const currentHasAction = currentAction && currentAction.toLowerCase() !== 'hold';
  const currentHasShares = Boolean(currentShareText);
  const currentHasStopLoss = currentStopLoss != null;
  const currentHasTakeProfit = currentTakeProfit != null;

  if (!hasPreviousReview) {
    if (currentHasAction || currentHasShares) {
      items.push({
        type: 'shares',
        summary: currentShareText || currentReview.summary || `${currentAction} recommendation added`,
        previous: null
      });
    }
    if (currentHasStopLoss) {
      items.push({
        type: 'stop_loss',
        summary: `Stop loss added at ${currentStopLoss.toFixed(2)}`,
        previous: null
      });
    }
    if (currentHasTakeProfit) {
      items.push({
        type: 'target',
        summary: `Price target added at ${currentTakeProfit.toFixed(2)}`,
        previous: null
      });
    }
    return items;
  }

  if (currentAction !== previousAction || currentShareText !== previousShareText) {
    items.push({
      type: 'shares',
      summary: currentShareText || currentReview.summary || `${currentAction} recommendation updated`,
      previous: previousShareText || previousReview?.summary || previousAction || null
    });
  }

  if (currentStopLoss !== previousStopLoss) {
    items.push({
      type: 'stop_loss',
      summary: currentStopLoss == null
        ? 'Stop loss removed'
        : previousStopLoss == null
          ? `Stop loss added at ${currentStopLoss.toFixed(2)}`
          : `Stop loss changed to ${currentStopLoss.toFixed(2)}`,
      previous: previousStopLoss == null ? null : previousStopLoss.toFixed(2)
    });
  }

  if (currentTakeProfit !== previousTakeProfit) {
    items.push({
      type: 'target',
      summary: currentTakeProfit == null
        ? 'Price target removed'
        : previousTakeProfit == null
          ? `Price target added at ${currentTakeProfit.toFixed(2)}`
          : `Price target changed to ${currentTakeProfit.toFixed(2)}`,
      previous: previousTakeProfit == null ? null : previousTakeProfit.toFixed(2)
    });
  }

  return items;
}

async function syncPortfolioHubRecommendationChanges(holdings = [], adviceHistoryByKey = new Map()) {
  const existingRows = await db.listPortfolioHubRecommendationChanges().catch(() => []);
  const existingByKey = new Map((existingRows || []).map(row => [String(row.change_key || ''), row]));
  const activeKeys = new Set();

  for (const row of holdings) {
    if (!row.opusReview) continue;
    const history = adviceHistoryByKey.get(buildAdviceKey(row.symbol, row.positionType)) || [];
    const latestRow = history[0] || null;
    const previousRow = history[1] || null;
    const changeItems = buildChangeItems(row, previousRow);
    const changeTimestamp = latestRow?.opus_review_created_at || latestRow?.created_at || row.opusReviewCreatedAt || null;

    for (const item of changeItems) {
      const changeKey = buildRecommendationChangeKey(row.symbol, row.positionType, item.type, item.summary);
      activeKeys.add(changeKey);
      if (existingByKey.has(changeKey)) continue;

      await db.savePortfolioHubRecommendationChange({
        symbol: row.symbol,
        positionType: row.positionType,
        recommendation: row.whiskieActionLabel || 'Hold',
        sourceLabel: 'opus_change',
        opusReview: row.opusReview,
        opusReviewCreatedAt: changeTimestamp,
        actionTaxonomy: classifyReviewActionTaxonomy(row.opusReview || {}),
        changeKey,
        changeType: item.type,
        changeSummary: item.summary,
        changePreviousValue: item.previous
      }).catch(() => null);
    }
  }

  await db.deletePortfolioHubRecommendationChangesNotInKeys([...activeKeys]).catch(() => null);
}

function summarizeHoldingAction(row) {
  const action = String(row.whiskieActionLabel || 'Hold').trim();
  const summary = String(row.whiskieView || '').trim();
  const shareCount = String(row.whiskieShareCountText || '').trim();
  return [action, shareCount || summary].filter(Boolean).slice(0, 2).join(' — ');
}

async function cleanupLegacyPortfolioHubAdviceHistory() {
  const cutoff = process.env.PORTFOLIO_HUB_CHANGE_RESET_BEFORE;
  if (!cutoff) return;
  await db.deleteLegacyPortfolioHubAdviceRowsBefore(cutoff).catch(() => null);
}

function buildRecommendedPositionCandidates({ holdings = [], saturdayRows = [], dailyStates = [] }) {
  const heldSymbols = new Set((holdings || []).map(row => String(row.symbol || '').toUpperCase()).filter(Boolean));
  const candidates = new Map();

  for (const row of saturdayRows || []) {
    const symbol = String(row.symbol || '').toUpperCase();
    if (!symbol) continue;
    candidates.set(symbol, {
      symbol,
      source: 'watchlist',
      pathway: row.primary_pathway || row.pathway || null,
      intent: row.intent || null,
      score: Number(row.opus_conviction || row.score || 0),
      reasons: row.reasons || null,
      held: heldSymbols.has(symbol)
    });
  }

  for (const row of dailyStates || []) {
    const symbol = String(row.symbol || '').toUpperCase();
    if (!symbol || candidates.has(symbol)) continue;
    candidates.set(symbol, {
      symbol,
      source: 'daily_state',
      pathway: row.primary_pathway || null,
      intent: row.last_action || null,
      score: Number(row.conviction_score || 0),
      reasons: row.thesis_summary || null,
      held: heldSymbols.has(symbol)
    });
  }

  return [...candidates.values()]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 20);
}

function inferRelatedHoldingForRecommendation(item, holdings = [], stockInfoMap = new Map()) {
  const symbol = String(item.symbol || '').toUpperCase();
  const candidateInfo = stockInfoMap.get(symbol) || null;
  const candidateSector = String(candidateInfo?.sector || '').trim().toLowerCase();
  const candidateIndustry = String(candidateInfo?.industry || '').trim().toLowerCase();
  const candidatePathway = String(item.pathway || '').trim().toLowerCase();

  const directHolding = (holdings || []).find(row => String(row.symbol || '').toUpperCase() === symbol);
  if (directHolding) {
    return {
      relationshipType: 'existing_holding',
      relatedHoldingSymbol: directHolding.symbol,
      relatedHoldingAction: 'Manage this through Combined Holdings / Latest Recommendation Changes'
    };
  }

  const overlappingHolding = (holdings || []).find(row => {
    const info = stockInfoMap.get(String(row.symbol || '').toUpperCase()) || null;
    const holdingSector = String(info?.sector || row.sector || '').trim().toLowerCase();
    const holdingIndustry = String(info?.industry || '').trim().toLowerCase();
    const holdingPathway = String(row.whiskiePathway || '').trim().toLowerCase();
    return (
      (candidateIndustry && holdingIndustry && candidateIndustry === holdingIndustry) ||
      (candidateSector && holdingSector && candidateSector === holdingSector && candidatePathway && holdingPathway && candidatePathway === holdingPathway)
    );
  });

  if (!overlappingHolding) {
    return {
      relationshipType: 'complementary',
      relatedHoldingSymbol: null,
      relatedHoldingAction: null
    };
  }

  return {
    relationshipType: 'replacement_candidate',
    relatedHoldingSymbol: overlappingHolding.symbol,
    relatedHoldingAction: `Compare against existing ${overlappingHolding.symbol} before adding`
  };
}

function enforceRecommendedPositionConstraints(items = [], portfolioHub = {}, stockInfoMap = new Map()) {
  const sectorWeights = new Map((portfolioHub.sectorAllocation || []).map(row => [String(row.sector || '').trim().toLowerCase(), Number(row.weightPct || 0)]));
  const holdings = portfolioHub.holdings || [];
  const filtered = [];
  const seenSectors = new Set();

  for (const item of items) {
    const symbol = String(item.symbol || '').toUpperCase();
    const stockInfo = stockInfoMap.get(symbol) || null;
    const sector = String(stockInfo?.sector || '').trim();
    const sectorKey = sector.toLowerCase();
    const relationship = inferRelatedHoldingForRecommendation(item, holdings, stockInfoMap);
    const isExistingHolding = relationship.relationshipType === 'existing_holding';
    const currentSectorWeight = sectorWeights.get(sectorKey) || 0;
    const exceedsSector = sector && currentSectorWeight >= PORTFOLIO_HUB_POLICY.long.sectorConcentrationThresholdPct;

    if (!isExistingHolding && exceedsSector && relationship.relationshipType !== 'replacement_candidate') {
      continue;
    }

    if (!isExistingHolding && sector && seenSectors.has(sectorKey) && relationship.relationshipType !== 'replacement_candidate') {
      continue;
    }

    filtered.push({
      ...item,
      relationshipType: relationship.relationshipType,
      relatedHoldingSymbol: relationship.relatedHoldingSymbol,
      relatedHoldingAction: relationship.relatedHoldingAction,
      sectorImpact: item.sectorImpact || (
        sector
          ? `${sector} currently ${currentSectorWeight.toFixed(1)}% of portfolio`
          : 'Sector impact unavailable'
      ),
      portfolioFit: item.portfolioFit || (
        relationship.relationshipType === 'replacement_candidate'
          ? `Potential replacement candidate for ${relationship.relatedHoldingSymbol}`
          : relationship.relationshipType === 'existing_holding'
            ? 'Already held; treat as add/upgrade through holdings workflow'
            : 'Adds diversification without obvious holding overlap'
      )
    });

    if (sector) seenSectors.add(sectorKey);
    if (filtered.length >= 5) break;
  }

  return filtered;
}

function buildRecommendedPositionsFreshness(run) {
  if (!run?.generated_at) {
    return { status: 'missing', label: 'Not run yet' };
  }

  const generatedAt = new Date(run.generated_at);
  if (Number.isNaN(generatedAt.getTime())) {
    return { status: 'unknown', label: 'Unknown freshness' };
  }

  const ageMs = Date.now() - generatedAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays < 1) {
    return { status: 'fresh', label: 'Fresh' };
  }
  if (ageDays < 3) {
    return { status: 'stale', label: 'Stale' };
  }
  return { status: 'expired', label: 'Needs refresh' };
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
      const results = await newsCacheService.getStructuredStockContext(row.symbol, {
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
      const result = await profileBuildService.ensureFreshProfile(symbol, { staleAfterDays: 14, incrementalRefreshDays: 14 });
      built.push({ symbol, action: result?.action || 'built' });
    } catch (error) {
      built.push({ symbol, action: 'failed', error: error.message });
    }
  }

  return built;
}

function shouldIncrementalReviewHolding(row) {
  if (!row) return false;
  if (!row.opusReviewCreatedAt) return true;

  const lastReview = new Date(row.opusReviewCreatedAt);
  if (Number.isNaN(lastReview.getTime())) return true;

  const ageDays = (Date.now() - lastReview.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays >= 7) return true;
  if (Math.abs(Number(row.unrealizedPnLPct || 0)) >= 10) return true;
  if (row.nextEarningsDate) {
    const earningsDate = new Date(row.nextEarningsDate);
    if (!Number.isNaN(earningsDate.getTime())) {
      const daysToEarnings = (earningsDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysToEarnings <= 7) return true;
    }
  }

  return false;
}

function pickDirectionalAdvice(row, latestAdviceRows = []) {
  const byDirection = (latestAdviceRows || [])
    .filter(candidate => String(candidate.symbol || '').toUpperCase() === String(row.symbol || '').toUpperCase())
    .filter(candidate => String(candidate.position_type || '').toLowerCase() === String(row.positionType || '').toLowerCase())
    .sort((a, b) => new Date(b.opus_review_created_at || b.created_at || 0) - new Date(a.opus_review_created_at || a.created_at || 0));

  if (byDirection.length) {
    return byDirection[0];
  }

  return null;
}

export async function buildPortfolioHubView(options = {}) {
  await cleanupLegacyPortfolioHubAdviceHistory();
  const performanceRange = ['week', 'month'].includes(String(options.performanceRange || 'week'))
    ? String(options.performanceRange || 'week')
    : 'week';
  const performanceMetric = String(options.performanceMetric || 'pct') === 'value' ? 'value' : 'pct';
  const shouldPersistHistory = options.persistHistory === true;

  await db.seedPortfolioHubAccounts(DEFAULT_PORTFOLIO_HUB_ACCOUNTS).catch(() => {});

  const [accounts, transactions, latestRecommendedRun, latestReviewRun] = await Promise.all([
    db.getPortfolioHubAccounts().catch(() => []),
    db.listPortfolioHubTransactions().catch(() => []),
    db.getLatestPortfolioHubRecommendedPositionRun().catch(() => null),
    db.getLatestPortfolioHubReviewRun().catch(() => null)
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
      grouped.set(groupKey, {
        symbol,
        shares: 0,
        totalCost: 0,
        accounts: [],
        accountBreakdown: new Map(),
        positionType
      });
    }

    const row = grouped.get(groupKey);
    const shares = Number(tx.shares || 0);
    const price = Number(tx.price || 0);
    const signedShares = ['buy', 'short'].includes(type) ? shares : ['sell', 'cover'].includes(type) ? -shares : shares;
    const existingAbsShares = Math.abs(Number(row.shares || 0));
    const avgCostBeforeTrade = existingAbsShares > 0 ? Number(row.totalCost || 0) / existingAbsShares : 0;

    row.shares += signedShares;
    if (['buy', 'short'].includes(type)) {
      row.totalCost += Math.abs(signedShares) * price;
    } else if (['sell', 'cover'].includes(type)) {
      row.totalCost = Math.max(0, Number(row.totalCost || 0) - (Math.abs(signedShares) * avgCostBeforeTrade));
    }
    row.accounts.push(tx.account_name);
    const accountKey = tx.account_id || tx.account_name || 'unknown';
    const accountEntry = row.accountBreakdown.get(accountKey) || {
      accountId: tx.account_id || null,
      accountName: tx.account_name || 'Unknown',
      shares: 0
    };
    accountEntry.shares += signedShares;
    accountEntry.accountName = tx.account_name || accountEntry.accountName;
    row.accountBreakdown.set(accountKey, accountEntry);
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
  const adviceHistoryByKey = new Map();
  (latestAdviceRows || []).forEach(row => {
    const key = buildAdviceKey(row.symbol, row.position_type);
    const list = adviceHistoryByKey.get(key) || [];
    list.push(row);
    adviceHistoryByKey.set(key, list);
  });
  adviceHistoryByKey.forEach(list => list.sort((a, b) => safeDateValue(b.opus_review_created_at || b.created_at) - safeDateValue(a.opus_review_created_at || a.created_at)));
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
    const latestAdvice = getLatestUnimplementedAdviceRow(symbol, row.positionType, latestAdviceRows)
      || latestAdviceMap.get(buildAdviceKey(symbol, row.positionType))
      || pickDirectionalAdvice(row, latestAdviceRows)
      || null;
    const persistedOpusReview = buildPersistedOpusReview(latestAdvice?.opus_review);
    if (persistedOpusReview) {
      persistedOpusReview.createdAt = latestAdvice?.opus_review_created_at || latestAdvice?.created_at || null;
      const transactionExecutedShares = computeExecutedPlanShares(row, persistedOpusReview, transactions);
      const historicalExecutedShares = sumExecutedAdviceShares(symbol, row.positionType, latestAdviceRows);
      persistedOpusReview.executedShares = Math.max(transactionExecutedShares, historicalExecutedShares);
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
      accountBreakdown: [...(row.accountBreakdown?.values() || [])]
        .filter(entry => Math.abs(Number(entry.shares || 0)) >= 0.0001)
        .sort((a, b) => String(a.accountName || '').localeCompare(String(b.accountName || ''))),
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
  const holdingsAccountBreakdown = buildPortfolioHubAccountBreakdown(holdings, accounts);

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
          const actionPriority = action => {
            const normalized = String(action || '').toLowerCase();
            if (normalized === 'trim') return 3;
            if (normalized === 'reduce') return 2;
            if (normalized === 'hold') return 1;
            return 0;
          };
          const scoreA = actionPriority(a.whiskieActionLabel) * 1000 + (a.weightPct || 0) * 10 + Math.max(Number(a.unrealizedPnLPct || 0), 0);
          const scoreB = actionPriority(b.whiskieActionLabel) * 1000 + (b.weightPct || 0) * 10 + Math.max(Number(b.unrealizedPnLPct || 0), 0);
          return scoreB - scoreA;
        })
        .slice(0, 3)
        .map(holding => ({
          symbol: holding.symbol,
          action: holding.whiskieShareCountText || holding.whiskieView || holding.whiskieActionLabel || (holding.unrealizedPnLPct > 15 ? 'trim 15-25%' : holding.weightPct > 10 ? 'trim 10-20%' : 'reduce 5-10%'),
          rationale: [
            `weight ${holding.weightPct.toFixed(1)}%`,
            `P/L ${holding.unrealizedPnLPct.toFixed(1)}%`,
            holding.whiskiePathway ? `pathway ${holding.whiskiePathway}` : null,
            holding.whiskieSource ? `source ${holding.whiskieSource}` : null
          ].filter(Boolean).join(', ')
        }));

      return {
        sector: row.sector,
        sectorWeightPct: row.weightPct,
        candidates
      };
    });

  const historyStart = selectHistoryWindow(performanceRange);
  const adviceHistory = await db.getPortfolioHubAdviceHistorySince(historyStart).catch(() => []);
  const historyRows = adviceHistory
    .filter(row => String(row.view_scope || 'day') === performanceRange)
    .filter(row => !row.change_key);
  const accountGroup = 'default';
  await db.upsertPortfolioHubBaseline(accountGroup, historyStart.toISOString().split('T')[0], totalValue, holdings).catch(() => null);
  const explicitBaseline = await db.getPortfolioHubBaseline(accountGroup, historyStart.toISOString().split('T')[0]).catch(() => null);
  const baselineTotalValue = Number(explicitBaseline?.total_value || totalValue);
  const performancePct = baselineTotalValue > 0 ? ((totalValue - baselineTotalValue) / baselineTotalValue) * 100 : 0;
  const performanceValue = totalValue - baselineTotalValue;
  const longPerformancePct = 0;
  const shortPerformancePct = 0;
  const longPerformanceValue = 0;
  const shortPerformanceValue = 0;
  const benchmarkSymbol = 'SPY';
  const benchmarkReturnPct = 0;
  const activeReturnPct = 0;
  const benchmarkReturnValue = 0;
  const activeReturnValue = 0;
  const benchmarkHistorySeries = [];
  const riskMetrics = portfolioRiskMetrics.getEmptyMetrics();
  const etfRotationContext = await etfManager.getRotationAwareSummary().catch(() => ({ leading: [], lagging: [], availableETFs: [] }));
  const performanceSeries = (historyRows.length >= 2 ? historyRows : [])
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
  if (etfRotationContext.leading?.length) {
    insights.push(`Leading ETF rotation groups: ${etfRotationContext.leading.slice(0, 3).map(item => `${item.sector} (${item.etf})`).join(', ')}.`);
  }
  if (etfRotationContext.lagging?.length) {
    insights.push(`Lagging ETF rotation groups: ${etfRotationContext.lagging.slice(0, 3).map(item => `${item.sector} (${item.etf})`).join(', ')}.`);
  }
  insights.push(`Current sizing policy targets: max long target weight ${PORTFOLIO_HUB_POLICY.long.maxTargetWeightPct}%, max short concentration ${PORTFOLIO_HUB_POLICY.short.concentrationWeightPct}%, max sector concentration ${PORTFOLIO_HUB_POLICY.long.sectorConcentrationThresholdPct}%.`);
  sectorTrimCandidates.forEach(item => {
    if (!item.candidates.length) return;
    insights.push(`Reduce ${item.sector} exposure (${item.sectorWeightPct.toFixed(1)}%): ${item.candidates.map(candidate => `${candidate.symbol} ${candidate.action} (${candidate.rationale})`).join(', ')}.`);
  });
  const explicitActions = holdings.filter(row => row.whiskieView || row.whiskieShareCountText).slice(0, 5).map(row => `${row.symbol}: ${summarizeHoldingAction(row)}`);
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
        recommendation: summarizeHoldingAction(row),
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
        opusReviewCreatedAt: row.opusReviewCreatedAt,
        benchmarkSymbol,
        benchmarkReturnPct,
        benchmarkReturnValue,
        activeReturnPct,
        activeReturnValue,
        riskMetrics,
        etfRotationContext
      }))
    ).catch(() => {});
  }

  await syncPortfolioHubRecommendationChanges(holdings, adviceHistoryByKey);
  const recommendationChanges = (await db.listPortfolioHubRecommendationChanges().catch(() => []))
    .map(row => ({
      id: row.id,
      symbol: row.symbol,
      positionType: row.position_type,
      actionLabel: row.recommendation,
      changeType: row.change_type || String(row.change_key || '').split(':')[2] || 'shares',
      actionTaxonomy: row.action_taxonomy || null,
      summary: row.change_summary,
      previous: row.change_previous_value,
      createdAt: row.opus_review_created_at || row.created_at,
      deterministicScore: row.deterministic_score != null ? Number(row.deterministic_score) : null,
      scoringBreakdown: row.scoring_breakdown || null,
      implemented: Boolean(row.implemented),
      implementedAt: row.implemented_at || null
    }))
    .sort((a, b) => safeDateValue(b.createdAt) - safeDateValue(a.createdAt));

  return {
    accounts,
    holdings,
    holdingsAccountBreakdown,
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
      shortPerformanceValue,
      benchmarkSymbol,
      benchmarkReturnPct,
      benchmarkReturnValue,
      activeReturnPct,
      activeReturnValue
    },
    insights,
    sectorTrimCandidates,
    performanceSeries,
    benchmarkHistorySeries,
    riskMetrics,
    etfRotationContext,
    performanceRange,
    performanceMetric,
    latestFullReviewAt,
    latestReviewRun,
    recommendationChanges,
    recommendedPositionsRun: latestRecommendedRun
      ? {
          ...latestRecommendedRun,
          freshness: buildRecommendedPositionsFreshness(latestRecommendedRun)
        }
      : null
  };
}

export async function runPortfolioHubRecommendedPositions() {
  const acquired = await db.acquirePortfolioHubAdvisoryLock(
    PORTFOLIO_HUB_LOCKS.recommendedPositions,
    `pid-${process.pid}-recommended`,
    { type: 'recommended_positions' }
  ).catch(() => false);
  if (!acquired) {
    return db.getLatestPortfolioHubRecommendedPositionRun().catch(() => null);
  }
  try {
  const previousRun = await db.getLatestPortfolioHubRecommendedPositionRun().catch(() => null);
  const portfolioHub = await buildPortfolioHubView({ performanceRange: 'day', performanceMetric: 'pct', persistHistory: false });
  const [dailyStates, saturdayRows] = await Promise.all([
    db.getLatestDailySymbolStates().catch(() => []),
    db.getCanonicalSaturdayWatchlistRows(['active', 'pending'], { includePromoted: true }).catch(() => [])
  ]);

  const candidates = buildRecommendedPositionCandidates({
    holdings: portfolioHub.holdings || [],
    saturdayRows,
    dailyStates
  });

  const candidateSymbols = candidates.map(item => item.symbol);
  const { quoteMap, whiskieContextMap, stockInfoMap, technicalsMap } = await buildPortfolioHubSymbolContext(candidateSymbols);
  const marketContext = await buildPortfolioHubMarketContext(portfolioHub);

  const prompt = `You are generating Recommended New Positions for a household portfolio dashboard called Portfolio Hub. Return JSON only.

Goal:
- find long-term holdings and medium-term swing opportunities
- avoid short-term trades, day trades, scalp trades, or intraday churn
- prefer early discovery of future compounders when justified
- keep shorts highly selective

Return an array of up to 5 ideas. Each idea must include:
- symbol
- direction: LONG or SHORT
- horizonLabel: Long-term core, Long-term starter, Medium-term swing, or Selective short
- conviction: low, medium, or high
- starterShares: integer
- starterPositionValue: dollar amount
- entryZone
- stopLoss
- takeProfit
- targetFramework
- pathway
- thesis
- whyNow
- portfolioFit
- sectorImpact
- invalidation
- relationshipType: complementary, replacement_candidate, or existing_holding
- relatedHoldingSymbol
- relatedHoldingAction
- modelReasoning

Rules:
- No short-term trades
- Use current portfolio concentration, cash, regime, and sector exposure
- Prefer staged entries over oversized immediate buys
- Focus on watchlist-plus-held-symbol discovery context, but recommend new positions, not holding maintenance
- Be selective and practical
- If a candidate overlaps with an existing holding by sector, industry, or pathway, explicitly decide whether it is complementary or a replacement candidate
- If it is a replacement candidate, identify the related held symbol and what action should be considered

Portfolio summary:
${JSON.stringify(portfolioHub.summary, null, 2)}

Sector allocation:
${JSON.stringify(portfolioHub.sectorAllocation || [], null, 2)}

Market context:
${JSON.stringify(marketContext.summary, null, 2)}

Current holdings:
${JSON.stringify((portfolioHub.holdings || []).map(row => ({
  symbol: row.symbol,
  positionType: row.positionType,
  weightPct: row.weightPct,
  marketValue: row.marketValue,
  sector: row.sector,
  whiskiePathway: row.whiskiePathway,
  whiskieHoldingPosture: row.whiskieHoldingPosture
})), null, 2)}

Candidates:
${JSON.stringify(candidates.map(item => ({
  ...item,
  quote: quoteMap.get(item.symbol) || null,
  technicals: technicalsMap.get(item.symbol) || null,
  whiskieContext: whiskieContextMap.get(item.symbol) || null,
  stockInfo: stockInfoMap.get(item.symbol) || null
})), null, 2)}`;

  const response = await claude.analyze(prompt, { model: 'opus' });
  const rawText = String(response?.analysis || '').trim();
  const startIndex = rawText.search(/[\[{]/);
  const endIndex = Math.max(rawText.lastIndexOf('}'), rawText.lastIndexOf(']'));
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error('Portfolio Hub recommended positions did not return JSON');
  }

  const parsed = JSON.parse(rawText.slice(startIndex, endIndex + 1));
  const rawItems = (Array.isArray(parsed) ? parsed : parsed.items || [])
    .slice(0, 5)
    .map(item => ({
      symbol: String(item.symbol || '').toUpperCase(),
      direction: String(item.direction || 'LONG').toUpperCase(),
      horizonLabel: item.horizonLabel || null,
      conviction: item.conviction || null,
      starterShares: Number.isFinite(Number(item.starterShares)) ? Number(item.starterShares) : null,
      starterPositionValue: Number.isFinite(Number(item.starterPositionValue)) ? Number(item.starterPositionValue) : null,
      entryZone: item.entryZone || null,
      stopLoss: Number.isFinite(Number(item.stopLoss)) ? Number(item.stopLoss) : null,
      takeProfit: Number.isFinite(Number(item.takeProfit)) ? Number(item.takeProfit) : null,
      targetFramework: item.targetFramework || null,
      pathway: item.pathway || null,
      thesis: item.thesis || null,
      whyNow: item.whyNow || null,
      portfolioFit: item.portfolioFit || null,
      sectorImpact: item.sectorImpact || null,
      invalidation: item.invalidation || null,
      modelReasoning: item.modelReasoning || null,
      rawModelPayload: item
    }))
    .filter(item => item.symbol);

  const items = enforceRecommendedPositionConstraints(rawItems, portfolioHub, stockInfoMap)
    .map(item => {
      const scoring = scoreRecommendedPositionItem(item, portfolioHub, stockInfoMap);
      return {
        ...item,
        actionTaxonomy: classifyRecommendedPositionTaxonomy(item),
        deterministicScore: scoring.score,
        scoringBreakdown: scoring.breakdown
      };
    })
    .filter(item => passesRecommendedPositionQualityGate(item))
    .sort((a, b) => Number(b.deterministicScore || 0) - Number(a.deterministicScore || 0))
    .map((item, index) => ({
      ...item,
      deterministicRank: index + 1
    }))
    .slice(0, 5);

  const run = await db.createPortfolioHubRecommendedPositionRun({
    sourceLabel: 'opus',
    marketContext: marketContext.summary,
    portfolioSnapshot: {
      summary: portfolioHub.summary,
      sectorAllocation: portfolioHub.sectorAllocation,
      holdingsCount: (portfolioHub.holdings || []).length
    },
    notes: `Generated ${items.length} recommended position ideas`,
    rawModelPayload: parsed
  });

  await db.replacePortfolioHubRecommendedPositionItems(run.id, items);

  const currentRun = {
    ...run,
    items
  };

  try {
    await sendPortfolioHubRecommendationDiffEmail(previousRun, currentRun);
  } catch (error) {
    console.error('❌ Failed to send Portfolio Hub recommendation diff email:', error);
  }

  return currentRun;
  } finally {
    await db.releasePortfolioHubAdvisoryLock(PORTFOLIO_HUB_LOCKS.recommendedPositions).catch(() => null);
  }
}

export async function runPortfolioHubOpusReview() {
  const acquired = await db.acquirePortfolioHubAdvisoryLock(
    PORTFOLIO_HUB_LOCKS.opusReview,
    `pid-${process.pid}-review`,
    { type: 'opus_review' }
  ).catch(() => false);
  if (!acquired) {
    return { reviewedAt: new Date().toISOString(), holdings: [], skipped: 'already_running' };
  }
  try {
  const portfolioHub = await buildPortfolioHubView({ performanceRange: 'day', performanceMetric: 'pct', persistHistory: false });
  const holdings = Array.isArray(portfolioHub.holdings) ? portfolioHub.holdings : [];
  if (!holdings.length) {
    return { reviewedAt: new Date().toISOString(), holdings: [] };
  }
  const holdingsToReview = holdings.filter(shouldIncrementalReviewHolding);
  if (!holdingsToReview.length) {
    return { reviewedAt: new Date().toISOString(), holdings: [] };
  }
  const { technicalsMap } = await buildPortfolioHubSymbolContext(holdingsToReview.map(row => row.symbol));
  const profileBuildResults = await ensurePortfolioHubProfiles(holdingsToReview);
  const marketContext = await buildPortfolioHubMarketContext(portfolioHub);
  const stockNewsContext = await buildPortfolioHubStockNewsContext(holdingsToReview, portfolioHub.sectorTrimCandidates || []);

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
- Use the supplied technical inputs explicitly when forming holdings guidance, especially for stop loss, take profit, trim/add timing, and whether the current setup is extended, constructive, weak, or breaking down.
- Pay particular attention to SMA200, SMA50, distance from SMA200, RSI, volume ratio, trend, and slope fields when deciding if a holding deserves patience, tighter risk control, or an active trim/add recommendation.

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
${JSON.stringify(holdingsToReview.map(row => ({
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
    technicals: technicalsMap.get(row.symbol) || null,
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
  const reviewItems = holdingsToReview.map(row => {
    const opusReview = bySymbol.get(row.symbol) || null;
    const normalized = {
      symbol: row.symbol,
      positionType: row.positionType,
      actionLabel: opusReview?.actionLabel || 'Hold',
      summary: opusReview?.summary || row.whiskieView || '',
      detail: opusReview?.detail || '',
      shareCountText: opusReview?.shareCountText || null,
      plannedTotalShares: Number.isFinite(Number(opusReview?.plannedTotalShares)) ? Number(opusReview.plannedTotalShares) : null,
      targetPositionShares: Number.isFinite(Number(opusReview?.targetPositionShares)) ? Number(opusReview.targetPositionShares) : null,
      stageLabel: opusReview?.stageLabel || null,
      targetWeightPct: Number.isFinite(Number(opusReview?.targetWeightPct)) ? Number(opusReview.targetWeightPct) : null,
      confidence: opusReview?.confidence || null,
      stopLoss: Number.isFinite(Number(opusReview?.stopLoss)) ? Number(opusReview.stopLoss) : null,
      takeProfit: Number.isFinite(Number(opusReview?.takeProfit)) ? Number(opusReview.takeProfit) : null,
      reasoning: opusReview?.reasoning || '',
      actionTaxonomy: classifyReviewActionTaxonomy(opusReview || {}),
      rawModelPayload: opusReview
    };
    const scoring = scoreReviewItem(normalized, row);
    return {
      ...normalized,
      deterministicScore: scoring.score,
      scoringBreakdown: scoring.breakdown
    };
  }).sort((a, b) => Number(b.deterministicScore || 0) - Number(a.deterministicScore || 0))
    .map((item, index) => ({
      ...item,
      deterministicRank: index + 1
    }));

  const reviewRun = await db.createPortfolioHubReviewRun({
    sourceLabel: 'opus',
    reviewType: 'holding_review',
    marketContext: marketContext.summary,
    portfolioSnapshot: {
      summary: portfolioHub.summary,
      holdingsCount: holdingsToReview.length
    },
    notes: `Reviewed ${reviewItems.length} holdings`,
    rawModelPayload: parsed
  });
  await db.replacePortfolioHubReviewItems(reviewRun.id, reviewItems);

  await db.recordPortfolioHubAdviceHistory(
    holdingsToReview.map(row => {
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
    holdings: reviewItems.map(item => ({
      symbol: item.symbol,
      positionType: item.positionType,
      actionTaxonomy: item.actionTaxonomy,
      deterministicScore: item.deterministicScore,
      deterministicRank: item.deterministicRank,
      opusReview: bySymbol.get(item.symbol) || null
    }))
  };
  } finally {
    await db.releasePortfolioHubAdvisoryLock(PORTFOLIO_HUB_LOCKS.opusReview).catch(() => null);
  }
}
