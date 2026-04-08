import tradier from './tradier.js';
import * as db from './db.js';

/**
 * Performance Analyzer
 * Learns from past trades using Tradier gain/loss reports
 */
class PerformanceAnalyzer {
  /**
   * Analyze trading performance and extract lessons
   */
  async analyzePerformance() {
    try {
      // Get gain/loss report from Tradier
      const gainLoss = await tradier.getGainLoss();

      if (!gainLoss || !gainLoss.closed_position) {
        return null;
      }

      const positions = Array.isArray(gainLoss.closed_position)
        ? gainLoss.closed_position
        : [gainLoss.closed_position];

      // Analyze winners and losers
      const winners = positions.filter(p => parseFloat(p.gain_loss) > 0);
      const losers = positions.filter(p => parseFloat(p.gain_loss) < 0);

      // Calculate statistics
      const totalTrades = positions.length;
      const winRate = (winners.length / totalTrades) * 100;
      const avgWin = winners.reduce((sum, p) => sum + parseFloat(p.gain_loss), 0) / (winners.length || 1);
      const avgLoss = losers.reduce((sum, p) => sum + parseFloat(p.gain_loss), 0) / (losers.length || 1);
      const profitFactor = Math.abs(avgWin * winners.length) / Math.abs(avgLoss * losers.length);

      // Identify patterns
      const patterns = this.identifyPatterns(winners, losers);

      return {
        totalTrades,
        winners: winners.length,
        losers: losers.length,
        winRate: winRate.toFixed(1) + '%',
        avgWin: '$' + avgWin.toFixed(2),
        avgLoss: '$' + avgLoss.toFixed(2),
        profitFactor: profitFactor.toFixed(2),
        patterns,
        topWinners: this.getTopPositions(winners, 5),
        topLosers: this.getTopPositions(losers, 5)
      };
    } catch (error) {
      console.error('Error analyzing performance:', error.message);
      return null;
    }
  }

  /**
   * Identify patterns in winning and losing trades
   */
  identifyPatterns(winners, losers) {
    const patterns = [];

    // Analyze hold duration
    const winnerDurations = winners.map(p => this.calculateHoldDays(p.open_date, p.close_date));
    const loserDurations = losers.map(p => this.calculateHoldDays(p.open_date, p.close_date));

    const avgWinDuration = winnerDurations.reduce((a, b) => a + b, 0) / (winnerDurations.length || 1);
    const avgLossDuration = loserDurations.reduce((a, b) => a + b, 0) / (loserDurations.length || 1);

    if (avgWinDuration < avgLossDuration) {
      patterns.push(`Winners held ${avgWinDuration.toFixed(0)} days avg vs losers ${avgLossDuration.toFixed(0)} days - cutting winners too early?`);
    } else {
      patterns.push(`Winners held ${avgWinDuration.toFixed(0)} days avg vs losers ${avgLossDuration.toFixed(0)} days - good discipline`);
    }

    // Analyze by symbol (repeated mistakes)
    const loserSymbols = {};
    losers.forEach(p => {
      loserSymbols[p.symbol] = (loserSymbols[p.symbol] || 0) + 1;
    });

    const repeatedLosers = Object.entries(loserSymbols)
      .filter(([_, count]) => count > 1)
      .sort((a, b) => b[1] - a[1]);

    if (repeatedLosers.length > 0) {
      patterns.push(`Repeated losses in: ${repeatedLosers.map(([sym, count]) => `${sym} (${count}x)`).join(', ')}`);
    }

    return patterns;
  }

  /**
   * Calculate days held
   */
  calculateHoldDays(openDate, closeDate) {
    const open = new Date(openDate);
    const close = new Date(closeDate);
    return Math.floor((close - open) / (1000 * 60 * 60 * 24));
  }

  /**
   * Get top positions by gain/loss
   */
  getTopPositions(positions, limit) {
    return positions
      .sort((a, b) => Math.abs(parseFloat(b.gain_loss)) - Math.abs(parseFloat(a.gain_loss)))
      .slice(0, limit)
      .map(p => ({
        symbol: p.symbol,
        gainLoss: '$' + parseFloat(p.gain_loss).toFixed(2),
        gainLossPercent: parseFloat(p.gain_loss_percent).toFixed(2) + '%',
        daysHeld: this.calculateHoldDays(p.open_date, p.close_date)
      }));
  }

  /**
   * Compare current strategy to historical performance
   */
  async compareToHistory(currentPositions) {
    const performance = await this.analyzePerformance();
    if (!performance) return null;

    const insights = [];

    // Check if current positions match historical winners
    for (const position of currentPositions) {
      const historicalWins = performance.topWinners.filter(w => w.symbol === position.symbol);
      const historicalLosses = performance.topLosers.filter(l => l.symbol === position.symbol);

      if (historicalWins.length > 0) {
        insights.push(`${position.symbol}: Previously won ${historicalWins[0].gainLossPercent} - good track record`);
      }
      if (historicalLosses.length > 1) {
        insights.push(`${position.symbol}: Multiple historical losses - exercise caution`);
      }
    }

    return {
      performance,
      insights
    };
  }
}

export default new PerformanceAnalyzer();
