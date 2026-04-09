import assetClassData from './asset-class-data.js';
import vixRegime from './vix-regime.js';

/**
 * Allocation Manager
 * Calculates dynamic asset class limits based on rate environment and VIX regime
 */
class AllocationManager {
  constructor() {
    this.currentRateEnvironment = 'NEUTRAL_RATES'; // Default, should be updated based on Fed Funds rate
  }

  /**
   * Get current rate environment
   * TODO: Integrate with FRED API to fetch Fed Funds rate automatically
   * For now, this can be set manually or via environment variable
   */
  getRateEnvironment() {
    // Check if rate environment is set in environment variable
    const envRate = process.env.RATE_ENVIRONMENT;
    if (envRate && ['LOW_RATES', 'NEUTRAL_RATES', 'HIGH_RATES'].includes(envRate)) {
      return envRate;
    }
    return this.currentRateEnvironment;
  }

  /**
   * Set rate environment manually
   */
  setRateEnvironment(environment) {
    if (!['LOW_RATES', 'NEUTRAL_RATES', 'HIGH_RATES'].includes(environment)) {
      throw new Error(`Invalid rate environment: ${environment}`);
    }
    this.currentRateEnvironment = environment;
  }

  /**
   * Calculate dynamic allocation limit for an asset class
   * Applies rate environment multiplier + VIX regime multiplier
   */
  async getAssetClassLimit(assetClass) {
    const baseLimit = assetClassData.BASE_LIMITS[assetClass];
    if (!baseLimit) {
      console.warn(`Unknown asset class: ${assetClass}, using 20% default`);
      return 0.20;
    }

    // Get rate environment multiplier
    const rateEnv = this.getRateEnvironment();
    const rateMultiplier = assetClassData.RATE_MULTIPLIERS[rateEnv][assetClass] || 1.0;

    // Get VIX regime multiplier
    const regime = await vixRegime.getRegime();
    const vixMultiplier = assetClassData.VIX_MULTIPLIERS[regime.name][assetClass] || 1.0;

    // Calculate adjusted limit
    let adjustedLimit = baseLimit * rateMultiplier * vixMultiplier;

    // Apply hard cap
    adjustedLimit = Math.min(adjustedLimit, assetClassData.HARD_LIMITS.MAX_ASSET_CLASS_ALLOCATION);

    return adjustedLimit;
  }

  /**
   * Get all asset class limits with current multipliers applied
   */
  async getAllAssetClassLimits() {
    const limits = {};
    const assetClasses = assetClassData.getAllAssetClasses();

    for (const assetClass of assetClasses) {
      limits[assetClass] = await this.getAssetClassLimit(assetClass);
    }

    return limits;
  }

  /**
   * Calculate current asset class allocation from portfolio
   */
  calculateAssetClassAllocation(portfolio) {
    const allocation = {};

    for (const position of portfolio.positions) {
      const assetClass = assetClassData.getAssetClass(position.symbol);
      const positionValue = position.quantity * position.currentPrice;

      if (!allocation[assetClass]) {
        allocation[assetClass] = 0;
      }
      allocation[assetClass] += positionValue;
    }

    // Convert to percentages
    const allocationPct = {};
    for (const [assetClass, value] of Object.entries(allocation)) {
      allocationPct[assetClass] = value / portfolio.totalValue;
    }

    return allocationPct;
  }

