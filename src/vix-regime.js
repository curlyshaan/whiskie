import fmp from './fmp.js';
import email from './email.js';
import tradier from './tradier.js';
import { resolveMarketPrice } from './utils.js';

/**
 * VIX Regime Detector
 * Determines market volatility regime and returns position size multipliers
 */
class VixRegime {

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
      };
    } else if (vix < 28) {
      regime = {
        name: 'ELEVATED',
        vix,
        positionSizeMultiplier: 0.75,   // 25% smaller positions
        maxLongAllocation: 0.65,
        maxShortAllocation: 0.15,
        minCashReserve: 0.15,
        description: 'Elevated volatility — reduce position sizes 25%, raise cash',
        newPositionsAllowed: true,
        newShortsAllowed: false,         // No new shorts when volatility is rising
      };
    } else if (vix < 35) {
      regime = {
        name: 'FEAR',
        vix,
        positionSizeMultiplier: 0.50,   // 50% smaller positions
        maxLongAllocation: 0.55,
        maxShortAllocation: 0.10,
        minCashReserve: 0.20,
        description: 'Fear regime — half-size positions only, raise cash to 20%',
        newPositionsAllowed: true,       // Can still buy dips, but smaller
        newShortsAllowed: false,
      };
    } else {
      regime = {
        name: 'PANIC',
        vix,
        positionSizeMultiplier: 0.25,   // Quarter-size only
        maxLongAllocation: 0.45,
        maxShortAllocation: 0.00,
        minCashReserve: 0.30,
        description: 'Panic regime — defensive mode, no new shorts, very small positions only',
        newPositionsAllowed: false,      // Preserve capital
        newShortsAllowed: false,
      };
    }

    console.log(`📊 VIX: ${vix.toFixed(1)} → Regime: ${regime.name} (${regime.description})`);
    return regime;
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

    if (!regime.newShortsAllowed) {
      context += `→ No new short positions today (volatility too high)\n`;
    }

    if (!regime.newPositionsAllowed) {
      context += `→ DEFENSIVE MODE: Preserve capital, no new positions\n`;
    }

    context += `→ Target cash reserve: ${(regime.minCashReserve * 100).toFixed(0)}%\n`;

    return context;
  }
}

export default new VixRegime();
