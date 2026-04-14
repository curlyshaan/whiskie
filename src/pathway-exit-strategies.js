/**
 * Pathway-Specific Exit Strategies
 *
 * Different investment pathways require different exit strategies.
 * A "value dip" is a 3-12 month trade, while "deepValue" is a 2-5 year hold.
 *
 * This module defines exit rules for each pathway based on Opus recommendations.
 */

export const PATHWAY_STRATEGIES = {
  // LONG PATHWAYS
  deepValue: {
    name: 'Deep Value - Undervalued Quality Compounder',
    timeHorizon: '2-5 years',
    initialTakeProfit: null, // Hold for thesis
    stopLoss: -0.15, // -15% hard stop
    trailingStop: {
      activateAt: 1.00, // +100%
      trailDistance: -0.25 // -25% from peak
    },
    trimLevels: [
      { gain: 1.00, trimPercent: 0.25 }, // Trim 25% at +100%
      { gain: 2.00, trimPercent: 0.25 }  // Trim 25% at +200%
    ],
    reEvaluation: 'quarterly',
    exitConditions: [
      'Valuation reaches expensive (P/E >30 or P/B >5)',
      'ROE declines >30% for 2 consecutive quarters',
      'Debt/equity increases >50%',
      'Management change with questionable track record'
    ]
  },

  highGrowth: {
    name: 'High Growth - Revenue/Earnings Acceleration',
    timeHorizon: '6-18 months',
    initialTakeProfit: 0.50, // +50%
    stopLoss: -0.12, // -12% hard stop
    trailingStop: {
      activateAt: 0.25, // +25%
      trailDistance: -0.15, // -15% from peak
      tightenAt: 1.00, // Tighten to -10% after +100%
      tightenDistance: -0.10
    },
    trimLevels: [
      { gain: 0.50, trimPercent: 0.33 }, // Trim 33% at +50%
      { gain: 1.00, trimPercent: 0.33 }  // Trim 33% at +100%
    ],
    reEvaluation: 'monthly',
    exitConditions: [
      'Revenue growth decelerates 2 consecutive quarters',
      'Gross margins compress >300bps',
      'Guidance miss or reduction',
      'Valuation becomes extreme (P/S >20 for SaaS, P/E >60)'
    ]
  },

  inflection: {
    name: 'Inflection - Early Turnaround Signal',
    timeHorizon: '3-9 months',
    initialTakeProfit: 0.30, // +30%
    stopLoss: -0.10, // -10% hard stop
    trailingStop: {
      activateAt: 0.20, // +20%
      trailDistance: -0.12 // -12% from peak
    },
    trimLevels: [
      { gain: 0.30, trimPercent: 0.50 } // Trim 50% at +30%
    ],
    reEvaluation: 'monthly',
    reclassifyTo: 'turnaround', // If inflection succeeds for 2+ quarters
    exitConditions: [
      'Inflection fails (metrics reverse)',
      '2 quarters confirm or deny the inflection',
      'Management suggests one-time improvement'
    ]
  },

  cashMachine: {
    name: 'Cash Machine - High FCF Generator',
    timeHorizon: '2-4 years',
    initialTakeProfit: null, // Hold for cash generation
    stopLoss: -0.12, // -12% hard stop
    stopLossAlternate: 'dividend cut >25%',
    trailingStop: {
      activateAt: 0.40, // +40%
      trailDistance: -0.20 // -20% from peak
    },
    trimLevels: [
      { gain: 0.50, trimPercent: 0.25 } // Trim 25% at +50% (rebalance)
    ],
    reEvaluation: 'quarterly',
    exitConditions: [
      'FCF declines >20% for 2 consecutive quarters',
      'Dividend cut or suspension',
      'Payout ratio exceeds 100%',
      'Debt/EBITDA rises above 4x'
    ]
  },

  qarp: {
    name: 'QARP - Quality at Reasonable Price',
    timeHorizon: '1-3 years',
    initialTakeProfit: 0.40, // +40%
    stopLoss: -0.10, // -10% hard stop
    trailingStop: {
      activateAt: 0.30, // +30%
      trailDistance: -0.15 // -15% from peak
    },
    trimLevels: [
      { gain: 0.40, trimPercent: 0.33 }, // Trim 33% at +40%
      { gain: 0.80, trimPercent: 0.33 }  // Trim 33% at +80%
    ],
    reEvaluation: 'quarterly',
    exitConditions: [
      'Valuation no longer reasonable (P/E exceeds sector by >75%)',
      'Quality deteriorates (ROE drops >25%)',
      'Growth stalls (revenue growth <5% for 2 quarters)'
    ]
  },

  turnaround: {
    name: 'Turnaround - Multi-Year Transformation',
    timeHorizon: '2-4 years',
    initialTakeProfit: null, // Hold for transformation
    stopLoss: -0.20, // -20% hard stop (need room for volatility)
    trailingStop: {
      activateAt: 1.00, // +100%
      trailDistance: -0.30 // -30% from peak
    },
    trimLevels: [
      { gain: 1.00, trimPercent: 0.20 }, // Trim 20% at +100%
      { gain: 2.00, trimPercent: 0.30 }  // Trim 30% at +200%
    ],
    reEvaluation: 'quarterly',
    exitConditions: [
      'Transformation plan abandoned or altered',
      'Key executives leave',
      'Debt becomes unsustainable (interest coverage <2x)',
      'Transformation completes successfully'
    ]
  },

  value_dip: {
    name: 'Value Dip - Temporary Weakness in Quality',
    timeHorizon: '3-12 months',
    initialTakeProfit: 0.20, // +20% (exit at fair value)
    stopLoss: -0.08, // -8% hard stop
    trailingStop: {
      activateAt: 0.15, // +15%
      trailDistance: -0.08 // -8% from peak (tight)
    },
    trimLevels: [
      { gain: 0.15, trimPercent: 0.50 }, // Trim 50% at +15%
      { gain: 0.25, trimPercent: 0.50 }  // Trim 50% at +25%
    ],
    maxGain: 0.30, // Full exit by +30%
    reEvaluation: 'weekly',
    exitConditions: [
      'Fair value reached (P/E returns to historical median)',
      'Dip becomes trend (fundamentals deteriorating)',
      '6 months pass without recovery'
    ]
  },

  // SHORT PATHWAYS
  overvalued: {
    name: 'Overvalued - Valuation Compression',
    timeHorizon: '6-18 months',
    initialTakeProfit: -0.25, // Cover at -25%
    stopLoss: 0.15, // +15% hard stop (inverse for shorts)
    trailingStop: {
      activateAt: -0.20, // Activate at -20% profit
      trailDistance: 0.10 // +10% from low (inverse)
    },
    trimLevels: [
      { gain: -0.25, trimPercent: 0.50 }, // Cover 50% at -25%
      { gain: -0.40, trimPercent: 0.50 }  // Cover 50% at -40%
    ],
    reEvaluation: 'monthly',
    exitConditions: [
      'Valuation normalizes (P/E returns to sector median)',
      'Fundamentals improve beyond expectations',
      'Earnings beat significantly'
    ]
  },

  deteriorating: {
    name: 'Deteriorating - Fundamental Short',
    timeHorizon: '6-12 months',
    initialTakeProfit: -0.30, // Cover at -30%
    stopLoss: 0.12, // +12% hard stop
    trailingStop: {
      activateAt: -0.20, // Activate at -20%
      trailDistance: 0.08 // +8% from low
    },
    trimLevels: [
      { gain: -0.30, trimPercent: 0.50 } // Cover 50% at -30%
    ],
    reEvaluation: 'monthly',
    exitConditions: [
      'Deterioration stops (margins stabilize)',
      'Management change with credible turnaround plan',
      'Activist investor involvement',
      'Acquisition rumors'
    ]
  },

  overextended: {
    name: 'Overextended - Technical Exhaustion',
    timeHorizon: '2-8 weeks',
    initialTakeProfit: -0.08, // Cover at -8%
    stopLoss: 0.06, // +6% hard stop
    trailingStop: {
      activateAt: -0.05, // Activate at -5%
      trailDistance: 0.03 // +3% from low (tight)
    },
    trimLevels: [
      { gain: -0.08, trimPercent: 1.00 } // Cover 100% at -8%
    ],
    reEvaluation: 'daily',
    exitConditions: [
      'Pullback occurs (RSI <70, price returns to 20-day MA)',
      'Momentum continues (new highs on strong volume)',
      '4 weeks pass without pullback'
    ]
  }
};

