/**
 * Sector-Specific Scoring Configuration
 * Different sectors have different normal ranges for valuation and growth metrics
 */

export const SECTOR_CONFIGS = {
  'Technology': {
    name: 'Technology',
    peRange: { low: 20, high: 50, ideal: 30 },
    pegRange: { low: 0.5, high: 2.0, ideal: 1.0 },
    revenueGrowthMin: 0.15,  // 15% minimum
    earningsGrowthMin: 0.10,
    debtToEquityMax: 0.5,
    operatingMarginMin: 0.15,
    weights: {
      revenueGrowth: 30,      // Tech = growth story
      earningsGrowth: 20,
      valuation: 15,          // Less weight on P/E (often high)
      financialHealth: 15,
      cashGeneration: 10,
      operatingEfficiency: 10
    },
    keyMetrics: ['revenueGrowth', 'grossMargin', 'r&dSpending']
  },

  'Consumer Cyclical': {
    name: 'Consumer Cyclical',
    peRange: { low: 12, high: 25, ideal: 18 },
    pegRange: { low: 0.8, high: 1.5, ideal: 1.0 },
    revenueGrowthMin: 0.08,
    earningsGrowthMin: 0.08,
    debtToEquityMax: 0.8,
    operatingMarginMin: 0.08,
    weights: {
      revenueGrowth: 20,
      earningsGrowth: 20,
      valuation: 25,          // Valuation matters more
      financialHealth: 15,
      cashGeneration: 10,
      operatingEfficiency: 10
    },
    keyMetrics: ['sameStoreSales', 'inventoryTurnover', 'operatingMargin']
  },

  'Consumer Defensive': {
    name: 'Consumer Defensive',
    peRange: { low: 15, high: 30, ideal: 22 },
    pegRange: { low: 1.0, high: 2.0, ideal: 1.5 },
    revenueGrowthMin: 0.05,  // Lower growth expectations
    earningsGrowthMin: 0.05,
    debtToEquityMax: 0.7,
    operatingMarginMin: 0.10,
    weights: {
      revenueGrowth: 15,
      earningsGrowth: 15,
      valuation: 20,
      financialHealth: 20,    // Stability matters
      cashGeneration: 15,     // Dividend payers
      operatingEfficiency: 15
    },
    keyMetrics: ['dividendYield', 'brandStrength', 'marketShare']
  },

  'Financial Services': {
    name: 'Financial Services',
    peRange: { low: 8, high: 18, ideal: 12 },
    pegRange: { low: 0.8, high: 1.5, ideal: 1.0 },
    revenueGrowthMin: 0.08,
    earningsGrowthMin: 0.10,
    debtToEquityMax: 999,    // N/A for banks (leverage is their business)
    operatingMarginMin: 0.20,
    weights: {
      revenueGrowth: 15,
      earningsGrowth: 25,     // Earnings quality critical
      valuation: 25,          // Low P/E expected
      financialHealth: 10,    // Different metrics apply
      cashGeneration: 15,
      operatingEfficiency: 10
    },
    keyMetrics: ['roe', 'netInterestMargin', 'loanQuality']
  },

  'Healthcare': {
    name: 'Healthcare',
    peRange: { low: 15, high: 35, ideal: 22 },
    pegRange: { low: 0.8, high: 1.8, ideal: 1.2 },
    revenueGrowthMin: 0.10,
    earningsGrowthMin: 0.08,
    debtToEquityMax: 0.6,
    operatingMarginMin: 0.12,
    weights: {
      revenueGrowth: 20,
      earningsGrowth: 20,
      valuation: 20,
      financialHealth: 15,
      cashGeneration: 15,
      operatingEfficiency: 10
    },
    keyMetrics: ['pipelineStrength', 'regulatoryRisk', 'pricingPower']
  },

  'Industrials': {
    name: 'Industrials',
    peRange: { low: 12, high: 25, ideal: 18 },
    pegRange: { low: 0.8, high: 1.5, ideal: 1.0 },
    revenueGrowthMin: 0.08,
    earningsGrowthMin: 0.08,
    debtToEquityMax: 0.7,
    operatingMarginMin: 0.08,
    weights: {
      revenueGrowth: 18,
      earningsGrowth: 18,
      valuation: 22,
      financialHealth: 17,
      cashGeneration: 15,
      operatingEfficiency: 10
    },
    keyMetrics: ['orderBacklog', 'capexIntensity', 'cyclicalExposure']
  },

  'Energy': {
    name: 'Energy',
    peRange: { low: 8, high: 20, ideal: 12 },
    pegRange: { low: 0.5, high: 1.5, ideal: 0.8 },
    revenueGrowthMin: 0.05,  // Commodity-driven
    earningsGrowthMin: 0.05,
    debtToEquityMax: 0.8,
    operatingMarginMin: 0.10,
    weights: {
      revenueGrowth: 15,
      earningsGrowth: 15,
      valuation: 25,          // Cyclical valuation
      financialHealth: 20,    // Debt matters in downturns
      cashGeneration: 15,     // FCF critical
      operatingEfficiency: 10
    },
    keyMetrics: ['commodityPrices', 'reserveLife', 'productionCosts']
  },

  'Utilities': {
    name: 'Utilities',
    peRange: { low: 12, high: 22, ideal: 16 },
    pegRange: { low: 1.5, high: 3.0, ideal: 2.0 },
    revenueGrowthMin: 0.03,  // Low growth, stable
    earningsGrowthMin: 0.03,
    debtToEquityMax: 1.2,    // Higher debt tolerance (regulated)
    operatingMarginMin: 0.15,
    weights: {
      revenueGrowth: 10,
      earningsGrowth: 10,
      valuation: 20,
      financialHealth: 15,
      cashGeneration: 25,     // Dividend focus
      operatingEfficiency: 20
    },
    keyMetrics: ['dividendYield', 'regulatoryEnvironment', 'rateBase']
  },

  'Real Estate': {
    name: 'Real Estate',
    peRange: { low: 15, high: 30, ideal: 20 },
    pegRange: { low: 1.0, high: 2.5, ideal: 1.5 },
    revenueGrowthMin: 0.05,
    earningsGrowthMin: 0.05,
    debtToEquityMax: 1.5,    // Leverage is normal for REITs
    operatingMarginMin: 0.25,
    weights: {
      revenueGrowth: 15,
      earningsGrowth: 15,
      valuation: 20,
      financialHealth: 15,
      cashGeneration: 20,     // FFO/AFFO critical
      operatingEfficiency: 15
    },
    keyMetrics: ['occupancyRate', 'ffo', 'interestCoverage']
  },

  'Communication Services': {
    name: 'Communication Services',
    peRange: { low: 15, high: 35, ideal: 22 },
    pegRange: { low: 0.8, high: 1.8, ideal: 1.2 },
    revenueGrowthMin: 0.10,
    earningsGrowthMin: 0.08,
    debtToEquityMax: 0.8,
    operatingMarginMin: 0.15,
    weights: {
      revenueGrowth: 25,
      earningsGrowth: 20,
      valuation: 20,
      financialHealth: 15,
      cashGeneration: 10,
      operatingEfficiency: 10
    },
    keyMetrics: ['userGrowth', 'arpu', 'contentCosts']
  },

  'Basic Materials': {
    name: 'Basic Materials',
    peRange: { low: 8, high: 18, ideal: 12 },
    pegRange: { low: 0.5, high: 1.5, ideal: 0.8 },
    revenueGrowthMin: 0.05,
    earningsGrowthMin: 0.05,
    debtToEquityMax: 0.7,
    operatingMarginMin: 0.10,
    weights: {
      revenueGrowth: 15,
      earningsGrowth: 15,
      valuation: 25,
      financialHealth: 20,
      cashGeneration: 15,
      operatingEfficiency: 10
    },
    keyMetrics: ['commodityPrices', 'productionCosts', 'demandCycles']
  }
};

