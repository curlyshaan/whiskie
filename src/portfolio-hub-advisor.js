import { PORTFOLIO_HUB_POLICY } from './portfolio-hub-policy.js';

function safePct(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0.0';
  return numeric.toFixed(digits);
}

function pctRangeLabel(minPct, maxPct) {
  const min = Math.round(Number(minPct || 0));
  const max = Math.round(Number(maxPct || 0));
  return min === max ? `${min}%` : `${min}% to ${max}%`;
}

function formatShareCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '0 shares';
  return `${Math.max(1, Math.round(numeric))} shares`;
}

function buildShareGuidance(row, actionLabel, context = {}) {
  const currentPrice = Number(row.currentPrice || 0);
  const marketValue = Number(row.marketValue || 0);
  const totalPortfolioValue = Number(context.totalPortfolioValue || 0);
  const currentWeightPct = Number(row.weightPct || 0);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(totalPortfolioValue) || totalPortfolioValue <= 0) {
    return null;
  }

  const percentMap = {
    Add: Number(context.addPct ?? 0),
    Trim: Number(context.trimPct ?? 0),
    Reduce: Number(context.reducePct ?? 0),
    Cover: Number(context.coverPct ?? 0)
  };
  const targetPct = percentMap[actionLabel];
  if (!Number.isFinite(targetPct) || targetPct <= 0) return null;

  if (actionLabel === 'Add') {
    const targetValue = totalPortfolioValue * (targetPct / 100);
    const additionalValue = Math.max(0, targetValue - marketValue);
    return {
      shares: additionalValue / currentPrice,
      basis: `${safePct(currentWeightPct)}% → ${safePct(targetPct)}% target`
    };
  }

  const reduceValue = marketValue * (targetPct / 100);
  return {
    shares: reduceValue / currentPrice,
    basis: `${safePct(targetPct)}% of current position`
  };
}

function buildPortfolioHubActionLabel(row, context = {}) {
  const weightPct = Number(row.weightPct || 0);
  const sectorWeightPct = Number(context.sectorWeightPct || 0);
  const pnlPct = Number(row.unrealizedPnLPct || 0);
  const upcomingEarnings = Boolean(row.nextEarningsDate);

  if (row.positionType === 'short') {
    const policy = PORTFOLIO_HUB_POLICY.short;
    if (pnlPct < policy.lossCoverThresholdPct) return 'Cover';
    if (upcomingEarnings && pnlPct < 10) return 'Cover';
    if (weightPct > policy.concentrationWeightPct) return 'Reduce';
    if (pnlPct > policy.gainLockThresholdPct) return 'Hold';
    return 'Hold';
  }

  const policy = PORTFOLIO_HUB_POLICY.long;
  if (pnlPct > 20 && weightPct > policy.maxTargetWeightPct) return 'Trim';
  if (weightPct > policy.weightTrimThresholdPct) return 'Reduce';
  if (sectorWeightPct > policy.sectorConcentrationThresholdPct && weightPct > policy.earningsCautionWeightPct) return 'Trim';
  if (upcomingEarnings && weightPct > policy.earningsCautionWeightPct) return 'Trim';
  if (pnlPct < policy.lossReviewThresholdPct) return 'Hold';
  if (weightPct < policy.starterMaxWeightPct && sectorWeightPct < 22) return 'Add';
  return 'Hold';
}

