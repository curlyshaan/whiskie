import tradier from './tradier.js';
import fmp from './fmp.js';
import claude from './claude.js';
import tavily from './tavily.js';
import riskManager from './risk-manager.js';
import * as db from './db.js';

/**
 * Portfolio Analysis Engine
 * Multi-factor analysis combining fundamentals and technicals
 */
class AnalysisEngine {
  constructor() {
    this.INITIAL_CAPITAL = parseFloat(process.env.INITIAL_CAPITAL) || 100000;
  }

  /**
   * Get complete portfolio state
   */
  async getPortfolioState() {
    try {
      const balances = await tradier.getBalances();
      const positions = await tradier.getPositions();
      const dbPositions = await db.getPositions();

      // Merge positions
      const mergedPositions = this.mergePositions(positions, dbPositions);

      // Fetch current prices for each position
      for (const position of mergedPositions) {
        try {
          const quote = await fmp.getQuote(position.symbol);
          position.currentPrice = quote.price || quote.previousClose || quote.close || 0;
        } catch (error) {
          console.warn(`⚠️ Failed to fetch price for ${position.symbol}:`, error.message);
          position.currentPrice = 0;
        }
      }

      // Calculate portfolio metrics
      const cash = balances.total_cash || balances.cash?.cash_available || 0;
      const positionsValue = balances.long_market_value || 0;
      let totalValue = balances.total_equity || cash || this.INITIAL_CAPITAL;

      // Safety check: ensure totalValue is never 0 or undefined
      if (!totalValue || totalValue <= 0) {
        console.warn('⚠️ Invalid totalValue from Tradier, using INITIAL_CAPITAL');
        totalValue = this.INITIAL_CAPITAL;
      }

      // Calculate drawdown (peak-to-trough)
      const peakResult = await db.query(
        `SELECT MAX(total_value) as peak FROM portfolio_snapshots`
      );
      const peakValue = parseFloat(peakResult.rows[0]?.peak || this.INITIAL_CAPITAL);
      const peakToUse = Math.max(peakValue, totalValue); // Current value may be new peak

      // True drawdown (always 0 or negative)
      const drawdown = peakToUse > 0 ? (totalValue - peakToUse) / peakToUse : 0;

      // Total return vs initial capital (for reporting)
      const totalReturn = (totalValue - this.INITIAL_CAPITAL) / this.INITIAL_CAPITAL;

      return {
        totalValue,
        cash,
        positionsValue,
        positions: mergedPositions,
        drawdown,
        balances
      };
    } catch (error) {
      console.error('Error getting portfolio state:', error);
      throw error;
    }
  }

  /**
   * Merge Tradier positions with database positions
   */
  mergePositions(tradierPositions, dbPositions) {
    const merged = [];

    // Handle both single position and array
    const positions = Array.isArray(tradierPositions) ? tradierPositions : [tradierPositions];

    for (const tp of positions) {
      if (!tp || !tp.symbol) continue;

      const dbPos = dbPositions.find(p => p.symbol === tp.symbol);

      // Calculate per-share cost basis
      // IMPORTANT: Tradier API returns cost_basis as TOTAL COST, not per-share
      // See: https://docs.tradier.com/reference/brokerage-api-accounts-get-account-positions
      let costBasis = dbPos?.cost_basis || 0;
      if (tp.cost_basis && tp.quantity) {
        const tradierTotalCost = parseFloat(tp.cost_basis);
        const quantity = parseInt(tp.quantity);

        // CRITICAL: Guard against division by zero
        if (quantity === 0) {
          console.warn(`⚠️ Skipping ${tp.symbol}: quantity is zero`);
          continue;
        }

        // Always divide by abs(quantity) to get per-share cost (handles shorts)
        costBasis = tradierTotalCost / Math.abs(quantity);
      }

      // NOTE: Tradier positions API doesn't include current price
      // We'll fetch it separately in getPortfolioState
      merged.push({
        symbol: tp.symbol,
        quantity: tp.quantity,
        cost_basis: costBasis,
        currentPrice: 0, // Will be updated with quote data
        sector: dbPos?.sector || 'Unknown',
        stock_type: dbPos?.stock_type || 'large-cap',
        entry_date: dbPos?.entry_date || new Date(),
        trimmed_1: dbPos?.trimmed_1 || false,
        trimmed_2: dbPos?.trimmed_2 || false,
        trimmed_3: dbPos?.trimmed_3 || false,
        stop_loss: dbPos?.stop_loss,
        take_profit: dbPos?.take_profit
      });
    }

    return merged;
  }