/**
 * Get sector configuration for a given sector name
 * Returns default config if sector not found
 */
export function getSectorConfig(sector) {
  return SECTOR_CONFIGS[sector] || SECTOR_CONFIGS['Technology']; // Default to Tech
}

/**
 * Normalize sector name (handle variations)
 */
export function normalizeSectorName(sector) {
  if (!sector) return 'Technology';

  const normalized = sector.trim();

  // Direct match
  if (SECTOR_CONFIGS[normalized]) return normalized;

  // Fuzzy matching
  if (normalized.includes('Tech')) return 'Technology';
  if (normalized.includes('Financial')) return 'Financial Services';
  if (normalized.includes('Health')) return 'Healthcare';
  if (normalized.includes('Consumer') && normalized.includes('Cyclical')) return 'Consumer Cyclical';
  if (normalized.includes('Consumer') && (normalized.includes('Defensive') || normalized.includes('Staples'))) return 'Consumer Defensive';
  if (normalized.includes('Industrial')) return 'Industrials';
  if (normalized.includes('Energy')) return 'Energy';
  if (normalized.includes('Utilit')) return 'Utilities';
  if (normalized.includes('Real Estate') || normalized.includes('REIT')) return 'Real Estate';
  if (normalized.includes('Communication')) return 'Communication Services';
  if (normalized.includes('Material')) return 'Basic Materials';

  // Default
  return 'Technology';
}
