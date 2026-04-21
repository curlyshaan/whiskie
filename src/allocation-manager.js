import vixRegime from './vix-regime.js';
import * as db from './db.js';

/**
 * Allocation Manager
 * DEPRECATED: Asset class allocation replaced by sector-based allocation
 * Kept for backward compatibility with minimal stubs
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
   * Get asset class limit (DEPRECATED - returns default)
   */
  async getAssetClassLimit(assetClass) {
    return 0.30; // Default 30% limit
  }

  /**
   * Get all asset class limits
   * Returns 30% limit for all sectors (from MAX_SECTOR_ALLOCATION env var)
   */
  async getAllAssetClassLimits() {
    const maxSectorAllocation = parseFloat(process.env.MAX_SECTOR_ALLOCATION) || 0.30;

    // Return default limit for all sectors
    // This will be used as fallback for any sector not explicitly defined
    return new Proxy({}, {
      get: (target, prop) => maxSectorAllocation
    });
  }

  /**
   * Calculate asset class allocation (DEPRECATED - uses sectors)
   */
  calculateAssetClassAllocation(portfolio) {
    const allocation = {};

    for (const position of portfolio.positions) {
      const sector = position.sector || 'Unknown';
      const positionValue = position.quantity * position.currentPrice;

      if (!allocation[sector]) {
        allocation[sector] = 0;
      }
      allocation[sector] += positionValue;
    }

    // Convert to percentages
    const allocationPct = {};
    for (const [sector, value] of Object.entries(allocation)) {
      allocationPct[sector] = value / portfolio.totalValue;
    }

    return allocationPct;
  }

  /**
   * Validate asset class allocation (DEPRECATED - always returns valid)
   */
  async validateAssetClassAllocation(symbol, tradeValue, portfolio) {
    return {
      valid: true,
      assetClass: 'Unknown',
      currentAllocation: 0,
      newAllocation: 0,
      limit: 0.30
    };
  }

  /**
   * Check minimum diversification (DEPRECATED - always returns valid)
   */
  checkMinimumDiversification(portfolio) {
    return {
      valid: true,
      assetClassCount: 0
    };
  }

  /**
   * Build allocation context (DEPRECATED - returns minimal context)
   */
  async buildAllocationContext(portfolio) {
    const regime = await vixRegime.getRegime();
    const maxSectorAllocation = parseFloat(process.env.MAX_SECTOR_ALLOCATION) || 0.30;

    let context = '\n**SECTOR ALLOCATION:**\n';
    context += `VIX Regime: ${regime.name}\n\n`;
    context += `Note: Sector allocation is managed via max ${(maxSectorAllocation * 100).toFixed(0)}% per sector plus max 3 positions per industry.\n`;

    return context;
  }
}

export default new AllocationManager();
