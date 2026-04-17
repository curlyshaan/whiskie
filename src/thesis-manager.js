import * as db from './db.js';

const FLEXIBLE_FUNDAMENTAL_STRATEGIES = new Set([
  'qualityCompounder',
  'deepValue',
  'cashMachine',
  'qarp',
  'fundamental_hold'
]);

const MOMENTUM_STRATEGIES = new Set([
  'highGrowth',
  'inflection',
  'growth_momentum',
  'tactical_catalyst',
  'turnaround'
]);

const SHORT_STRATEGIES = new Set([
  'overvalued',
  'deteriorating',
  'overextended'
]);

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function classifyManagementStyle(position = {}) {
  const strategy = normalizeText(position.strategy_type || position.strategyType);
  const pathway = normalizeText(position.pathway);
  const intent = normalizeText(position.current_intent || position.intent);
  const key = strategy || pathway || intent;

  if (SHORT_STRATEGIES.has(key) || position.position_type === 'short' || position.stock_type === 'short' || Number(position.quantity) < 0) {
    return 'short';
  }

  if (FLEXIBLE_FUNDAMENTAL_STRATEGIES.has(key)) {
    return 'fundamental';
  }

  if (MOMENTUM_STRATEGIES.has(key)) {
    return 'momentum';
  }

  if (intent.includes('fundamental') || intent.includes('quality') || intent.includes('value')) {
    return 'fundamental';
  }

  return 'momentum';
}

export function defaultTargetTypeForStyle(style) {
  if (style === 'fundamental') return 'flexible_fundamental';
  if (style === 'short') return 'fixed';
  return 'fixed';
}

export function extractThesisState(text = '') {
  const normalized = text.toLowerCase();
  if (normalized.includes('thesis: broken')) return 'broken';
  if (normalized.includes('thesis: weakening')) return 'weakening';
  if (normalized.includes('thesis: strengthening')) return 'strengthening';
  if (normalized.includes('thesis: unchanged')) return 'unchanged';
  if (normalized.includes('thesis: valid')) return 'unchanged';
  return 'unchanged';
}

export function extractActionDirective(text = '') {
  const normalized = text.toLowerCase();
  if (normalized.includes('position action: exit') || normalized.includes('position action: sell')) return 'exit';
  if (normalized.includes('position action: trim')) return 'trim';
  if (normalized.includes('position action: add')) return 'add';
  if (normalized.includes('position action: hold')) return 'hold';
  return null;
}

export function deriveHoldingPosture({ managementStyle, thesisState, actionDirective, targetType }) {
  if (thesisState === 'broken') {
    return managementStyle === 'short' ? 'cover' : 'exit';
  }

  if (actionDirective === 'trim') return 'trim';
  if (actionDirective === 'add') return 'add';
  if (managementStyle === 'fundamental' && thesisState === 'strengthening') return 'rebalance';
  if (targetType === 'trailing') return 'trail';

  return 'hold';
}

export function deriveUpdatedManagementFields(position = {}, review = {}) {
  const managementStyle = classifyManagementStyle(position);
  const thesisState = review.thesisState || extractThesisState(review.analysisText || '');
  const actionDirective = review.actionDirective || extractActionDirective(review.analysisText || '');
  const requestedTargetType = normalizeText(review.targetType || '');
  const requestedTargetAction = normalizeText(review.targetAction || '');
  const currentTargetType = normalizeText(position.target_type || position.targetType);
  const effectiveTargetType = requestedTargetType
    || (managementStyle === 'fundamental' && thesisState === 'strengthening' && requestedTargetAction === 'remove' ? 'flexible_fundamental' : '')
    || currentTargetType
    || defaultTargetTypeForStyle(managementStyle);

  let takeProfit = review.newTakeProfit ?? position.take_profit ?? null;
  let stopLoss = review.newStopLoss ?? position.stop_loss ?? null;
  let rebalanceThresholdPct = position.rebalance_threshold_pct ?? position.rebalanceThresholdPct ?? null;
  let trailingStopPct = position.trailing_stop_pct ?? position.trailingStopPct ?? null;
  let hasFixedTarget = position.has_fixed_target ?? position.hasFixedTarget ?? null;

  if (managementStyle === 'fundamental') {
    if (thesisState === 'strengthening') {
      if (requestedTargetAction === 'remove' || effectiveTargetType === 'flexible_fundamental') {
        takeProfit = null;
        hasFixedTarget = false;
      }
      rebalanceThresholdPct = rebalanceThresholdPct ?? 20;
    } else if (thesisState === 'weakening' && stopLoss === null && position.current_price) {
      stopLoss = Number(position.current_price) * 0.92;
    } else if (thesisState === 'broken') {
      hasFixedTarget = false;
    }
  } else if (managementStyle === 'momentum') {
    if (thesisState === 'strengthening' && requestedTargetAction === 'raise' && review.newTakeProfit != null) {
      takeProfit = review.newTakeProfit;
      hasFixedTarget = true;
    }
    if ((thesisState === 'weakening' || thesisState === 'broken') && trailingStopPct == null) {
      trailingStopPct = 10;
    }
  } else if (managementStyle === 'short') {
    hasFixedTarget = true;
    if (trailingStopPct == null) {
      trailingStopPct = 8;
    }
  }

  const holdingPosture = deriveHoldingPosture({
    managementStyle,
    thesisState,
    actionDirective,
    targetType: effectiveTargetType
  });

  return {
    managementStyle,
    thesisState,
    actionDirective,
    targetType: effectiveTargetType,
    takeProfit,
    stopLoss,
    hasFixedTarget,
    rebalanceThresholdPct,
    trailingStopPct,
    holdingPosture
  };
}

