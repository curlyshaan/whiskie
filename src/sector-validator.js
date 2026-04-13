/**
 * Sector Constraint Validator
 * Enforces 0-3 stocks per sub-sector rule (combined longs + shorts)
 */

class SectorValidator {
  constructor() {
    // Sub-sector mappings
    this.SUB_SECTORS = {
      // Technology
      'Semiconductors': ['NVDA', 'AMD', 'INTC', 'TSM', 'AVGO', 'QCOM', 'TXN', 'AMAT', 'LRCX', 'KLAC', 'MU', 'NXPI'],
      'Software': ['MSFT', 'ORCL', 'CRM', 'ADBE', 'NOW', 'INTU', 'WDAY', 'TEAM', 'SNOW', 'DDOG', 'ZS', 'CRWD', 'PANW'],
      'Cloud': ['AMZN', 'GOOGL', 'MSFT', 'ORCL', 'IBM'],
      'Cybersecurity': ['CRWD', 'ZS', 'PANW', 'FTNT', 'S', 'OKTA', 'NET'],
      'E-commerce': ['AMZN', 'SHOP', 'EBAY', 'ETSY', 'W'],
      'Media & Entertainment': ['SPOT', 'NFLX', 'DIS', 'PARA', 'WBD'],

      // Healthcare
      'Biotech': ['GILD', 'AMGN', 'REGN', 'VRTX', 'BIIB', 'MRNA', 'BNTX'],
      'Pharma': ['JNJ', 'PFE', 'MRK', 'ABBV', 'LLY', 'BMY', 'GSK'],
      'Medical Devices': ['MDT', 'ABT', 'TMO', 'DHR', 'SYK', 'BSX', 'EW'],
      'Healthcare Services': ['CVS', 'UNH', 'CI', 'HUM', 'ELV', 'CNC'],

      // Financial Services
      'Banks': ['JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'USB', 'PNC', 'TFC'],
      'Insurance': ['BRK.B', 'UNH', 'PGR', 'MET', 'AIG', 'ALL', 'TRV'],
      'Payments': ['V', 'MA', 'PYPL', 'SQ', 'AXP'],
      'Asset Managers': ['BLK', 'APO', 'KKR', 'BX', 'ARES', 'CG'],

      // Professional Services
      'Consulting': ['ACN', 'IBM', 'CTSH', 'LDOS'],
      'HR & Payroll': ['ADP', 'PAYX', 'WEX'],

      // Consumer
      'Retail': ['WMT', 'TGT', 'COST', 'HD', 'LOW', 'TJX', 'ROST'],
      'Restaurants': ['MCD', 'SBUX', 'CMG', 'YUM', 'QSR', 'DPZ'],
      'Apparel': ['NKE', 'LULU', 'TJX', 'ROST', 'GPS', 'UAA'],

      // Industrials
      'Aerospace': ['BA', 'LMT', 'RTX', 'GD', 'NOC', 'TXT'],
      'Transportation': ['UPS', 'FDX', 'DAL', 'UAL', 'AAL', 'LUV'],

      // Energy
      'Oil & Gas': ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'PXD', 'MPC'],
      'Renewables': ['NEE', 'ENPH', 'SEDG', 'FSLR', 'RUN']
    };

    this.MAX_PER_SUBSECTOR = 3;
  }

  /**
   * Get sub-sector for a symbol
   */
  getSubSector(symbol) {
    for (const [subSector, symbols] of Object.entries(this.SUB_SECTORS)) {
      if (symbols.includes(symbol)) {
        return subSector;
      }
    }
    return 'Other';
  }

  /**
   * Validate trade recommendations against sector constraints
   * Returns: { valid: boolean, violations: [], adjustedTrades: [] }
   */
  validateTrades(trades) {
    const subSectorCounts = {};
    const violations = [];
    const validTrades = [];

    // Count stocks per sub-sector
    trades.forEach(trade => {
      const subSector = this.getSubSector(trade.symbol);

      if (!subSectorCounts[subSector]) {
        subSectorCounts[subSector] = [];
      }

      subSectorCounts[subSector].push(trade);
    });

    // Check for violations and keep only top 3 per sub-sector
    for (const [subSector, subSectorTrades] of Object.entries(subSectorCounts)) {
      if (subSectorTrades.length > this.MAX_PER_SUBSECTOR) {
        // Sort by conviction/score (if available) or keep first 3
        const sorted = subSectorTrades.sort((a, b) => {
          const scoreA = a.conviction === 'High' ? 2 : a.conviction === 'Medium' ? 1 : 0;
          const scoreB = b.conviction === 'High' ? 2 : b.conviction === 'Medium' ? 1 : 0;
          return scoreB - scoreA;
        });

        // Keep top 3
        validTrades.push(...sorted.slice(0, this.MAX_PER_SUBSECTOR));

        // Record violations
        const rejected = sorted.slice(this.MAX_PER_SUBSECTOR);
        rejected.forEach(trade => {
          violations.push({
            symbol: trade.symbol,
            subSector,
            reason: `Sub-sector ${subSector} already has ${this.MAX_PER_SUBSECTOR} positions`,
            rejectedTrade: trade
          });
        });
      } else {
        validTrades.push(...subSectorTrades);
      }
    }

    return {
      valid: violations.length === 0,
      violations,
      adjustedTrades: validTrades,
      subSectorBreakdown: Object.entries(subSectorCounts).map(([subSector, trades]) => ({
        subSector,
        count: Math.min(trades.length, this.MAX_PER_SUBSECTOR),
        symbols: trades.slice(0, this.MAX_PER_SUBSECTOR).map(t => t.symbol)
      }))
    };
  }

  /**
   * Get current sub-sector exposure from portfolio
   */
  getPortfolioSubSectorExposure(positions) {
    const exposure = {};

    positions.forEach(position => {
      const subSector = this.getSubSector(position.symbol);

      if (!exposure[subSector]) {
        exposure[subSector] = {
          count: 0,
          symbols: [],
          totalValue: 0
        };
      }

      exposure[subSector].count++;
      exposure[subSector].symbols.push(position.symbol);
      exposure[subSector].totalValue += position.quantity * position.currentPrice;
    });

    return exposure;
  }

  /**
   * Check if adding a new position would violate constraints
   */
  canAddPosition(symbol, currentPositions) {
    const subSector = this.getSubSector(symbol);
    const exposure = this.getPortfolioSubSectorExposure(currentPositions);

    if (exposure[subSector] && exposure[subSector].count >= this.MAX_PER_SUBSECTOR) {
      return {
        allowed: false,
        reason: `Sub-sector ${subSector} already has ${this.MAX_PER_SUBSECTOR} positions: ${exposure[subSector].symbols.join(', ')}`,
        subSector,
        currentCount: exposure[subSector].count
      };
    }

    return {
      allowed: true,
      subSector,
      currentCount: exposure[subSector]?.count || 0
    };
  }
}

export default new SectorValidator();
