import { PORTFOLIO_HUB_POLICY } from './portfolio-hub-policy.js';

function safePct(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0.0';
  return numeric.toFixed(digits);
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

  if (row.positionType === 'short') {
    if (actionLabel === 'Cover') {
      if (pnlPct < policy.lossCoverThresholdPct) {
        return {
          actionLabel,
          summary: `Cover ${policy.lossCoverMinPct}-${policy.lossCoverMaxPct}% now.`,
          detail: `Short loss is ${safePct(pnlPct)}% and squeeze risk is elevated for a ${safePct(weightPct)}% weight position.`
        };
      }
      return {
        actionLabel,
        summary: `Cover ${policy.eventCoverMinPct}-${policy.eventCoverMaxPct}% before earnings.`,
        detail: 'Keep remaining short size controlled into the event.'
      };
    }

    if (actionLabel === 'Reduce') {
      return {
        actionLabel,
        summary: `Reduce short exposure by ${policy.concentrationTrimMinPct}-${policy.concentrationTrimMaxPct}%.`,
        detail: `Current short weight is ${safePct(weightPct)}% and sector concentration is ${safePct(sectorWeightPct)}%.`
      };
    }

    return {
      actionLabel,
      summary: actionLabel === 'Hold'
        ? `Maintain short below ${policy.concentrationWeightPct}% weight.`
        : 'Monitor short thesis.',
      detail: pnlPct > policy.gainLockThresholdPct
        ? `Consider covering ${policy.gainLockCoverMinPct}-${policy.gainLockCoverMaxPct}% into strength to lock gains.`
        : 'Avoid increasing size until conviction improves.'
    };
  }

  if (actionLabel === 'Trim') {
    if (pnlPct > 20 && weightPct > policy.maxTargetWeightPct) {
      return {
        actionLabel,
        summary: `Trim ${policy.winnerTrimMinPct}-${policy.winnerTrimMaxPct}%.`,
        detail: `Winner is ${safePct(pnlPct)}% with ${safePct(weightPct)}% portfolio weight.`
      };
    }
    if (upcomingEarnings && weightPct > policy.earningsCautionWeightPct) {
      return {
        actionLabel,
        summary: `Trim ${policy.earningsTrimMinPct}-${policy.earningsTrimMaxPct}% before earnings.`,
        detail: `Avoid increasing above current ${safePct(weightPct)}% weight into the event.`
      };
    }
    return {
      actionLabel,
      summary: `Trim ${policy.sectorConcentrationTrimMinPct}-${policy.sectorConcentrationTrimMaxPct}%.`,
      detail: `Sector exposure is ${safePct(sectorWeightPct)}% and concentration is getting high.`
    };
  }

  if (actionLabel === 'Reduce') {
    return {
      actionLabel,
      summary: 'Reduce by 15-20%.',
      detail: `Bring position closer to a 10-${policy.maxTargetWeightPct}% target weight.`
    };
  }

  if (actionLabel === 'Add') {
    return {
      actionLabel,
      summary: `Can add ${policy.addRangeMinPct}-${policy.addRangeMaxPct}% more.`,
      detail: `Target roughly 8-${policy.maxTargetWeightPct}% weight if conviction remains high.`
    };
  }

  return {
    actionLabel,
    summary: pnlPct < policy.lossReviewThresholdPct
      ? 'Hold only if thesis is intact.'
      : `Hold current size near ${safePct(weightPct)}% weight.`,
    detail: pnlPct < policy.lossReviewThresholdPct
      ? 'Avoid adding until Whiskie context improves and the thesis is re-validated.'
      : 'Reassess only if pathway, earnings, or sector context changes.'
  };
}