export function buildEntryManagementPlan(trade = {}) {
  const isShort = trade.type === 'short' || trade.action === 'sell_short';
  const quantity = Math.abs(Number(trade.quantity || 0));
  const syntheticPosition = {
    strategy_type: trade.strategyType,
    strategyType: trade.strategyType,
    pathway: trade.pathway,
    current_intent: trade.intent,
    intent: trade.intent,
    position_type: isShort ? 'short' : 'long',
    stock_type: isShort ? 'short' : 'long',
    quantity: isShort ? -quantity : quantity,
    current_price: trade.entryPrice ?? trade.currentPrice ?? null,
    stop_loss: trade.stopLoss ?? null,
    take_profit: trade.takeProfit ?? null,
    target_type: trade.targetType ?? null,
    trailing_stop_pct: trade.trailingStopPct ?? null,
    rebalance_threshold_pct: trade.rebalanceThresholdPct ?? null,
    has_fixed_target: trade.hasFixedTarget ?? null
  };

  return deriveUpdatedManagementFields(syntheticPosition, {
    thesisState: trade.thesisState || 'unchanged',
    actionDirective: trade.actionDirective || null,
    targetAction: trade.targetAction || null,
    targetType: trade.targetType || null,
    newTakeProfit: trade.takeProfit ?? syntheticPosition.take_profit,
    newStopLoss: trade.stopLoss ?? syntheticPosition.stop_loss
  });
}

export async function persistPositionManagementUpdate(symbol, payload = {}) {
  const setClauses = [];
  const values = [];
  let index = 1;

  const push = (column, value) => {
    if (value === undefined) return;
    setClauses.push(`${column} = $${index}`);
    values.push(value);
    index += 1;
  };

  push('thesis', payload.thesisSummary ?? null);
  push('thesis_state', payload.thesisState ?? null);
  push('holding_posture', payload.holdingPosture ?? null);
  push('strategy_type', payload.strategyType ?? undefined);
  push('current_intent', payload.currentIntent ?? undefined);
  push('target_type', payload.targetType ?? undefined);
  push('take_profit', payload.takeProfit ?? undefined);
  push('stop_loss', payload.stopLoss ?? undefined);
  push('has_fixed_target', payload.hasFixedTarget ?? undefined);
  push('trailing_stop_pct', payload.trailingStopPct ?? undefined);
  push('rebalance_threshold_pct', payload.rebalanceThresholdPct ?? undefined);
  push('confidence', payload.confidence ?? undefined);
  push('last_reviewed', payload.lastReviewed ?? new Date().toISOString());

  if (setClauses.length > 0) {
    values.push(symbol);
    try {
      await db.query(
        `UPDATE positions
         SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE symbol = $${index}`,
        values
      );
    } catch (error) {
      console.error(`Failed to update position ${symbol}:`, error.message);
      // Continue to update lots even if position update fails
    }
  }

  const lotUpdates = {
    thesis: payload.thesisSummary ?? undefined,
    thesis_state: payload.thesisState ?? undefined,
    holding_posture: payload.holdingPosture ?? undefined,
    target_type: payload.targetType ?? undefined,
    take_profit: payload.takeProfit ?? undefined,
    stop_loss: payload.stopLoss ?? undefined,
    trailing_stop_pct: payload.trailingStopPct ?? undefined,
    rebalance_threshold_pct: payload.rebalanceThresholdPct ?? undefined,
    confidence: payload.confidence ?? undefined
  };

  const lots = await db.getPositionLots(symbol).catch(() => []);
  for (const lot of lots) {
    const filtered = Object.fromEntries(
      Object.entries(lotUpdates).filter(([, value]) => value !== undefined)
    );
    if (Object.keys(filtered).length > 0) {
      await db.updatePositionLot(lot.id, filtered).catch(() => {});
    }
  }
}

export default {
  classifyManagementStyle,
  defaultTargetTypeForStyle,
  extractThesisState,
  extractActionDirective,
  deriveHoldingPosture,
  deriveUpdatedManagementFields,
  buildEntryManagementPlan,
  persistPositionManagementUpdate
};