/**
 * Get exit strategy for a pathway
 */
export function getExitStrategy(pathway) {
  return PATHWAY_STRATEGIES[pathway] || null;
}

/**
 * Calculate initial targets based on pathway
 */
export function calculatePathwayTargets(pathway, entryPrice, isShort = false) {
  const strategy = getExitStrategy(pathway);
  if (!strategy) {
    // Fallback to default strategy
    return {
      takeProfit: isShort ? entryPrice * 0.85 : entryPrice * 1.20,
      stopLoss: isShort ? entryPrice * 1.08 : entryPrice * 0.92
    };
  }

  const takeProfit = strategy.initialTakeProfit !== null
    ? entryPrice * (1 + strategy.initialTakeProfit)
    : null; // No initial take-profit for long-term holds

  const stopLoss = entryPrice * (1 + strategy.stopLoss);

  return {
    takeProfit,
    stopLoss,
    trailingStop: strategy.trailingStop,
    trimLevels: strategy.trimLevels,
    timeHorizon: strategy.timeHorizon,
    reEvaluation: strategy.reEvaluation
  };
}

/**
 * Check if position should be trimmed based on pathway rules
 */
export function shouldTrimPosition(pathway, entryPrice, currentPrice, currentQuantity, isShort = false) {
  const strategy = getExitStrategy(pathway);
  if (!strategy || !strategy.trimLevels) return null;

  const gain = isShort
    ? (entryPrice - currentPrice) / entryPrice
    : (currentPrice - entryPrice) / entryPrice;

  // Find the highest trim level that has been reached but not yet executed
  for (const level of strategy.trimLevels.sort((a, b) => b.gain - a.gain)) {
    if (gain >= level.gain) {
      return {
        trimPercent: level.trimPercent,
        trimQuantity: Math.floor(currentQuantity * level.trimPercent),
        reason: `${pathway} pathway: trim ${(level.trimPercent * 100).toFixed(0)}% at +${(level.gain * 100).toFixed(0)}% gain`
      };
    }
  }

  return null;
}

