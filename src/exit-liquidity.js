/**
 * Exit Liquidity Analyzer
 * Ensures positions can be exited without moving the market
 */

class ExitLiquidityAnalyzer {
  constructor() {
    this.MAX_POSITION_VS_VOLUME = 0.10; // Position should be <10% of avg daily volume
  }

  /**
   * Check if position size is appropriate for exit liquidity
   */
  checkExitLiquidity(positionValue, avgDailyVolume, currentPrice) {
    const avgDollarVolume = avgDailyVolume * currentPrice;
    const positionPct = positionValue / avgDollarVolume;

    if (positionPct > this.MAX_POSITION_VS_VOLUME) {
      return {
        allowed: false,
        reason: `Position is ${(positionPct * 100).toFixed(1)}% of daily volume (max ${(this.MAX_POSITION_VS_VOLUME * 100).toFixed(0)}%) — may be difficult to exit`,
        positionPct,
        avgDollarVolume
      };
    }

    return { allowed: true, positionPct, avgDollarVolume };
  }
}

export default new ExitLiquidityAnalyzer();
