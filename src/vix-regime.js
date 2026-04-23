import fmp from './fmp.js';
import email from './email.js';
import tradier from './tradier.js';
import { resolveMarketPrice } from './utils.js';

/**
 * VIX Regime Detector
 * Determines market volatility regime and returns position size multipliers
 */
class VixRegime {
  constructor() {
    this.lastRegime = null;
    this.regimeEntryVix = null;
  }

  /**
   * Fetch current VIX level from FMP
   */
  async getCurrentVix() {
    try {
      const quote = await fmp.getQuote('VIX');
      const marketOpen = await tradier.isMarketOpen().catch(() => false);
      return parseFloat(resolveMarketPrice(quote, { marketOpen, fallback: 20 }));
    } catch (error) {
      console.warn('⚠️ Could not fetch VIX, defaulting to 20 (Normal regime)');
      return 20;
    }
  }

  /**
   * Classify VIX into a named regime with trading parameters
   */
  async getRegime() {
    const vix = await this.getCurrentVix();

    if (!this.lastRegime) {
      this.lastRegime = null;
      this.regimeEntryVix = null;
    }

    let regime;

    if (vix < 15) {
      regime = {
        name: 'CALM',
        vix,
        positionSizeMultiplier: 1.10,   // Allow slightly larger positions
        maxLongAllocation: 0.82,
        maxShortAllocation: 0.20,
        minCashReserve: 0.10,
        description: 'Low volatility — full deployment, slightly larger positions allowed',
        newPositionsAllowed: true,
        newShortsAllowed: true,
        convictionShortsAllowed: false,
        shortSizeMultiplier: 1.00,
      };
    } else if (vix < 20) {
      regime = {
        name: 'NORMAL',
        vix,
        positionSizeMultiplier: 1.00,   // Standard sizes
        maxLongAllocation: 0.78,
        maxShortAllocation: 0.20,
        minCashReserve: 0.10,
        description: 'Normal market conditions — standard position sizing',
        newPositionsAllowed: true,
        newShortsAllowed: true,
        convictionShortsAllowed: false,
        shortSizeMultiplier: 1.00,
      };
    } else if (vix < 25) {
      const shouldEnter = vix >= 20.5 || (this.lastRegime === 'ELEVATED' && vix >= 19.0);

      if (!shouldEnter && this.lastRegime === 'NORMAL') {
        regime = {
          name: 'NORMAL',
          vix,
          positionSizeMultiplier: 1.00,
          maxLongAllocation: 0.78,
          maxShortAllocation: 0.20,
          minCashReserve: 0.10,
          description: 'Normal market conditions — standard position sizing',
          newPositionsAllowed: true,
          newShortsAllowed: true,
          convictionShortsAllowed: false,
          shortSizeMultiplier: 1.00,
        };
      } else {
        regime = {
          name: 'ELEVATED',
          vix,
          positionSizeMultiplier: 0.75,
          maxLongAllocation: 0.65,
          maxShortAllocation: 0.15,
          minCashReserve: 0.15,
          description: 'Elevated volatility — reduce sizes 25%, high-conviction shorts only',
          newPositionsAllowed: true,
          newShortsAllowed: false,
          convictionShortsAllowed: true,
          shortSizeMultiplier: 0.50,
          shortConvictionRequired: true,
          shortConvictionCriteria: {
            minMarketCap: 10_000_000_000,
            maxIV: 0.70,
            requireETB: true,
            requireTechnicalConfirmation: true,
            requireFundamentalDeterioration: true,
            maxPositionSize: 0.05,
            noEarningsWithinDays: 14,
          },
        };
      }
    } else if (vix < 28) {
      regime = {
        name: 'CAUTION',
        vix,
        positionSizeMultiplier: 0.60,
        maxLongAllocation: 0.60,
        maxShortAllocation: 0.10,
        minCashReserve: 0.18,
        description: 'Caution regime — defensive positioning, exceptional shorts only',
        newPositionsAllowed: true,
        newShortsAllowed: false,
        convictionShortsAllowed: true,
        shortSizeMultiplier: 0.30,
        shortConvictionRequired: true,
        shortTypesAllowed: ['hedge', 'extreme_deterioration'],
        shortConvictionCriteria: {
          minMarketCap: 50_000_000_000,
          maxIV: 0.60,
          requireETB: true,
          requireTechnicalConfirmation: true,
          requireFundamentalDeterioration: true,
          maxPositionSize: 0.03,
          noEarningsWithinDays: 21,
        },
      };
    } else if (vix < 35) {
      regime = {
        name: 'FEAR',
        vix,
        positionSizeMultiplier: 0.50,
        maxLongAllocation: 0.55,
        maxShortAllocation: 0.05,
        minCashReserve: 0.20,
        description: 'Fear regime — defensive mode, quality longs only, no single-name shorts',
        newPositionsAllowed: true,
        newPositionsQualityOnly: true,
        newShortsAllowed: false,
        convictionShortsAllowed: false,
        hedgeShortsAllowed: true,
        shortSizeMultiplier: 0.00,
      };
    } else {
      regime = {
        name: 'PANIC',
        vix,
        positionSizeMultiplier: 0.25,
        maxLongAllocation: 0.45,
        maxShortAllocation: 0.00,
        minCashReserve: 0.30,
        description: 'Panic regime — defensive mode, no new positions',
        newPositionsAllowed: false,
        newShortsAllowed: false,
        convictionShortsAllowed: false,
        shortSizeMultiplier: 0.00,
      };
    }

    this.lastRegime = regime.name;
    this.regimeEntryVix = vix;

    console.log(`📊 VIX: ${vix.toFixed(1)} → Regime: ${regime.name} (${regime.description})`);
    return regime;
  }

