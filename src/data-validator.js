/**
 * Data Validation Layer
 * Validates FMP data for outliers and missing values
 */

class DataValidator {
  constructor() {
    this.OUTLIER_THRESHOLDS = {
      peRatio: { min: 0, max: 1000 },
      pegRatio: { min: 0, max: 50 },
      priceToBook: { min: 0, max: 100 },
      priceToSales: { min: 0, max: 100 },
      debtToEquity: { min: 0, max: 20 },
      operatingMargin: { min: -2, max: 1 },
      profitMargin: { min: -2, max: 1 }
    };
  }

  /**
   * Validate fundamental data
   */
  validateFundamentals(data, symbol) {
    const warnings = [];
    const errors = [];

    // Check for missing critical fields
    if (!data.marketCap || data.marketCap <= 0) {
      errors.push(`${symbol}: Missing or invalid market cap`);
    }

    if (!data.sector || data.sector === 'Unknown') {
      warnings.push(`${symbol}: Missing sector classification`);
    }

    // Check for outliers
    for (const [field, thresholds] of Object.entries(this.OUTLIER_THRESHOLDS)) {
      const value = data[field];
      if (value !== null && value !== undefined) {
        if (value < thresholds.min || value > thresholds.max) {
          warnings.push(`${symbol}: ${field} = ${value} (outlier, expected ${thresholds.min}-${thresholds.max})`);
        }
      }
    }

    // Check for negative revenue (data error)
    if (data.revenue && data.revenue < 0) {
      errors.push(`${symbol}: Negative revenue (${data.revenue}) - data error`);
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors
    };
  }

  /**
   * Validate and clean data
   */
  cleanData(data, symbol) {
    const validation = this.validateFundamentals(data, symbol);

    if (!validation.valid) {
      console.warn(`⚠️ Data validation failed for ${symbol}:`, validation.errors);
      return null;
    }

    if (validation.warnings.length > 0) {
      console.warn(`⚠️ Data warnings for ${symbol}:`, validation.warnings);
    }

    return data;
  }
}

export default new DataValidator();