  /**
   * Get sector allocation with separate long/short tracking
   * Returns net exposure per sector
   */
  getSectorAllocationWithShorts(portfolio) {
    const longAllocation = {};
    const shortAllocation = {};

    for (const position of portfolio.positions) {
      const value = Math.abs(position.quantity * position.currentPrice);
      const sector = position.sector || 'Unknown';

      if (position.position_type === 'short') {
        shortAllocation[sector] = (shortAllocation[sector] || 0) + value;
      } else {
        longAllocation[sector] = (longAllocation[sector] || 0) + value;
      }
    }

    // Calculate net exposure per sector
    const netAllocation = {};
    const allSectors = new Set([
      ...Object.keys(longAllocation),
      ...Object.keys(shortAllocation)
    ]);

    for (const sector of allSectors) {
      const longVal = longAllocation[sector] || 0;
      const shortVal = shortAllocation[sector] || 0;
      netAllocation[sector] = {
        long: longVal,
        short: shortVal,
        net: longVal - shortVal,
        longPct: (longVal / portfolio.totalValue) * 100,
        shortPct: (shortVal / portfolio.totalValue) * 100,
        netPct: ((longVal - shortVal) / portfolio.totalValue) * 100
      };
    }

    return netAllocation;
  }

  /**
   * Analyze portfolio health
   */
  async analyzePortfolioHealth(portfolio) {
    const issues = [];
    const opportunities = [];

    // Check each position
    for (const position of portfolio.positions) {
      const currentPrice = position.currentPrice;
      const gain = (currentPrice - position.cost_basis) / position.cost_basis;

      // Check stop-loss triggers
      if (await riskManager.shouldTriggerStopLoss(position, currentPrice)) {
        issues.push({
          type: 'stop-loss',
          symbol: position.symbol,
          message: `${position.symbol} hit stop-loss level`,
          severity: 'high'
        });
      }

      // Check take-profit opportunities
      const takeProfitAction = riskManager.shouldTriggerTakeProfit(position, currentPrice);
      if (takeProfitAction) {
        opportunities.push({
          type: 'take-profit',
          symbol: position.symbol,
          action: takeProfitAction,
          message: `${position.symbol} ${takeProfitAction.reason}`
        });
      }

      // Check positions needing attention (20%+ loss)
      if (riskManager.needsAttention(position, currentPrice)) {
        issues.push({
          type: 'attention',
          symbol: position.symbol,
          message: `${position.symbol} down ${(gain * 100).toFixed(1)}% - needs review`,
          severity: 'medium'
        });
      }
    }

    // Check defensive mode
    if (riskManager.isDefensiveMode(portfolio)) {
      issues.push({
        type: 'defensive-mode',
        message: 'Portfolio in defensive mode - reduce risk',
        severity: 'high',
        actions: riskManager.getDefensiveModeActions()
      });
    }

    return { issues, opportunities };
  }