  async validateConvictionShort(symbol, marketCap, iv, fundamentalThesis, technicalConfirmation, nextEarningsDate) {
    const regime = await this.getRegime();

    if (!regime.convictionShortsAllowed) {
      return {
        allowed: false,
        reason: `${regime.name} regime does not allow conviction shorts`
      };
    }

    const criteria = regime.shortConvictionCriteria;
    const errors = [];
    const warnings = [];

    if (marketCap < criteria.minMarketCap) {
      errors.push(`Market cap $${(marketCap / 1e9).toFixed(1)}B below ${(criteria.minMarketCap / 1e9).toFixed(0)}B minimum`);
    }

    if (iv > criteria.maxIV) {
      errors.push(`IV ${(iv * 100).toFixed(0)}% exceeds ${(criteria.maxIV * 100).toFixed(0)}% max`);
    }

    if (!fundamentalThesis || fundamentalThesis.length < 50) {
      errors.push('Conviction short requires documented fundamental deterioration thesis (min 50 chars)');
    }

    if (!technicalConfirmation) {
      warnings.push('Technical confirmation recommended');
    }

    if (nextEarningsDate && criteria.noEarningsWithinDays) {
      const daysToEarnings = Math.floor((new Date(nextEarningsDate) - new Date()) / (1000 * 60 * 60 * 24));
      if (daysToEarnings < criteria.noEarningsWithinDays) {
        errors.push(`Earnings in ${daysToEarnings} days, need ${criteria.noEarningsWithinDays}+ days buffer`);
      }
    }

    return {
      allowed: errors.length === 0,
      errors,
      warnings,
      maxPositionSize: criteria.maxPositionSize,
      sizeMultiplier: regime.shortSizeMultiplier,
      regime: regime.name
    };
  }

  /**
   * Apply VIX multiplier to a proposed position size
   */
  async adjustPositionSize(proposedSize, maxAllowed = 0.12) {
    const regime = await this.getRegime();
    const adjusted = Math.min(proposedSize * regime.positionSizeMultiplier, maxAllowed);

    if (adjusted < proposedSize) {
      console.log(`📉 VIX adjustment: Position size reduced from ${(proposedSize*100).toFixed(1)}% to ${(adjusted*100).toFixed(1)}% (${regime.name} regime)`);
    }
    return adjusted;
  }

  /**
   * Build VIX context string for Claude's prompt
   */
  async buildPromptContext() {
    const regime = await this.getRegime();

    let context = `\nMARKET REGIME: ${regime.name} (VIX: ${regime.vix.toFixed(1)})\n`;
    context += `→ ${regime.description}\n`;

    if (regime.positionSizeMultiplier !== 1.0) {
      context += `→ Position sizes adjusted by ${(regime.positionSizeMultiplier * 100).toFixed(0)}%\n`;
    }

    if (regime.convictionShortsAllowed) {
      context += `→ High-conviction shorts allowed with strict criteria:\n`;
      context += `  • Size: ${(regime.shortSizeMultiplier * 100).toFixed(0)}% of normal (max ${(regime.shortConvictionCriteria.maxPositionSize * 100).toFixed(0)}% position)\n`;
      context += `  • Market cap: $${(regime.shortConvictionCriteria.minMarketCap / 1e9).toFixed(0)}B+ only\n`;
      context += `  • IV: <${(regime.shortConvictionCriteria.maxIV * 100).toFixed(0)}%\n`;
      context += `  • Requires: Fundamental deterioration thesis + technical confirmation\n`;
      context += `  • No earnings within ${regime.shortConvictionCriteria.noEarningsWithinDays} days\n`;
    } else if (!regime.newShortsAllowed && regime.hedgeShortsAllowed) {
      context += `→ No single-name shorts (index hedges only)\n`;
    } else if (!regime.newShortsAllowed) {
      context += `→ No new short positions (volatility too high)\n`;
    }

    if (regime.newPositionsQualityOnly) {
      context += `→ New longs: Quality/defensive bias only\n`;
    }

    if (!regime.newPositionsAllowed) {
      context += `→ DEFENSIVE MODE: Preserve capital, no new positions\n`;
    }

    context += `→ Target cash reserve: ${(regime.minCashReserve * 100).toFixed(0)}%\n`;

    return context;
  }
}

export default new VixRegime();
