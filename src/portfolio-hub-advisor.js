import { PORTFOLIO_HUB_POLICY } from './portfolio-hub-policy.js';

function safePct(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0.0';
  return numeric.toFixed(digits);
}

export function buildPortfolioHubRecommendation(row, context = {}) {
  const weightPct = Number(row.weightPct || 0);
  const sectorWeightPct = Number(context.sectorWeightPct || 0);
  const pnlPct = Number(row.unrealizedPnLPct || 0);
  const hasWhiskiePosition = Boolean(context.hasWhiskiePosition);
  const upcomingEarnings = Boolean(row.nextEarningsDate);

  if (row.positionType === 'short') {
    const policy = PORTFOLIO_HUB_POLICY.short;
    if (pnlPct < policy.lossCoverThresholdPct) {
      return `Cover ${policy.lossCoverMinPct}-${policy.lossCoverMaxPct}% now; loss is ${safePct(pnlPct)}% and short squeeze risk is elevated.`;
    }
    if (upcomingEarnings && pnlPct < 10) {
      return `Cover ${policy.eventCoverMinPct}-${policy.eventCoverMaxPct}% before earnings; keep remaining short size controlled into the event.`;
    }
    if (weightPct > policy.concentrationWeightPct) {
      return `Trim short exposure by ${policy.concentrationTrimMinPct}-${policy.concentrationTrimMaxPct}%; current weight is ${safePct(weightPct)}% and is too concentrated.`;
    }
    if (pnlPct > policy.gainLockThresholdPct) {
      return `Hold short thesis; consider covering ${policy.gainLockCoverMinPct}-${policy.gainLockCoverMaxPct}% into strength to lock gains.`;
    }
    return hasWhiskiePosition
      ? `Maintain short below ${policy.concentrationWeightPct}% weight; add only on weakness if conviction improves.`
      : 'Monitor short thesis; avoid increasing size until Whiskie context improves.';
  }

  const policy = PORTFOLIO_HUB_POLICY.long;
  if (pnlPct > 20 && weightPct > policy.maxTargetWeightPct) {
    return `Trim ${policy.winnerTrimMinPct}-${policy.winnerTrimMaxPct}%; winner is ${safePct(pnlPct)}% with ${safePct(weightPct)}% portfolio weight.`;
  }
  if (weightPct > policy.weightTrimThresholdPct) {
    return `Reduce by 15-20% to bring position closer to a 10-${policy.maxTargetWeightPct}% target weight.`;
  }
  if (sectorWeightPct > policy.sectorConcentrationThresholdPct && weightPct > policy.earningsCautionWeightPct) {
    return `Trim ${policy.sectorConcentrationTrimMinPct}-${policy.sectorConcentrationTrimMaxPct}%; sector exposure is ${safePct(sectorWeightPct)}% and concentration is getting high.`;
  }
  if (upcomingEarnings && weightPct > policy.earningsCautionWeightPct) {
    return `Trim ${policy.earningsTrimMinPct}-${policy.earningsTrimMaxPct}% before earnings or hold flat; avoid increasing above current ${safePct(weightPct)}% weight into the event.`;
  }
  if (pnlPct < policy.lossReviewThresholdPct) {
    return hasWhiskiePosition
      ? 'Do not add yet; hold and re-check thesis, stop, and pathway before increasing size.'
      : 'Hold only if thesis is intact; avoid adding until Whiskie develops a stronger view.';
  }
  if (weightPct < policy.starterMaxWeightPct && sectorWeightPct < 22) {
    return `Can add ${policy.addRangeMinPct}-${policy.addRangeMaxPct}% more, targeting roughly 8-${policy.maxTargetWeightPct}% weight if conviction remains high.`;
  }
  return `Hold current size; keep position near ${safePct(weightPct)}% weight unless Whiskie conviction changes.`;
}
