import tradier from './tradier.js';
import fmp from './fmp.js';

/**
 * Sector Rotation Analyzer
 * Uses sector ETF relative strength to identify where institutional money is flowing
 * Updates weekly (called from Sunday Opus review) and injected into daily analysis
 */

// Sector ETF proxies — one per GICS sector
const SECTOR_ETFS = {
  'Technology':             'XLK',
  'Healthcare':             'XLV',
  'Financials':             'XLF',
  'Consumer Discretionary': 'XLY',
  'Consumer Staples':       'XLP',
  'Energy':                 'XLE',
  'Industrials':            'XLI',
  'Materials':              'XLB',
  'Real Estate':            'XLRE',
  'Utilities':              'XLU',
  'Communication Services': 'XLC',
  'Benchmark':              'SPY',  // S&P 500 for relative comparison
};

class SectorRotation {
  async getHistory(symbol, startDate, endDate) {
    try {
      const history = await fmp.getHistoricalPriceEodFull(symbol, startDate, endDate);
      if (Array.isArray(history) && history.length) {
        return history;
      }
    } catch (error) {
      console.warn(`FMP sector history unavailable for ${symbol}:`, error.message);
    }

    return tradier.getHistory(symbol, 'daily', startDate, endDate);
  }

  /**
   * Calculate 4-week and 12-week performance for each sector ETF
   * Compare against SPY to get relative strength
   */
  async analyzeSectorStrength() {
    try {
      const results = {};
      const today = new Date();

      // Dates for lookback periods
      const date4w = new Date(today); date4w.setDate(date4w.getDate() - 28);
      const date12w = new Date(today); date12w.setDate(date12w.getDate() - 84);
      const fmt = d => d.toISOString().split('T')[0];

      // Fetch SPY performance as benchmark
      const spyHistory4w = await this.getHistory('SPY', fmt(date4w), fmt(today));
      const spyHistory12w = await this.getHistory('SPY', fmt(date12w), fmt(today));
      const spyReturn4w = this.calculateReturn(spyHistory4w);
      const spyReturn12w = this.calculateReturn(spyHistory12w);

      // Fetch each sector ETF
      for (const [sector, etf] of Object.entries(SECTOR_ETFS)) {
        if (sector === 'Benchmark') continue;

        try {
          const history4w = await this.getHistory(etf, fmt(date4w), fmt(today));
          const history12w = await this.getHistory(etf, fmt(date12w), fmt(today));

          const return4w = this.calculateReturn(history4w);
          const return12w = this.calculateReturn(history12w);

          // Relative strength vs SPY
          const rs4w = return4w - spyReturn4w;
          const rs12w = return12w - spyReturn12w;

          // Score: weighted combo of 4w (60%) and 12w (40%)
          const score = (rs4w * 0.6) + (rs12w * 0.4);

          results[sector] = {
            etf,
            return4w: return4w.toFixed(2) + '%',
            return12w: return12w.toFixed(2) + '%',
            relativeStrength4w: rs4w.toFixed(2) + '%',
            relativeStrength12w: rs12w.toFixed(2) + '%',
            score: parseFloat(score.toFixed(2)),
          };

          // Rate limit
          await new Promise(r => setTimeout(r, 300));
        } catch (e) {
          console.warn(`Could not fetch sector data for ${sector} (${etf}):`, e.message);
        }
      }

      // Rank sectors
      const ranked = Object.entries(results)
        .sort(([, a], [, b]) => b.score - a.score)
        .map(([sector, data], idx) => ({
          rank: idx + 1,
          sector,
          ...data,
          signal: idx < 3 ? 'LEADING' : idx > 7 ? 'LAGGING' : 'NEUTRAL',
        }));

      return ranked;
    } catch (error) {
      console.error('Error analyzing sector rotation:', error.message);
      return [];
    }
  }

  calculateReturn(history) {
    if (!history || history.length < 2) return 0;
    const first = parseFloat(history[0].close);
    const last = parseFloat(history[history.length - 1].close);
    return ((last - first) / first) * 100;
  }

  /**
   * Build sector rotation context string for Claude's prompt
   */
  buildPromptContext(rankedSectors) {
    if (!rankedSectors || rankedSectors.length === 0) {
      return '\nSECTOR ROTATION: Data unavailable.\n';
    }

    const leading = rankedSectors.filter(s => s.signal === 'LEADING');
    const lagging = rankedSectors.filter(s => s.signal === 'LAGGING');

    let context = '\nSECTOR ROTATION SIGNALS (relative strength vs S&P 500):\n';

    context += 'LEADING SECTORS (overweight longs here):\n';
    leading.forEach(s => {
      context += `  #${s.rank} ${s.sector} (${s.etf}): 4w RS ${s.relativeStrength4w}, 12w RS ${s.relativeStrength12w}\n`;
    });

    context += '\nLAGGING SECTORS (avoid new longs, consider shorts here):\n';
    lagging.forEach(s => {
      context += `  #${s.rank} ${s.sector} (${s.etf}): 4w RS ${s.relativeStrength4w}, 12w RS ${s.relativeStrength12w}\n`;
    });

    context += '\n→ Bias new long entries toward leading sectors. Bias short candidates toward lagging sectors.\n';
    context += '→ This is a directional bias, not a hard rule — individual stock fundamentals take priority.\n';

    return context;
  }
}

export default new SectorRotation();
