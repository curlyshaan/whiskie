import tradier from './tradier.js';
import * as db from './db.js';

/**
 * Correlation Analysis
 * Prevents portfolio concentration by checking correlation between positions
 */

class CorrelationAnalysis {
  constructor() {
    this.groupCache = null;
    this.groupCacheAt = 0;
    this.CACHE_TTL_MS = 15 * 60 * 1000;
  }

  async getCorrelationGroups() {
    const now = Date.now();
    if (this.groupCache && (now - this.groupCacheAt) < this.CACHE_TTL_MS) {
      return this.groupCache;
    }

    const result = await db.query(
      `SELECT symbol, sector, industry
       FROM stock_universe
       WHERE status = 'active'`
    );

    const groups = {};
    for (const row of result.rows) {
      const sector = String(row.sector || '').trim();
      const industry = String(row.industry || '').trim();
      const symbol = row.symbol;

      if (industry) {
        const key = `industry:${industry.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(symbol);
      }

      if (sector) {
        const key = `sector:${sector.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(symbol);
      }
    }

    this.groupCache = groups;
    this.groupCacheAt = now;
    return groups;
  }

  /**
   * Check if adding a new position would create high correlation
   */
  async checkCorrelation(newSymbol, existingPositions) {
    const warnings = [];
    const correlatedPositions = [];

    // Find which group the new symbol belongs to
    const newSymbolGroups = await this.findCorrelationGroups(newSymbol);

    if (newSymbolGroups.length === 0) {
      // Symbol not in any known correlation group - likely safe
      return { hasHighCorrelation: false, warnings, correlatedPositions };
    }

    // Check if we already have positions in the same correlation groups
    for (const position of existingPositions) {
      const positionGroups = await this.findCorrelationGroups(position.symbol);

      // Find overlapping groups
      const overlappingGroups = newSymbolGroups.filter(g => positionGroups.includes(g));

      if (overlappingGroups.length > 0) {
        correlatedPositions.push({
          symbol: position.symbol,
          groups: overlappingGroups,
          value: position.quantity * position.currentPrice
        });
      }
    }

    if (correlatedPositions.length > 0) {
      const totalCorrelatedValue = correlatedPositions.reduce((sum, p) => sum + p.value, 0);
      const groupNames = [...new Set(correlatedPositions.flatMap(p => p.groups))];

      warnings.push(
        `High correlation risk: ${newSymbol} is in same group(s) as ${correlatedPositions.length} existing position(s)`
      );
      warnings.push(
        `Correlation groups: ${groupNames.join(', ')}`
      );
      warnings.push(
        `Existing correlated positions: ${correlatedPositions.map(p => p.symbol).join(', ')}`
      );
      warnings.push(
        `Total correlated value: $${totalCorrelatedValue.toLocaleString()}`
      );

      return {
        hasHighCorrelation: true,
        warnings,
        correlatedPositions,
        correlationGroups: groupNames
      };
    }

    return { hasHighCorrelation: false, warnings, correlatedPositions };
  }

  /**
   * Find which correlation groups a symbol belongs to
   */
  async findCorrelationGroups(symbol) {
    const correlationGroups = await this.getCorrelationGroups();
    const groups = [];
    for (const [groupName, symbols] of Object.entries(correlationGroups)) {
      if (symbols.includes(symbol)) {
        groups.push(groupName);
      }
    }
    return groups;
  }

  /**
   * Get portfolio correlation summary
   */
  async getPortfolioCorrelationSummary(positions) {
    const groupCounts = {};
    const groupValues = {};

    for (const position of positions) {
      const groups = await this.findCorrelationGroups(position.symbol);
      const positionValue = position.quantity * position.currentPrice;

      for (const group of groups) {
        groupCounts[group] = (groupCounts[group] || 0) + 1;
        groupValues[group] = (groupValues[group] || 0) + positionValue;
      }
    }

    const concentratedGroups = Object.entries(groupCounts)
      .filter(([_, count]) => count >= 2)
      .map(([group, count]) => ({
        group,
        count,
        value: groupValues[group]
      }))
      .sort((a, b) => b.count - a.count);

    return {
      concentratedGroups,
      totalGroups: Object.keys(groupCounts).length,
      hasConcentration: concentratedGroups.length > 0
    };
  }

  /**
   * Calculate diversification score (0-100)
   * Higher is better (more diversified)
   */
  async calculateDiversificationScore(positions) {
    if (positions.length === 0) return 100;

    const summary = await this.getPortfolioCorrelationSummary(positions);

    // Penalty for concentrated groups
    let score = 100;
    for (const group of summary.concentratedGroups) {
      // -10 points for each additional position in same group
      score -= (group.count - 1) * 10;
    }

    // Bonus for having positions across multiple groups
    if (summary.totalGroups >= 5) score += 10;
    if (summary.totalGroups >= 8) score += 10;

    return Math.max(0, Math.min(100, score));
  }
}

export default new CorrelationAnalysis();
