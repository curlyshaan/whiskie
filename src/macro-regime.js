/**
 * Macro Regime Detection
 * Monitors Fed policy, yield curve, unemployment, sector rotation
 */

import dotenv from 'dotenv';
import * as db from './db.js';

dotenv.config();

class MacroRegimeDetector {
  constructor() {
    this.FRED_API_KEY = process.env.FRED_API_KEY || '';
    this.FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';
    this.SERIES = {
      yieldCurve: 'T10Y2Y',
      unemployment: 'UNRATE',
      fedFunds: 'FEDFUNDS'
    };
  }

  async fetchLatestSeriesValue(seriesId) {
    const url = new URL(this.FRED_BASE_URL);
    url.searchParams.set('series_id', seriesId);
    if (!this.FRED_API_KEY) {
      throw new Error('FRED_API_KEY is not configured');
    }
    url.searchParams.set('api_key', this.FRED_API_KEY);
    url.searchParams.set('file_type', 'json');
    url.searchParams.set('sort_order', 'desc');
    url.searchParams.set('limit', '5');

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`FRED ${seriesId} request failed: ${response.status}`);
    }

    const data = await response.json();
    const observation = (data.observations || []).find(item => Number.isFinite(Number(item?.value)));
    if (!observation) {
      throw new Error(`No valid observations returned for ${seriesId}`);
    }

    return {
      value: Number(observation.value),
      date: observation.date
    };
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
    const observation = await this.fetchLatestSeriesValue(this.SERIES.yieldCurve);
    return observation.value;
  }

  /**
   * Get unemployment rate
   */
  async getUnemploymentRate() {
    const observation = await this.fetchLatestSeriesValue(this.SERIES.unemployment);
    return observation.value;
  }

  /**
   * Get Fed Funds rate
   */
  async getFedFundsRate() {
    const observation = await this.fetchLatestSeriesValue(this.SERIES.fedFunds);
    return observation.value;
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