  /**
   * Calculate technical indicators for a stock using FMP
   * Includes: SMA50, SMA200, RSI, MACD, ATR, MA slopes, volume confirmation,
   * price distance from 200MA, and an integrated buy/short signal score.
   */
  async getTechnicalIndicators(symbol) {
    try {
      // Use FMP for technical indicators (more reliable and consistent)
      const [sma50Data, sma200Data, rsiData] = await Promise.all([
        fmp.getSMA(symbol, 50, '1day'),
        fmp.getSMA(symbol, 200, '1day'),
        fmp.getRSI(symbol, 14, '1day')
      ]);

      if (!sma50Data || !sma200Data || !rsiData || sma200Data.length < 10) {
        console.warn(`Insufficient technical data for ${symbol}`);
        return null;
      }

      // Get latest values
      const latest = sma200Data[0];
      const currentPrice = latest.close;
      const sma50 = sma50Data[0]?.sma || null;
      const sma200 = latest.sma;
      const rsi = rsiData[0]?.rsi || null;

      // Calculate MA slopes from FMP data (compare current to 10 days ago)
      const sma50Slope = sma50Data.length >= 10 ?
        (sma50Data[0].sma - sma50Data[10].sma) / sma50Data[10].sma : null;
      const sma200Slope = sma200Data.length >= 10 ?
        (sma200Data[0].sma - sma200Data[10].sma) / sma200Data[10].sma : null;

      // Price distance from 200MA as a percentage
      const distanceFrom200MA = sma200 ? ((currentPrice - sma200) / sma200) * 100 : null;

      // Volume analysis from recent data
      const recentVolumes = sma200Data.slice(0, 20).map(d => d.volume);
      const avgVolume20 = recentVolumes.reduce((a, b) => a + b, 0) / 20;
      const currentVolume = latest.volume;
      const volumeRatio = avgVolume20 > 0 ? currentVolume / avgVolume20 : null;

      // Calculate ATR from recent data (14-day)
      const atr14 = this.calculateATRFromData(sma200Data.slice(0, 14));
      const atrPercent = atr14 && currentPrice ? (atr14 / currentPrice) * 100 : null;

      // MACD calculation using local method (FMP MACD endpoint not available)
      const macd = this.calculateMACDFromData(sma200Data.slice(0, 35));

      // --- Integrated Buy / Short Signal ---
      const signal = this.calculateTechnicalSignal({
        currentPrice,
        sma50,
        sma200,
        sma50Slope,
        sma200Slope,
        distanceFrom200MA,
        rsi,
        macd,
        volumeRatio
      });

      return {
        currentPrice,
        // Moving averages
        sma50,
        sma200,
        sma50Slope: sma50Slope ? parseFloat(sma50Slope.toFixed(4)) : null,
        sma200Slope: sma200Slope ? parseFloat(sma200Slope.toFixed(4)) : null,
        aboveSMA50: sma50 ? currentPrice > sma50 : null,
        aboveSMA200: sma200 ? currentPrice > sma200 : null,
        distanceFrom200MA: distanceFrom200MA ? parseFloat(distanceFrom200MA.toFixed(2)) : null,
        // Trend summary
        trend: sma200 ? (currentPrice > sma200 ? 'uptrend' : 'downtrend') : 'unknown',
        ma200Trending: sma200Slope > 0 ? 'up' : sma200Slope < 0 ? 'down' : 'flat',
        // Momentum
        rsi,
        macd,
        // Volatility
        atr14: atr14 ? parseFloat(atr14.toFixed(2)) : null,
        atrPercent: atrPercent ? parseFloat(atrPercent.toFixed(2)) : null,
        // Volume
        avgVolume: parseFloat(avgVolume20.toFixed(0)),
        volumeRatio: volumeRatio ? parseFloat(volumeRatio.toFixed(2)) : null,
        volumeConfirmed: volumeRatio ? volumeRatio >= 1.2 : false,
        // Integrated signal
        technicalSignal: signal
      };
    } catch (error) {
      console.error(`Error getting technicals for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Calculate the slope of a moving average over a lookback window.
   * Returns the average daily change of the MA (positive = rising, negative = falling).
   * Uses the last `period`-bar SMA calculated `lookback` bars ago vs. current.
   */
  calculateMASlope(prices, period, lookback) {
    if (prices.length < period + lookback) return null;
    const currentMA = this.calculateSMA(prices, period);
    const pastPrices = prices.slice(0, prices.length - lookback);
    const pastMA = this.calculateSMA(pastPrices, period);
    if (!currentMA || !pastMA || pastMA === 0) return null;
    // Return percentage change per day (annualised sense not needed here)
    return (currentMA - pastMA) / lookback;
  }

  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   * Standard settings: fast EMA 12, slow EMA 26, signal EMA 9
   * Returns: macdLine, signalLine, histogram, and crossover status
   */
  calculateMACD(prices, fast = 12, slow = 26, signal = 9) {
    if (prices.length < slow + signal) return null;

    const emaFast   = this.calculateEMA(prices, fast);
    const emaSlow   = this.calculateEMA(prices, slow);
    if (!emaFast || !emaSlow) return null;

    // Build MACD line history: requires per-bar EMA, not just final value
    // We compute a simplified version using the final EMA values and a
    // rolling MACD line for the signal calculation
    const macdLine = emaFast - emaSlow;

    // Compute MACD line history for signal EMA
    const macdHistory = [];
    for (let i = slow - 1; i < prices.length; i++) {
      const slice = prices.slice(0, i + 1);
      const f = this.calculateEMA(slice, fast);
      const s = this.calculateEMA(slice, slow);
      if (f !== null && s !== null) {
        macdHistory.push(f - s);
      }
    }

    if (macdHistory.length < signal) return null;

    const signalLine = this.calculateEMA(macdHistory, signal);
    if (signalLine === null) return null;

    const histogram = macdLine - signalLine;

    // Determine crossover: check if histogram flipped sign in last 2 bars
    const prevHistogram = macdHistory.length >= 2
      ? macdHistory[macdHistory.length - 2] - this.calculateEMA(macdHistory.slice(0, macdHistory.length - 1), signal)
      : null;

    let crossover = 'none';
    if (prevHistogram !== null) {
      if (prevHistogram < 0 && histogram > 0) crossover = 'bullish';   // MACD crossed above signal
      if (prevHistogram > 0 && histogram < 0) crossover = 'bearish';   // MACD crossed below signal
    }

    return {
      macdLine:   parseFloat(macdLine.toFixed(4)),
      signalLine: parseFloat(signalLine.toFixed(4)),
      histogram:  parseFloat(histogram.toFixed(4)),
      bullish:    macdLine > signalLine,   // MACD above signal = bullish momentum
      crossover
    };
  }

  /**
   * Calculate Exponential Moving Average (EMA)
   * Uses standard smoothing factor: 2 / (period + 1)
   */
  calculateEMA(prices, period) {
    if (prices.length < period) return null;

    const k = 2 / (period + 1);
    // Seed with SMA of first `period` bars
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }

    return ema;
  }

  /**
   * Calculate Average True Range (ATR) - 14-period standard
   * ATR = average of True Range over the period
   * True Range = max(high-low, |high-prevClose|, |low-prevClose|)
   * Used for stop-loss sizing and volatility assessment.
   */
  calculateATR(highs, lows, closes, period = 14) {
    if (highs.length < period + 1) return null;

    const trueRanges = [];
    for (let i = 1; i < highs.length; i++) {
      const hl  = highs[i] - lows[i];
      const hpc = Math.abs(highs[i] - closes[i - 1]);
      const lpc = Math.abs(lows[i] - closes[i - 1]);
      trueRanges.push(Math.max(hl, hpc, lpc));
    }

    // Use Wilder's smoothing (same as RSI): seed with simple average, then smooth
    let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trueRanges.length; i++) {
      atr = (atr * (period - 1) + trueRanges[i]) / period;
    }

    return atr;
  }

  /**
   * Calculate ATR from FMP data structure
   * @param {Array} data - Array of {date, open, high, low, close, volume}
   * @returns {number} ATR value
   */
  calculateATRFromData(data, period = 14) {
    if (!data || data.length < period + 1) return null;

    const trueRanges = [];
    for (let i = 0; i < data.length - 1; i++) {
      const current = data[i];
      const prev = data[i + 1];
      const hl = current.high - current.low;
      const hpc = Math.abs(current.high - prev.close);
      const lpc = Math.abs(current.low - prev.close);
      trueRanges.push(Math.max(hl, hpc, lpc));
    }

    // Use Wilder's smoothing
    let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trueRanges.length; i++) {
      atr = (atr * (period - 1) + trueRanges[i]) / period;
    }

    return atr;
  }

  /**
   * Calculate MACD from FMP data structure
   * @param {Array} data - Array of {date, open, high, low, close, volume}
   * @returns {Object} MACD object with line, signal, histogram
   */
  calculateMACDFromData(data) {
    if (!data || data.length < 35) return null;

    const prices = data.map(d => d.close).reverse(); // FMP returns newest first
    return this.calculateMACD(prices);
  }

  /**
   * Integrated technical signal scorer for buy vs short decisions.
   *
   * Scoring logic (for swing/position trading on mid-to-large caps):
   *
   * BUY SIGNALS (positive score):
   *   +2  Price above rising 200MA (institutionally bullish)
   *   +1  Price above 50MA
   *   +1  MACD bullish (line above signal)
   *   +1  MACD bullish crossover just happened
   *   +1  RSI 40-65 (healthy momentum, not overbought)
   *   +1  Volume confirmed move (volumeRatio >= 1.2)
   *   +1  Price within 5% below 200MA but 200MA is rising (institutional support zone)
   *
   * SHORT SIGNALS (negative score):
   *   -2  Price below declining 200MA (institutionally bearish)
   *   -1  Price below 50MA
   *   -1  MACD bearish (line below signal)
   *   -1  MACD bearish crossover just happened
   *   -1  RSI 40-60 range confirms downtrend (not oversold, so no bounce imminent)
   *   -1  Volume confirmed breakdown (volumeRatio >= 1.2 on downside)
   *   -1  Price stretched >20% above 200MA (mean-reversion short candidate)
   *
   * PENALTY / CAUTION:
   *   RSI < 30 on a short candidate = CAUTION (oversold, bounce risk)
   *   RSI > 70 on a buy candidate = CAUTION (overbought, pullback risk)
   *
   * Final score:
   *   >= +3 = STRONG_BUY
   *   +1 to +2 = WEAK_BUY
   *   -1 to +0 = NEUTRAL
   *   -2 to -1 = WEAK_SHORT
   *   <= -3 = STRONG_SHORT
   */
  calculateTechnicalSignal({ currentPrice, sma50, sma200, sma50Slope, sma200Slope, distanceFrom200MA, rsi, macd, volumeRatio }) {
    let score = 0;
    const reasons = [];
    const cautions = [];

    // --- 200MA Analysis ---
    if (sma200 && sma200Slope !== null) {
      if (currentPrice > sma200 && sma200Slope > 0) {
        score += 2;
        reasons.push('Above rising 200MA (institutional uptrend)');
      } else if (currentPrice < sma200 && sma200Slope < 0) {
        score -= 2;
        reasons.push('Below declining 200MA (institutional downtrend)');
      } else if (currentPrice > sma200 && sma200Slope <= 0) {
        score += 1;
        reasons.push('Above 200MA but MA is flat/declining (cautious bullish)');
      } else if (currentPrice < sma200 && sma200Slope >= 0) {
        score -= 1;
        reasons.push('Below 200MA but MA is flat/rising (could be a dip, not confirmed short)');
      }
    }

    // Institutional support/retest zone: within 5% below a rising 200MA
    if (distanceFrom200MA !== null && sma200Slope !== null &&
        distanceFrom200MA >= -5 && distanceFrom200MA < 0 && sma200Slope > 0) {
      score += 1;
      reasons.push('Near rising 200MA from below - institutional buy zone (wait for confirmation bounce)');
    }

    // Mean-reversion short: price stretched >20% above 200MA
    if (distanceFrom200MA !== null && distanceFrom200MA > 20) {
      score -= 1;
      cautions.push(`Price ${distanceFrom200MA.toFixed(1)}% above 200MA - stretched, mean-reversion short risk`);
    }

    // --- 50MA Analysis ---
    if (sma50) {
      if (currentPrice > sma50) {
        score += 1;
        reasons.push('Above 50MA');
      } else {
        score -= 1;
        reasons.push('Below 50MA');
      }
    }

    // --- MACD Analysis ---
    if (macd) {
      if (macd.bullish) {
        score += 1;
        reasons.push('MACD bullish (line above signal)');
      } else {
        score -= 1;
        reasons.push('MACD bearish (line below signal)');
      }

      if (macd.crossover === 'bullish') {
        score += 1;
        reasons.push('MACD bullish crossover - fresh momentum shift');
      } else if (macd.crossover === 'bearish') {
        score -= 1;
        reasons.push('MACD bearish crossover - fresh momentum breakdown');
      }
    }

    // --- RSI Analysis ---
    if (rsi !== null) {
      if (rsi >= 40 && rsi <= 65) {
        score += 1;
        reasons.push(`RSI ${rsi.toFixed(1)} - healthy momentum range`);
      } else if (rsi > 70) {
        cautions.push(`RSI ${rsi.toFixed(1)} - overbought, avoid chasing longs`);
      } else if (rsi < 30) {
        cautions.push(`RSI ${rsi.toFixed(1)} - oversold, avoid fresh shorts (bounce risk)`);
      } else if (rsi < 40) {
        // 30-40: weak momentum, slightly bearish
        score -= 1;
        reasons.push(`RSI ${rsi.toFixed(1)} - weak/downtrend momentum`);
      }
    }

    // --- Volume Confirmation ---
    if (volumeRatio !== null) {
      if (volumeRatio >= 1.2) {
        // Volume confirms the current directional move
        if (score > 0) {
          score += 1;
          reasons.push(`Volume ${volumeRatio.toFixed(2)}x avg - confirms bullish move`);
        } else if (score < 0) {
          score -= 1;
          reasons.push(`Volume ${volumeRatio.toFixed(2)}x avg - confirms bearish breakdown`);
        }
      } else if (volumeRatio < 0.7) {
        cautions.push(`Volume ${volumeRatio.toFixed(2)}x avg - thin volume, move may not hold`);
      }
    }

    // --- Map score to signal label ---
    let signal, action;
    if (score >= 4) {
      signal = 'STRONG_BUY';
      action = 'Strong buy candidate - multiple factors aligned';
    } else if (score >= 2) {
      signal = 'WEAK_BUY';
      action = 'Lean bullish - wait for additional confirmation before entering';
    } else if (score <= -4) {
      signal = 'STRONG_SHORT';
      action = 'Strong short candidate - multiple factors aligned (verify ETB and no near-term earnings)';
    } else if (score <= -2) {
      signal = 'WEAK_SHORT';
      action = 'Lean bearish - wait for retest of 200MA from below before entering short';
    } else {
      signal = 'NEUTRAL';
      action = 'Mixed signals - no clear edge, avoid new positions';
    }

    return {
      score,
      signal,
      action,
      reasons,
      cautions
    };
  }

  /**
   * Calculate Simple Moving Average
   */
  calculateSMA(prices, period) {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  /**
   * Calculate RSI (Relative Strength Index)
   */
  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;

    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }

    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);

    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return rsi;
  }

  /**
   * Evaluate a stock for purchase
   */
  async evaluateStockForPurchase(symbol) {
    try {
      console.log(`📊 Evaluating ${symbol}...`);

      // Get quote
      const quote = await fmp.getQuote(symbol);
      if (!quote) {
        return { recommendation: 'SKIP', reason: 'No quote data available' };
      }

      // Get technical indicators
      const technicals = await this.getTechnicalIndicators(symbol);

      // Get news
      const news = await tavily.searchStockNews(symbol, 3);
      const formattedNews = tavily.formatResults(news);

      // Get fundamentals (if available)
      let fundamentals = null;
      try {
        fundamentals = await fmp.getFundamentals(symbol);
      } catch (err) {
        console.log(`No fundamentals available for ${symbol}`);
      }

      // Ask Claude to evaluate
      const analysis = await claude.evaluateStock(
        symbol,
        fundamentals,
        technicals,
        formattedNews
      );

      return {
        symbol,
        currentPrice: quote.price || quote.previousClose || quote.close || 0,
        analysis: analysis.analysis,
        technicals,
        news: formattedNews
      };
    } catch (error) {
      console.error(`Error evaluating ${symbol}:`, error.message);
      return { recommendation: 'ERROR', reason: error.message };
    }
  }

  /**
   * Evaluate whether to sell a position
   */
  async evaluateSellDecision(position, reason) {
    try {
      console.log(`🔍 Evaluating sell decision for ${position.symbol}...`);

      // Get current price
      const quote = await fmp.getQuote(position.symbol);
      const currentPrice = quote.price;

      // Get news
      const news = await tavily.searchStockNews(position.symbol, 3);
      const formattedNews = tavily.formatResults(news);

      // Ask Claude to evaluate
      const analysis = await claude.evaluateSell(
        position.symbol,
        position,
        currentPrice,
        formattedNews,
        reason
      );

      return {
        symbol: position.symbol,
        currentPrice,
        analysis: analysis.analysis,
        news: formattedNews
      };
    } catch (error) {
      console.error(`Error evaluating sell for ${position.symbol}:`, error.message);
      return { recommendation: 'ERROR', reason: error.message };
    }
  }

  /**
   * Get sector allocation
   */
  getSectorAllocation(portfolio) {
    const sectorValues = {};
    let totalPositionsValue = 0;

    for (const position of portfolio.positions) {
      const value = position.quantity * position.currentPrice;
      const sector = position.sector || 'Unknown';

      sectorValues[sector] = (sectorValues[sector] || 0) + value;
      totalPositionsValue += value;
    }

    const allocation = {};
    for (const [sector, value] of Object.entries(sectorValues)) {
      allocation[sector] = {
        value,
        percentage: (value / portfolio.totalValue) * 100
      };
    }

    return allocation;
  }

  /**
   * Find rebalancing opportunities
   */
  findRebalancingOpportunities(portfolio) {
    const opportunities = [];
    const sectorAllocation = this.getSectorAllocation(portfolio);

    // Check for overweight sectors
    for (const [sector, data] of Object.entries(sectorAllocation)) {
      if (data.percentage > 25) {
        opportunities.push({
          type: 'trim-sector',
          sector,
          current: data.percentage,
          target: 25,
          message: `${sector} is ${data.percentage.toFixed(1)}% (max 25%)`
        });
      }
    }

    // Check for underweight cash
    const cashPercentage = (portfolio.cash / portfolio.totalValue) * 100;
    if (cashPercentage < 3) {
      opportunities.push({
        type: 'increase-cash',
        current: cashPercentage,
        target: 5,
        message: `Cash reserve ${cashPercentage.toFixed(1)}% (min 3%, target 5%)`
      });
    }

    return opportunities;
  }
}

export default new AnalysisEngine();