  /**
   * Validate if adding a trade would exceed asset class limits
   */
  async validateAssetClassAllocation(symbol, tradeValue, portfolio) {
    const assetClass = assetClassData.getAssetClass(symbol);

    if (assetClass === 'Unknown') {
      return {
        valid: false,
        error: `Unknown asset class for symbol: ${symbol}`
      };
    }

    // Get current allocation
    const currentAllocation = this.calculateAssetClassAllocation(portfolio);
    const currentValue = (currentAllocation[assetClass] || 0) * portfolio.totalValue;

    // Calculate new allocation
    const newValue = currentValue + tradeValue;
    const newAllocationPct = newValue / portfolio.totalValue;

    // Get dynamic limit
    const limit = await this.getAssetClassLimit(assetClass);

    // Check against limit
    if (newAllocationPct > limit) {
      return {
        valid: false,
        error: `${assetClass} allocation would be ${(newAllocationPct * 100).toFixed(1)}%, exceeds limit ${(limit * 100).toFixed(0)}%`,
        currentAllocation: currentAllocation[assetClass] || 0,
        newAllocation: newAllocationPct,
        limit: limit
      };
    }

    // Check stocks per asset class limit
    const stocksInAssetClass = portfolio.positions.filter(p =>
      assetClassData.getAssetClass(p.symbol) === assetClass
    ).length;

    const isNewStock = !portfolio.positions.some(p => p.symbol === symbol);
    if (isNewStock && stocksInAssetClass >= assetClassData.HARD_LIMITS.MAX_STOCKS_PER_ASSET_CLASS) {
      return {
        valid: false,
        error: `${assetClass} already has ${stocksInAssetClass} stocks (max ${assetClassData.HARD_LIMITS.MAX_STOCKS_PER_ASSET_CLASS} per asset class)`,
        currentAllocation: currentAllocation[assetClass] || 0,
        newAllocation: newAllocationPct,
        limit: limit
      };
    }

    return {
      valid: true,
      assetClass,
      currentAllocation: currentAllocation[assetClass] || 0,
      newAllocation: newAllocationPct,
      limit: limit
    };
  }

  /**
   * Check minimum asset class diversification
   */
  checkMinimumDiversification(portfolio) {
    const allocation = this.calculateAssetClassAllocation(portfolio);
    const assetClassCount = Object.keys(allocation).length;

    if (assetClassCount < assetClassData.HARD_LIMITS.MIN_ASSET_CLASSES) {
      return {
        valid: false,
        error: `Portfolio has ${assetClassCount} asset classes, minimum ${assetClassData.HARD_LIMITS.MIN_ASSET_CLASSES} required`,
        currentCount: assetClassCount,
        minRequired: assetClassData.HARD_LIMITS.MIN_ASSET_CLASSES
      };
    }

    return {
      valid: true,
      assetClassCount
    };
  }

  /**
   * Build context string for Claude's prompt
   */
  async buildAllocationContext(portfolio) {
    const rateEnv = this.getRateEnvironment();
    const regime = await vixRegime.getRegime();
    const limits = await this.getAllAssetClassLimits();
    const currentAllocation = this.calculateAssetClassAllocation(portfolio);

    let context = '\nASSET CLASS ALLOCATION:\n';
    context += `Rate Environment: ${rateEnv.replace('_', ' ')}\n`;
    context += `VIX Regime: ${regime.name}\n\n`;

    context += 'Current Allocation vs Limits:\n';
    for (const assetClass of assetClassData.getAllAssetClasses()) {
      const current = (currentAllocation[assetClass] || 0) * 100;
      const limit = limits[assetClass] * 100;
      const status = current > limit * 0.8 ? '⚠️' : current > 0 ? '✓' : ' ';

      if (current > 0 || limit !== assetClassData.BASE_LIMITS[assetClass]) {
        context += `${status} ${assetClass}: ${current.toFixed(1)}% / ${limit.toFixed(0)}% limit\n`;
      }
    }

    context += '\nHard Limits:\n';
    context += `- Max per asset class: ${assetClassData.HARD_LIMITS.MAX_ASSET_CLASS_ALLOCATION * 100}%\n`;
    context += `- Max stocks per asset class: ${assetClassData.HARD_LIMITS.MAX_STOCKS_PER_ASSET_CLASS}\n`;
    context += `- Min asset classes: ${assetClassData.HARD_LIMITS.MIN_ASSET_CLASSES}\n`;

    return context;
  }
}

export default new AllocationManager();
