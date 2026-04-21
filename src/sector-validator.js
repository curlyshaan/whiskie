/**
 * Industry Constraint Validator
 * Enforces 0-3 stocks per industry rule (combined longs + shorts)
 */

import * as db from './db.js';

class SectorValidator {
  constructor() {
    this.MAX_PER_INDUSTRY = 3;
    this.industryCache = new Map();
  }

  /**
   * Get industry bucket for a symbol from FMP-aligned stock_universe metadata
   */
  async getIndustry(symbol) {
    if (this.industryCache.has(symbol)) {
      return this.industryCache.get(symbol);
    }

    const info = await db.getStockInfo(symbol);
    const industry = info?.industry || info?.sector || 'Unknown';
    this.industryCache.set(symbol, industry);
    return industry;
  }

  /**
   * Validate trade recommendations against industry constraints
   * Returns: { valid: boolean, violations: [], adjustedTrades: [] }
   */
  async validateTrades(trades) {
    const industryCounts = {};
    const violations = [];
    const validTrades = [];
    const getPriorityScore = (trade) => {
      const convictionScore = trade.confidence === 'High' ? 3 : trade.confidence === 'Medium' ? 2 : trade.confidence === 'Low' ? 1 : 0;
      const overridePenalty = trade.overridePhase2Decision && String(trade.overridePhase2Decision).toUpperCase() === 'YES' ? -1000 : 0;
      const quantityScore = Number(trade.quantity || 0) / 10000;
      return convictionScore + quantityScore + overridePenalty;
    };

    // Count stocks per industry
    for (const trade of trades) {
      const industry = await this.getIndustry(trade.symbol);
      trade.industryBucket = industry;

      if (!industryCounts[industry]) {
        industryCounts[industry] = [];
      }

      industryCounts[industry].push(trade);
    }

    // Check for violations and keep only top 3 per industry
    for (const [industry, industryTrades] of Object.entries(industryCounts)) {
      if (industryTrades.length > this.MAX_PER_INDUSTRY) {
        const sorted = industryTrades.sort((a, b) => {
          return getPriorityScore(b) - getPriorityScore(a);
        });

        // Keep top 3
        validTrades.push(...sorted.slice(0, this.MAX_PER_INDUSTRY));

        // Record violations
        const rejected = sorted.slice(this.MAX_PER_INDUSTRY);
        rejected.forEach(trade => {
          violations.push({
            symbol: trade.symbol,
            industry,
            reason: `Industry ${industry} already has ${this.MAX_PER_INDUSTRY} positions`,
            rejectedTrade: trade
          });
        });
      } else {
        validTrades.push(...industryTrades);
      }
    }

    return {
      valid: violations.length === 0,
      violations,
      adjustedTrades: validTrades,
      industryBreakdown: Object.entries(industryCounts).map(([industry, trades]) => ({
        industry,
        count: Math.min(trades.length, this.MAX_PER_INDUSTRY),
        symbols: trades
          .slice()
          .sort((a, b) => getPriorityScore(b) - getPriorityScore(a))
          .slice(0, this.MAX_PER_INDUSTRY)
          .map(t => t.symbol)
      }))
    };
  }

  /**
   * Get current industry exposure from portfolio
   */
  async getPortfolioIndustryExposure(positions) {
    const exposure = {};

    for (const position of positions) {
      const industry = await this.getIndustry(position.symbol);

      if (!exposure[industry]) {
        exposure[industry] = {
          count: 0,
          symbols: [],
          totalValue: 0
        };
      }

      exposure[industry].count++;
      exposure[industry].symbols.push(position.symbol);
      exposure[industry].totalValue += position.quantity * position.currentPrice;
    }

    return exposure;
  }

  /**
   * Check if adding a new position would violate constraints
   */
  async canAddPosition(symbol, currentPositions) {
    const industry = await this.getIndustry(symbol);
    const exposure = await this.getPortfolioIndustryExposure(currentPositions);

    if (exposure[industry] && exposure[industry].count >= this.MAX_PER_INDUSTRY) {
      return {
        allowed: false,
        reason: `Industry ${industry} already has ${this.MAX_PER_INDUSTRY} positions: ${exposure[industry].symbols.join(', ')}`,
        industry,
        currentCount: exposure[industry].count
      };
    }

    return {
      allowed: true,
      industry,
      currentCount: exposure[industry]?.count || 0
    };
  }
}

export default new SectorValidator();