export function buildPortfolioHubRecommendation(row, context = {}) {
  const actionLabel = buildPortfolioHubActionLabel(row, context);
  const weightPct = Number(row.weightPct || 0);
  const sectorWeightPct = Number(context.sectorWeightPct || 0);
  const pnlPct = Number(row.unrealizedPnLPct || 0);
  const upcomingEarnings = Boolean(row.nextEarningsDate);
  const policy = row.positionType === 'short' ? PORTFOLIO_HUB_POLICY.short : PORTFOLIO_HUB_POLICY.long;
  const opusReview = context.opusReview || null;
  const accountContext = row.accountContext || {};
  const taxableShares = Number(accountContext.taxableShares || 0);
  const taxAdvantagedShares = Number(accountContext.taxAdvantagedShares || 0);
  const hasMostlyTaxableExposure = taxableShares > 0 && taxableShares >= taxAdvantagedShares;
  const taxAwarenessText = hasMostlyTaxableExposure
    ? ' Taxable exposure exists, so favor patience when the thesis is intact and avoid unnecessary short-horizon churn.'
    : '';

  if (opusReview && typeof opusReview.actionLabel === 'string') {
    const remainingShares = Number(opusReview.remainingShares);
    const targetPositionShares = Number(opusReview.targetPositionShares);
    const currentShares = Math.abs(Number(row.shares || 0));
    const stageLabel = opusReview.stageLabel || null;
    const hasTargetPosition = Number.isFinite(targetPositionShares);
    const directionAwareDelta = hasTargetPosition && Number.isFinite(currentShares)
      ? Math.max(0, Math.abs(currentShares - targetPositionShares))
      : Math.max(0, remainingShares || 0);

    const normalizedAction = row.positionType === 'short' && String(opusReview.actionLabel || '').toLowerCase() === 'trim'
      ? 'Cover'
      : opusReview.actionLabel;

    return {
      actionLabel: normalizedAction,
      summary: opusReview.summary || '',
      detail: opusReview.detail || '',
      shareCountText: directionAwareDelta > 0
        ? `${normalizedAction} ${formatShareCount(directionAwareDelta)}${stageLabel ? ` (${stageLabel})` : ''}.`
        : null,
      planProgressText: null,
      stopLoss: Number.isFinite(Number(opusReview.stopLoss)) ? Number(opusReview.stopLoss) : null,
      takeProfit: Number.isFinite(Number(opusReview.takeProfit)) ? Number(opusReview.takeProfit) : null,
      confidence: opusReview.confidence || null,
      source: 'opus'
    };
  }

  if (row.positionType === 'short') {
    if (actionLabel === 'Cover') {
      const shareGuidance = buildShareGuidance(row, actionLabel, {
        ...context,
        coverPct: pnlPct < policy.lossCoverThresholdPct ? policy.lossCoverMaxPct : policy.eventCoverMaxPct
      });
      if (pnlPct < policy.lossCoverThresholdPct) {
        return {
          actionLabel,
          summary: `Cover about ${pctRangeLabel(policy.lossCoverMinPct, policy.lossCoverMaxPct)} now.`,
          detail: `Short loss is ${safePct(pnlPct)}% and squeeze risk is elevated for a ${safePct(weightPct)}% weight position.${taxAwarenessText}`,
          shareCountText: shareGuidance ? `Cover about ${formatShareCount(shareGuidance.shares)}.` : null,
          source: 'policy'
        };
      }
      return {
        actionLabel,
        summary: `Cover about ${pctRangeLabel(policy.eventCoverMinPct, policy.eventCoverMaxPct)} before earnings.`,
        detail: `Keep remaining short size controlled into the event.${taxAwarenessText}`,
        shareCountText: shareGuidance ? `Cover about ${formatShareCount(shareGuidance.shares)}.` : null,
        source: 'policy'
      };
    }

    if (actionLabel === 'Reduce') {
      const shareGuidance = buildShareGuidance(row, actionLabel, { ...context, reducePct: policy.concentrationTrimMaxPct });
      return {
        actionLabel,
        summary: `Reduce short exposure by about ${pctRangeLabel(policy.concentrationTrimMinPct, policy.concentrationTrimMaxPct)}.`,
        detail: `Current short weight is ${safePct(weightPct)}% and sector concentration is ${safePct(sectorWeightPct)}%, which is getting stretched rather than acting as a hard cap.${taxAwarenessText}`,
        shareCountText: shareGuidance ? `Reduce about ${formatShareCount(shareGuidance.shares)}.` : null,
        source: 'policy'
      };
    }

    return {
      actionLabel,
      summary: actionLabel === 'Hold'
        ? `Maintain short below ${policy.concentrationWeightPct}% weight.`
        : 'Monitor short thesis.',
      detail: pnlPct > policy.gainLockThresholdPct
        ? `Consider covering ${policy.gainLockCoverMinPct}-${policy.gainLockCoverMaxPct}% into strength to lock gains.`
        : 'Avoid increasing size until conviction improves.',
      source: 'policy'
    };
  }

  if (actionLabel === 'Trim') {
    const shareGuidance = buildShareGuidance(row, actionLabel, {
      ...context,
      trimPct: upcomingEarnings && weightPct > policy.earningsCautionWeightPct
        ? policy.earningsTrimMaxPct
        : pnlPct > 20 && weightPct > policy.maxTargetWeightPct
          ? policy.winnerTrimMaxPct
          : policy.sectorConcentrationTrimMaxPct
    });
    if (pnlPct > 20 && weightPct > policy.maxTargetWeightPct) {
      return {
        actionLabel,
        summary: `Trim about ${pctRangeLabel(policy.winnerTrimMinPct, policy.winnerTrimMaxPct)}.`,
        detail: `Winner is ${safePct(pnlPct)}% with ${safePct(weightPct)}% portfolio weight.${taxAwarenessText}`,
        shareCountText: shareGuidance ? `Trim about ${formatShareCount(shareGuidance.shares)}.` : null,
        source: 'policy'
      };
    }
    if (upcomingEarnings && weightPct > policy.earningsCautionWeightPct) {
      return {
        actionLabel,
        summary: `Trim about ${pctRangeLabel(policy.earningsTrimMinPct, policy.earningsTrimMaxPct)} before earnings.`,
        detail: `Avoid increasing above current ${safePct(weightPct)}% weight into the event.${taxAwarenessText}`,
        shareCountText: shareGuidance ? `Trim about ${formatShareCount(shareGuidance.shares)}.` : null,
        source: 'policy'
      };
    }
    return {
      actionLabel,
      summary: `Trim about ${pctRangeLabel(policy.sectorConcentrationTrimMinPct, policy.sectorConcentrationTrimMaxPct)}.`,
      detail: `Sector exposure is ${safePct(sectorWeightPct)}% and concentration is getting high without being treated as a hard cap.${taxAwarenessText}`,
      shareCountText: shareGuidance ? `Trim about ${formatShareCount(shareGuidance.shares)}.` : null,
      source: 'policy'
    };
  }

  if (actionLabel === 'Reduce') {
    const shareGuidance = buildShareGuidance(row, actionLabel, { ...context, reducePct: 20 });
    return {
      actionLabel,
      summary: 'Reduce by 15-20%.',
      detail: `Bring position closer to a 10-${policy.maxTargetWeightPct}% target weight.${taxAwarenessText}`,
      shareCountText: shareGuidance ? `Reduce about ${formatShareCount(shareGuidance.shares)}.` : null,
      source: 'policy'
    };
  }

  if (actionLabel === 'Add') {
    const shareGuidance = buildShareGuidance(row, actionLabel, { ...context, addPct: policy.maxTargetWeightPct });
    return {
      actionLabel,
      summary: `Can add about ${pctRangeLabel(policy.addRangeMinPct, policy.addRangeMaxPct)} more.`,
      detail: `Target roughly 8% to ${policy.maxTargetWeightPct}% weight if conviction remains high, and expect this guidance to shrink after you log additional shares.${taxAdvantagedShares > taxableShares ? ' Tax-advantaged exposure makes medium-term adds less tax-sensitive.' : ''}`,
      shareCountText: shareGuidance ? `Add about ${formatShareCount(shareGuidance.shares)}.` : null,
      source: 'policy'
    };
  }

  return {
    actionLabel,
    summary: pnlPct < policy.lossReviewThresholdPct
      ? 'Hold only if thesis is intact.'
      : `Hold current size near ${safePct(weightPct)}% weight.`,
    detail: pnlPct < policy.lossReviewThresholdPct
      ? `Avoid adding until Whiskie context improves and the thesis is re-validated.${taxAwarenessText}`
      : `Reassess only if pathway, earnings, or sector context changes.${taxAwarenessText}`,
    source: 'policy'
  };
}