/**
 * Check if trailing stop should be activated
 */
export function shouldActivateTrailingStop(pathway, entryPrice, currentPrice, peakPrice, isShort = false) {
  const strategy = getExitStrategy(pathway);
  if (!strategy || !strategy.trailingStop) return null;

  const gain = isShort
    ? (entryPrice - currentPrice) / entryPrice
    : (currentPrice - entryPrice) / entryPrice;

  // Check if we've reached activation threshold
  if (gain >= strategy.trailingStop.activateAt) {
    const trailDistance = strategy.trailingStop.trailDistance;
    const trailPrice = isShort
      ? peakPrice * (1 - trailDistance) // For shorts, trail above the low
      : peakPrice * (1 + trailDistance); // For longs, trail below the peak

    return {
      activated: true,
      trailPrice,
      trailDistance,
      reason: `${pathway} pathway: trailing stop activated at +${(strategy.trailingStop.activateAt * 100).toFixed(0)}%`
    };
  }

  return null;
}

/**
 * Get re-evaluation frequency for pathway
 */
export function getReEvaluationFrequency(pathway) {
  const strategy = getExitStrategy(pathway);
  return strategy?.reEvaluation || 'weekly';
}

/**
 * Check if pathway should be reclassified
 * Example: inflection → turnaround if succeeds for 2+ quarters
 */
export function shouldReclassifyPathway(pathway, daysHeld, gain, fundamentalsImproving) {
  if (pathway === 'inflection' && daysHeld > 180 && gain > 0.30 && fundamentalsImproving) {
    return {
      newPathway: 'turnaround',
      reason: 'Inflection succeeded for 2+ quarters, reclassify to turnaround'
    };
  }

  if (pathway === 'value_dip' && daysHeld > 180 && gain < 0 && !fundamentalsImproving) {
    return {
      newPathway: 'deteriorating',
      reason: 'Value dip did not recover and fundamentals worsening'
    };
  }

  return null;
}

export default {
  PATHWAY_STRATEGIES,
  getExitStrategy,
  calculatePathwayTargets,
  shouldTrimPosition,
  shouldActivateTrailingStop,
  getReEvaluationFrequency,
  shouldReclassifyPathway
};
