/**
 * Macro Regime Detection
 * Monitors Fed policy, yield curve, unemployment, sector rotation
 */

import axios from 'axios';
import * as db from './db.js';

class MacroRegimeDetector {
  constructor() {
    // FRED API for economic data (free, no key required for basic access)
    this.FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';
  }

  /**
   * Detect current macro regime
   */
  async detectRegime() {
    try {
      const [yieldCurve, unemployment, fedFunds] = await Promise.all([
        this.getYieldCurveSpread(),
        this.getUnemploymentRate(),
        this.getFedFundsRate()
      ]);

      const regime = this.classifyRegime(yieldCurve, unemployment, fedFunds);

      // Save to database
      await db.query(
        `INSERT INTO macro_regime_log (regime, yield_curve, unemployment, fed_funds, detected_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [regime.name, yieldCurve, unemployment, fedFunds]
      );

      return regime;

    } catch (error) {
      console.warn('Could not detect macro regime:', error.message);
      return { name: 'UNKNOWN', description: 'Unable to fetch macro data' };
    }
  }

  /**
   * Get yield curve spread (10Y - 2Y)
   */
  async getYieldCurveSpread() {
    // Placeholder - would fetch from FRED or similar
    // For now, return mock data
    return 0.5; // 50 basis points
  }

  /**
   * Get unemployment rate
   */
  async getUnemploymentRate() {
    // Placeholder - would fetch from FRED
    return 4.2; // 4.2%
  }

  /**
   * Get Fed Funds rate
   */
  async getFedFundsRate() {
    // Placeholder - would fetch from FRED
    return 4.5; // 4.5%
  }

  /**
   * Classify macro regime
   */
  classifyRegime(yieldCurve, unemployment, fedFunds) {
    // Inverted yield curve + rising unemployment = RECESSION
    if (yieldCurve < 0 && unemployment > 5.0) {
      return {
        name: 'RECESSION',
        description: 'Inverted yield curve + rising unemployment',
        recommendation: 'Defensive positioning, quality stocks, reduce leverage'
      };
    }

    // Steep yield curve + low unemployment = EXPANSION
    if (yieldCurve > 1.0 && unemployment < 4.5) {
      return {
        name: 'EXPANSION',
        description: 'Steep yield curve + low unemployment',
        recommendation: 'Growth stocks, cyclicals, higher risk tolerance'
      };
    }

    // High Fed Funds + flattening curve = LATE CYCLE
    if (fedFunds > 4.0 && yieldCurve < 0.5) {
      return {
        name: 'LATE_CYCLE',
        description: 'High rates + flattening curve',
        recommendation: 'Cautious, favor quality, watch for recession signals'
      };
    }

    // Default
    return {
      name: 'MID_CYCLE',
      description: 'Normal economic conditions',
      recommendation: 'Balanced approach, diversified portfolio'
    };
  }
}

export default new MacroRegimeDetector();
