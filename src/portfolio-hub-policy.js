export const PORTFOLIO_HUB_POLICY = {
  long: {
    maxTargetWeightPct: 12,
    addRangeMinPct: 2,
    addRangeMaxPct: 4,
    starterMaxWeightPct: 6,
    earningsTrimMinPct: 10,
    earningsTrimMaxPct: 20,
    winnerTrimMinPct: 20,
    winnerTrimMaxPct: 25,
    sectorConcentrationTrimMinPct: 10,
    sectorConcentrationTrimMaxPct: 15,
    sectorConcentrationThresholdPct: 25,
    weightTrimThresholdPct: 15,
    earningsCautionWeightPct: 8,
    lossReviewThresholdPct: -12
  },
  short: {
    concentrationWeightPct: 10,
    lossCoverThresholdPct: -15,
    gainLockThresholdPct: 15,
    lossCoverMinPct: 25,
    lossCoverMaxPct: 35,
    eventCoverMinPct: 20,
    eventCoverMaxPct: 30,
    concentrationTrimMinPct: 15,
    concentrationTrimMaxPct: 25,
    gainLockCoverMinPct: 10,
    gainLockCoverMaxPct: 20
  }
};
