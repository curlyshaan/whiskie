import fmp from './fmp.js';
import tradier from './tradier.js';
import * as db from './db.js';
import email from './email.js';
import { getSectorConfig, normalizeSectorName } from './sector-config.js';

/**
 * Combined Fundamental Screener
 * Single pass over FMP-based universe - identifies BOTH long and short candidates
 *
 * LONG PATHWAYS (pass ANY one, threshold ≥35):
 *   1. Deep Value     - low P/E, low PEG, high FCF
 *   2. High Growth    - >30% revenue growth (ignore valuation)
 *   3. Inflection     - Q-over-Q acceleration, margin expansion
 *   4. Cash Machine   - FCF yield >8%, growing FCF
 *
 * SHORT CRITERIA (must hit ALL three):
 *   1. Extreme valuation (PEG >3 AND P/E >50, sector-adjusted)
 *   2. Deteriorating fundamentals (deceleration OR margin compression)
 *   3. Short safety check (meme stock filter - short float, market cap, liquidity)
 *
 * Runs: Saturday 3pm ET
 * Output: saturday_watchlist (longs + shorts)
 */

class FundamentalScreener {
  constructor() {
    this.MIN_DOLLAR_VOLUME = 5_000_000;    // $5M daily dollar volume minimum
    this.MIN_PRICE = 5;                     // No penny stocks
    this.MIN_AVG_VOLUME_SHARES_LONG = 250_000;   // 250K shares/day minimum for longs
    this.MIN_AVG_VOLUME_SHARES_SHORT = 500_000;  // 500K shares/day minimum for shorts

    // Pathway-specific market cap minimums (quality strategies need scale)
    this.MARKET_CAP_REQUIREMENTS = {
      deepValue: 2_000_000_000,    // $2B - quality value vs value traps
      cashMachine: 2_000_000_000,  // $2B - 8% FCF yield at $2B = opportunity, at $500M = distress
      qarp: 2_000_000_000,         // $2B - quality verification (prefer $10B+)
      highGrowth: 500_000_000,     // $500M - growth emerges small
      inflection: 500_000_000,     // $500M - catch early momentum
      turnaround: 500_000_000      // $500M - distress acceptable, upside compensates
    };

    this.MIN_SHORT_MARKET_CAP = 2_000_000_000; // $2B minimum for shorts
    this.MIN_SHORT_DOLLAR_VOLUME = 20_000_000; // $20M daily volume for shorts
    this.LONG_THRESHOLD = 40;               // Pass if ANY pathway ≥40 (raised from 35)
    this.SHORT_THRESHOLD = 55;              // Raised from 50 for higher conviction
    this.MAX_SHORT_FLOAT = 0.15;            // Max 15% short float (reduced from 20%)
    this.debugCounter = 0;                  // Track stocks for debug logging
  }

  /**
   * Main entry point - single pass over all stocks
   * Identifies both long and short candidates simultaneously
   */
  async runWeeklyScreen(part = 'full') {
    console.log(`\n💎 Running combined fundamental screening (${part})...`);
    const startTime = Date.now();

    // Reset debug counter for this screening run
    this.debugCounter = 0;

    try {
      // Use FMP company screener for pre-filtering (much faster than screening all 407 stocks)
      let allStocks = await this.getScreenerCandidates();

      if (part === 'saturday') {
        allStocks = allStocks.slice(0, Math.ceil(allStocks.length / 2));
        console.log(`   Screening first half: ${allStocks.length} stocks...`);
      } else if (part === 'sunday') {
        allStocks = allStocks.slice(Math.ceil(allStocks.length / 2));
        console.log(`   Screening second half: ${allStocks.length} stocks...`);
      } else {
        console.log(`   Screening ${allStocks.length} pre-filtered candidates...`);
      }

      const longCandidates = [];
      const shortCandidates = [];
      let processed = 0;
      let filtered = 0;
      let errors = 0;

      // Process stocks sequentially to avoid FMP rate limits (was 20, caused 120 parallel API calls)
      const BATCH_SIZE = 1;
      for (let i = 0; i < allStocks.length; i += BATCH_SIZE) {
        const batch = allStocks.slice(i, i + BATCH_SIZE);

        const results = await Promise.allSettled(
          batch.map(stock => this.screenStock(stock))
        );

        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          const stock = batch[j];

          if (result.status === 'fulfilled') {
            const screenResult = result.value;

            if (screenResult === null) {
              filtered++;
            } else {
              if (screenResult.longScore !== null) longCandidates.push(screenResult);
              if (screenResult.shortScore !== null) shortCandidates.push(screenResult);
            }

            processed++;

            // Debug logging for first 10 stocks
            if (processed <= 10 && screenResult !== null) {
              console.log(`   DEBUG ${stock.symbol}: Long=${screenResult.longScore || 'null'} (${screenResult.longPathway || 'none'}), Short=${screenResult.shortScore || 'null'}`);
            }
          } else {
            errors++;
            console.warn(`   ⚠️ Error screening ${stock.symbol}:`, result.reason?.message || result.reason);
            processed++;
          }
        }

        if (processed % 50 === 0) {
          console.log(`   Progress: ${processed}/${allStocks.length} | Longs: ${longCandidates.length} | Shorts: ${shortCandidates.length}`);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n   ✅ Screening complete (${duration}s)`);
      console.log(`   Processed: ${processed} | Filtered out: ${filtered} | Errors: ${errors}`);
      console.log(`   Long candidates: ${longCandidates.length}`);
      console.log(`   Short candidates: ${shortCandidates.length}`);

      // Alert if high error rate (>10%)
      const errorRate = errors / allStocks.length;
      if (errorRate > 0.10) {
        console.error(`   ⚠️ HIGH ERROR RATE: ${(errorRate * 100).toFixed(1)}% of stocks failed screening`);
        await email.sendEmail(
          email.alertEmail,
          'Whiskie Alert: High Error Rate in Fundamental Screening',
          `Fundamental screening completed with ${errors} errors out of ${allStocks.length} stocks (${(errorRate * 100).toFixed(1)}%).\n\nThis may indicate API issues or data quality problems.`
        );
      }

      // Sort by score
      const sortedLongs = longCandidates.sort((a, b) => b.longScore - a.longScore);
      const sortedShorts = shortCandidates.sort((a, b) => b.shortScore - a.shortScore);

      await this.logCacheStats(allStocks.length);

      if (part === 'sunday' || part === 'full') {
        await this.updateSaturdayWatchlist(sortedLongs, sortedShorts);
      }

      return { longs: sortedLongs, shorts: sortedShorts };

    } catch (error) {
      console.error('❌ Error in fundamental screening:', error);
      const emailModule = await import('./email.js');
      await emailModule.default.sendErrorAlert(error, 'Fundamental screening failed');
      throw error;
    }
  }

  /**
   * Screen a single stock for both long and short criteria
   */
  async screenStock(stock) {
    try {
      const quote = await tradier.getQuote(stock.symbol);
      if (!quote) return null;

      const price = quote.last || quote.close || 0;
      const volume = quote.average_volume || 0;
      const dollarVolume = volume * price;

      // Basic quality filters
      if (price < this.MIN_PRICE) return null;
      if (dollarVolume < this.MIN_DOLLAR_VOLUME) return null;

      const fundamentals = await fmp.getFundamentals(stock.symbol);
      // Skip if no fundamentals (likely an ETF or non-equity security)
      if (!fundamentals) return null;

      const avgVolume = fundamentals.avgVolume || 0;
      const marketCap = fundamentals.marketCap || 0;

      const sector = normalizeSectorName(fundamentals.sector);
      const sectorConfig = getSectorConfig(sector);
      const metrics = this.extractMetrics(fundamentals, price, dollarVolume);

      // Score long pathways (each pathway checks its own market cap requirement)
      const longResult = this.scoreLong(metrics, sector, sectorConfig, marketCap);
      const shortResult = this.scoreShort(metrics, sector, sectorConfig, quote);

      // Apply volume filters after scoring
      if (longResult && avgVolume < this.MIN_AVG_VOLUME_SHARES_LONG) {
        // Filter out low-volume longs
        longResult = null;
      }
      if (shortResult && avgVolume < this.MIN_AVG_VOLUME_SHARES_SHORT) {
        // Filter out low-volume shorts
        shortResult = null;
      }

      // Debug: log first 10 stocks regardless of pass/fail
      this.debugCounter++;
      if (this.debugCounter <= 10) {
        console.log(`   DEBUG ${stock.symbol}: Long=${longResult?.score || 0} (${longResult?.pathway || 'none'}), Short=${shortResult?.score || 0}`);
      }

      if (longResult === null && shortResult === null) return null;

      return {
        symbol: stock.symbol,
        sector: stock.sector,
        industry: stock.industry,
        price: price.toFixed(2),
        marketCap,
        dollarVolume,
        longScore: longResult?.score || null,
        longPathway: longResult?.pathway || null,
        longReasons: longResult?.reasons || [],
        shortScore: shortResult?.score || null,
        shortReasons: shortResult?.reasons || [],
        metrics
      };

    } catch (error) {
      return null;
    }
  }

  /**
   * Extract all fundamental metrics
   */
  extractMetrics(fundamentals, price, dollarVolume) {
    // Calculate accrual ratio for earnings quality check
    const netIncome = fundamentals.netIncome || 0;
    const operatingCashFlow = fundamentals.operatingCashFlow || 0;
    const totalAssets = fundamentals.totalAssets || 0;
    const accrualRatio = totalAssets > 0
      ? (netIncome - operatingCashFlow) / totalAssets
      : 0;

    return {
      peRatio: fundamentals.peRatio || 0,
      pegRatio: fundamentals.pegRatio || 0,
      priceToBook: fundamentals.priceToBook || 0,
      priceToSales: fundamentals.priceToSales || 0,
      evToEbitda: fundamentals.evToEbitda || 0,
      revenueGrowth: fundamentals.revenueGrowth || 0,
      earningsGrowth: fundamentals.earningsGrowth || 0,
      revenueGrowthQ: fundamentals.revenueGrowthQ || 0,
      revenueGrowthPrevQ: fundamentals.revenueGrowthPrevQ || 0,
      operatingMargin: fundamentals.operatingMargin || 0,
      operatingMarginPrev: fundamentals.operatingMarginPrev || 0,
      profitMargin: fundamentals.profitMargin || 0,
      roe: fundamentals.roe || 0,
      roic: fundamentals.roic || 0,
      freeCashflowPerShare: fundamentals.freeCashflowPerShare || 0,
      freeCashflow: fundamentals.freeCashflow || 0,
      fcfGrowth: fundamentals.fcfGrowth || 0,
      fcfYield: fundamentals.freeCashflow && fundamentals.marketCap
        ? (fundamentals.freeCashflow / fundamentals.marketCap) : 0,
      debtToEquity: fundamentals.debtToEquity || 0,
      shortFloat: fundamentals.shortFloat || null,
      accrualRatio,  // FIX #4: Earnings quality check
      price,
      dollarVolume,
      marketCap: fundamentals.marketCap || 0
    };
  }

  // ─────────────────────────────────────────────
  // LONG SCORING - 6 independent pathways
  // ─────────────────────────────────────────────

  scoreLong(metrics, sector, sectorConfig, marketCap) {
    const pathways = {
      deepValue:   this.scoreDeepValue(metrics, sectorConfig, marketCap),
      highGrowth:  this.scoreHighGrowth(metrics, sectorConfig, marketCap),
      inflection:  this.scoreInflection(metrics, sectorConfig, marketCap),
      cashMachine: this.scoreCashMachine(metrics, marketCap),
      qarp:        this.scoreQARP(metrics, marketCap),
      turnaround:  this.scoreTurnaround(metrics, marketCap),
    };

    const best = Object.entries(pathways)
      .sort((a, b) => b[1].score - a[1].score)[0];

    const [pathway, result] = best;

    // Debug: log ALL pathway scores for first stock
    this.debugCounter++;
    if (this.debugCounter === 1) {
      console.log(`\n   🔍 DETAILED SCORING DEBUG (First Stock):`);
      console.log(`   Metrics: PE=${metrics.peRatio}, PEG=${metrics.pegRatio}, ROE=${metrics.roe}, ROIC=${metrics.roic}`);
      console.log(`   Metrics: RevGrowth=${metrics.revenueGrowth}, FCF=${metrics.freeCashflow}, MarketCap=${metrics.marketCap}`);
      Object.entries(pathways).forEach(([name, result]) => {
        console.log(`   ${name}: score=${result.score}, reasons=${result.reasons.join('; ')}`);
      });
      console.log(`   Best: ${pathway} with score ${result.score} (threshold: ${this.LONG_THRESHOLD})\n`);
    }

    if (result.score < this.LONG_THRESHOLD) return null;

    return { score: result.score, pathway, reasons: result.reasons };
  }

  scoreDeepValue(metrics, sectorConfig, marketCap) {
    // Market cap requirement: $2B minimum (quality value vs value traps)
    if (marketCap < this.MARKET_CAP_REQUIREMENTS.deepValue) return { score: 0, reasons: [] };

    // Accrual ratio check - reject if earnings not backed by cash
    if (metrics.accrualRatio > 0.12) {
      return { score: 0, reasons: ['High accruals (>12%) - earnings not backed by cash'] };
    }

    let score = 0;
    const reasons = [];
    let qualityScore = 0;
    let valueSignals = 0;

    // VALUE SIGNALS (need at least 2 of 3)
    if (metrics.pegRatio > 0 && metrics.pegRatio <= (sectorConfig.pegRange?.ideal || 1.5)) {
      score += 30;
      valueSignals++;
      reasons.push(`PEG ${metrics.pegRatio.toFixed(2)} (excellent)`);
    } else if (metrics.pegRatio > 0 && metrics.pegRatio <= (sectorConfig.pegRange?.high || 2.5)) {
      score += 15;
      valueSignals++;
      reasons.push(`PEG ${metrics.pegRatio.toFixed(2)} (acceptable)`);
    }

    if (metrics.peRatio > 0 && metrics.peRatio < (sectorConfig.peRange?.low || 15)) {
      score += 25;
      valueSignals++;
      reasons.push(`P/E ${metrics.peRatio.toFixed(1)} (low for sector)`);
    } else if (metrics.peRatio > 0 && metrics.peRatio < (sectorConfig.peRange?.mid || 25)) {
      score += 12;
      valueSignals++;
    }

    if (metrics.freeCashflowPerShare > 0) {
      score += 20;
      valueSignals++;
      reasons.push('Positive FCF');
    }

    // Require at least 2 value signals
    if (valueSignals < 2) {
      return { score: 0, reasons: ['Deep value requires 2 of 3 value signals (PEG, P/E, FCF)'] };
    }

    // QUALITY METRICS
    if (metrics.debtToEquity <= (sectorConfig.debtToEquityMax || 1) * 0.5) {
      qualityScore += 15;
      score += 15;
      reasons.push(`Low debt (D/E: ${metrics.debtToEquity.toFixed(2)})`);
    } else if (metrics.debtToEquity <= (sectorConfig.debtToEquityMax || 1)) {
      qualityScore += 8;
      score += 8;
    }

    if (metrics.roic > 0.15) {
      qualityScore += 10;
      score += 10;
      reasons.push(`ROIC ${(metrics.roic * 100).toFixed(1)}%`);
    }

    // Require minimum quality threshold (avoid value traps)
    if (qualityScore < 15) {
      return { score: 0, reasons: ['Deep value requires quality floor: low debt OR good ROIC (≥15 pts)'] };
    }

    return { score, reasons };
  }

  scoreHighGrowth(metrics, sectorConfig, marketCap) {
    // Market cap requirement: $500M minimum (growth emerges small)
    if (marketCap < this.MARKET_CAP_REQUIREMENTS.highGrowth) return { score: 0, reasons: [] };

    // FIX #4: Accrual ratio check - reject if earnings not backed by cash
    if (metrics.accrualRatio > 0.12) {
      return { score: 0, reasons: ['High accruals (>12%) - earnings not backed by cash'] };
    }

    let score = 0;
    const reasons = [];

    // High growth - valuation ignored entirely
    if (metrics.revenueGrowth >= 0.50) {
      score += 40;
      reasons.push(`${(metrics.revenueGrowth * 100).toFixed(0)}% revenue growth (exceptional)`);
    } else if (metrics.revenueGrowth >= 0.30) {
      score += 30;
      reasons.push(`${(metrics.revenueGrowth * 100).toFixed(0)}% revenue growth (strong)`);
    } else if (metrics.revenueGrowth >= (sectorConfig.revenueGrowthMin || 0.1) * 1.5) {
      score += 15;
      reasons.push(`${(metrics.revenueGrowth * 100).toFixed(0)}% revenue growth`);
    }

    if (metrics.earningsGrowth >= 0.40) {
      score += 30;
      reasons.push(`${(metrics.earningsGrowth * 100).toFixed(0)}% earnings growth`);
    } else if (metrics.earningsGrowth >= 0.20) {
      score += 15;
    }

    if (metrics.operatingMargin > 0) {
      score += 10;
      reasons.push(`${(metrics.operatingMargin * 100).toFixed(1)}% op margin`);
    }

    // Bonus: Q-over-Q acceleration
    if (metrics.revenueGrowthQ > metrics.revenueGrowthPrevQ && metrics.revenueGrowthQ > 0.20) {
      score += 20;
      reasons.push('Growth accelerating Q-over-Q');
    }

    return { score, reasons };
  }

  scoreInflection(metrics, sectorConfig, marketCap) {
    // Market cap requirement: $500M minimum (catch early momentum)
    if (marketCap < this.MARKET_CAP_REQUIREMENTS.inflection) return { score: 0, reasons: [] };

    // FIX #4: Accrual ratio check - reject if earnings not backed by cash
    if (metrics.accrualRatio > 0.12) {
      return { score: 0, reasons: ['High accruals (>12%) - earnings not backed by cash'] };
    }

    // FIX #1: Multi-criteria requirement - need at least 2 of 4 criteria to score
    let criteriaCount = 0;
    let score = 0;
    const reasons = [];

    // Criterion 1: Revenue acceleration
    const acceleration = metrics.revenueGrowthQ - metrics.revenueGrowthPrevQ;
    let revenueScore = 0;
    if (acceleration > 0.10 && metrics.revenueGrowthQ > 0) {
      revenueScore = 35;
      reasons.push(`Revenue accelerating: ${(metrics.revenueGrowthPrevQ * 100).toFixed(0)}% → ${(metrics.revenueGrowthQ * 100).toFixed(0)}%`);
      criteriaCount++;
    } else if (acceleration > 0.05 && metrics.revenueGrowthQ > 0) {
      revenueScore = 20;
      reasons.push('Revenue growth picking up');
      criteriaCount++;
    }

    // Criterion 2: Margin expansion
    const marginExpansion = metrics.operatingMargin - metrics.operatingMarginPrev;
    let marginScore = 0;
    if (marginExpansion > 0.05) {
      marginScore = 30;
      reasons.push(`Margin expanding: +${(marginExpansion * 100).toFixed(1)}pp`);
      criteriaCount++;
    } else if (marginExpansion > 0.02) {
      marginScore = 15;
      reasons.push('Margins improving');
      criteriaCount++;
    }

    // Criterion 3: FCF growth
    let fcfScore = 0;
    if (metrics.freeCashflow > 0 && metrics.fcfGrowth > 0.50) {
      fcfScore = 20;
      reasons.push('FCF growing rapidly');
      criteriaCount++;
    }

    // Criterion 4: Reasonable valuation
    let valuationScore = 0;
    if (metrics.pegRatio > 0 && metrics.pegRatio < 3.0) {
      valuationScore = 15;
      reasons.push(`PEG ${metrics.pegRatio.toFixed(2)} (reasonable)`);
      criteriaCount++;
    }

    // Require at least 2 criteria to pass - prevents single-metric false positives
    if (criteriaCount < 2) {
      return { score: 0, reasons: ['Inflection requires 2+ criteria (revenue accel, margin expansion, FCF growth, or valuation)'] };
    }

    score = revenueScore + marginScore + fcfScore + valuationScore;
    return { score, reasons };
  }

  scoreCashMachine(metrics, marketCap) {
    // Market cap requirement: $2B minimum (8% FCF yield at $500M = distress signal)
    if (marketCap < this.MARKET_CAP_REQUIREMENTS.cashMachine) return { score: 0, reasons: [] };

    // FIX #3: FCF yield trap protection - declining revenue + high yield = melting ice cube
    if (metrics.revenueGrowth < -0.05 && metrics.fcfGrowth <= 0.10) {
      return { score: 0, reasons: ['Cash Machine requires FCF growth >10% when revenue declining >5%'] };
    }

    // FIX #4: Accrual ratio check - reject if earnings not backed by cash
    if (metrics.accrualRatio > 0.12) {
      return { score: 0, reasons: ['High accruals (>12%) - earnings not backed by cash'] };
    }

    let score = 0;
    const reasons = [];

    if (metrics.fcfYield >= 0.10) {
      score += 45;
      reasons.push(`FCF yield ${(metrics.fcfYield * 100).toFixed(1)}% (exceptional)`);
    } else if (metrics.fcfYield >= 0.08) {
      score += 35;
      reasons.push(`FCF yield ${(metrics.fcfYield * 100).toFixed(1)}%`);
    } else if (metrics.fcfYield >= 0.05) {
      score += 15;
    }

    if (metrics.fcfGrowth > 0.20 && metrics.fcfGrowth > metrics.revenueGrowth) {
      score += 25;
      reasons.push(`FCF growing ${(metrics.fcfGrowth * 100).toFixed(0)}% (faster than revenue)`);
    } else if (metrics.fcfGrowth > 0.10) {
      score += 12;
    }

    if (metrics.debtToEquity < 0.5) {
      score += 15;
      reasons.push('Low debt - FCF accrues to shareholders');
    }

    if (metrics.roic > 0.20) {
      score += 15;
      reasons.push(`ROIC ${(metrics.roic * 100).toFixed(1)}%`);
    }

    return { score, reasons };
  }

  scoreQARP(metrics, marketCap) {
    // Market cap requirement: $2B minimum (quality verification)
    if (marketCap < this.MARKET_CAP_REQUIREMENTS.qarp) return { score: 0, reasons: [] };

    // P/E ceiling - reject expensive stocks (QARP = Quality at REASONABLE Price)
    if (metrics.peRatio > 35) {
      return { score: 0, reasons: ['P/E >35 - too expensive for QARP'] };
    }

    // Accrual ratio check - reject if earnings not backed by cash
    if (metrics.accrualRatio > 0.12) {
      return { score: 0, reasons: ['High accruals (>12%) - earnings not backed by cash'] };
    }

    let score = 0;
    const reasons = [];

    // Track category scores for multi-category requirement
    const categoryScores = {
      quality: 0,
      valuation: 0,
      growth: 0,
      balance: 0
    };

    // Quality at Reasonable Price - high ROIC/ROE compounders at fair valuations
    if (metrics.roic > 0.20) {
      categoryScores.quality += 25;
      score += 25;
      reasons.push(`ROIC ${(metrics.roic * 100).toFixed(1)}% (exceptional quality)`);
    } else if (metrics.roic > 0.15) {
      categoryScores.quality += 15;
      score += 15;
      reasons.push(`ROIC ${(metrics.roic * 100).toFixed(1)}% (quality compounder)`);
    }

    if (metrics.roe > 0.20) {
      categoryScores.quality += 25;
      score += 25;
      reasons.push(`ROE ${(metrics.roe * 100).toFixed(1)}% (high returns)`);
    }

    // P/E 15-25 = reasonable, not cheap
    if (metrics.peRatio >= 15 && metrics.peRatio <= 25) {
      categoryScores.valuation += 20;
      score += 20;
      reasons.push(`P/E ${metrics.peRatio.toFixed(1)} (reasonable valuation)`);
    } else if (metrics.peRatio > 25 && metrics.peRatio <= 30) {
      categoryScores.valuation += 10;
      score += 10;
    }

    // Consistent earnings growth (proxy: positive earnings growth)
    if (metrics.earningsGrowth > 0.10) {
      categoryScores.growth += 20;
      score += 20;
      reasons.push(`${(metrics.earningsGrowth * 100).toFixed(0)}% earnings growth (consistent)`);
    } else if (metrics.earningsGrowth > 0) {
      categoryScores.growth += 10;
      score += 10;
    }

    // Bonus: low debt
    if (metrics.debtToEquity < 0.5) {
      categoryScores.balance += 10;
      score += 10;
      reasons.push('Low debt');
    }

    // Require scoring in at least 3 of 4 categories
    const categoriesWithPoints = Object.values(categoryScores).filter(s => s >= 10).length;
    if (categoriesWithPoints < 3) {
      return { score: 0, reasons: ['QARP requires scoring in 3 of 4 categories (quality, valuation, growth, balance)'] };
    }

    return { score, reasons };
  }

  scoreTurnaround(metrics, marketCap) {
    // Market cap requirement: $500M minimum (distress acceptable, upside compensates)
    if (marketCap < this.MARKET_CAP_REQUIREMENTS.turnaround) return { score: 0, reasons: [] };

    // Debt ceiling - tightened from 2.0 to 1.5
    if (metrics.debtToEquity > 1.5) {
      return { score: 0, reasons: ['Turnaround requires D/E ≤ 1.5 (balance sheet must survive recovery period)'] };
    }

    let score = 0;
    const reasons = [];
    let operationalScore = 0;
    let financialScore = 0;

    // OPERATIONAL IMPROVEMENT
    // Debt reduction
    if (metrics.debtToEquity > 0 && metrics.debtToEquity < 1.0) {
      operationalScore += 15;
      score += 15;
      reasons.push(`Debt/Equity ${metrics.debtToEquity.toFixed(2)} (manageable)`);
    }

    // Margin expansion
    const marginExpansion = metrics.operatingMargin - metrics.operatingMarginPrev;
    if (marginExpansion > 0.03) {
      operationalScore += 30;
      score += 30;
      reasons.push(`Margin expanding: +${(marginExpansion * 100).toFixed(1)}pp (turnaround signal)`);
    } else if (marginExpansion > 0.01) {
      operationalScore += 15;
      score += 15;
      reasons.push('Margins improving');
    }

    // FINANCIAL IMPROVEMENT
    // Revenue stabilization (after decline, now flat or growing)
    if (metrics.revenueGrowth >= 0 && metrics.revenueGrowth < 0.10) {
      financialScore += 20;
      score += 20;
      reasons.push('Revenue stabilizing (turnaround phase)');
    } else if (metrics.revenueGrowth >= 0.10) {
      financialScore += 25;
      score += 25;
      reasons.push(`Revenue growing ${(metrics.revenueGrowth * 100).toFixed(0)}% (turnaround accelerating)`);
    }

    // FCF turning positive
    if (metrics.freeCashflow > 0 && metrics.fcfGrowth > 0.20) {
      financialScore += 25;
      score += 25;
      reasons.push('FCF turning positive (turnaround confirmation)');
    }

    // Still cheap despite improvements
    if (metrics.peRatio > 0 && metrics.peRatio < 20) {
      score += 15;
      reasons.push(`P/E ${metrics.peRatio.toFixed(1)} (undervalued turnaround)`);
    }

    // Require BOTH operational AND financial improvement
    if (operationalScore < 20 || financialScore < 15) {
      return { score: 0, reasons: ['Turnaround requires both operational improvement (≥20 pts) AND financial improvement (≥15 pts)'] };
    }

    return { score, reasons };
  }

  // ─────────────────────────────────────────────
  // SHORT SCORING - must hit ALL three criteria
  // ─────────────────────────────────────────────

  scoreShort(metrics, sector, sectorConfig, quote) {
    const reasons = [];

    // FIX #4: Accrual ratio bonus for shorts - high accruals = earnings quality issues
    let accrualBonus = 0;
    if (metrics.accrualRatio > 0.15) {
      accrualBonus = 15;
      reasons.push(`High accruals (${(metrics.accrualRatio * 100).toFixed(1)}%) - earnings quality concerns`);
    }

    // CRITERIA 1: Extreme valuation
    const valuationScore = this.scoreShortValuation(metrics, sectorConfig, reasons);
    if (valuationScore < 20) return null;

    // CRITERIA 2: Deteriorating fundamentals
    const deteriorationScore = this.scoreDeterioration(metrics, reasons);
    if (deteriorationScore < 20) return null;

    // CRITERIA 3: Meme stock / squeeze safety check
    const safetyPassed = this.shortSafetyCheck(metrics, reasons);
    if (!safetyPassed) return null;

    const totalScore = valuationScore + deteriorationScore + accrualBonus;
    if (totalScore < this.SHORT_THRESHOLD) return null;

    return { score: totalScore, reasons };
  }

  scoreShortValuation(metrics, sectorConfig, reasons) {
    let score = 0;
    let valuationSignals = 0;
    const highPE = sectorConfig.peRange?.high || 40;

    if (metrics.peRatio > highPE * 1.5) {
      score += 20;
      valuationSignals++;
      reasons.push(`Extreme P/E: ${metrics.peRatio.toFixed(1)} (1.5x sector ceiling of ${highPE})`);
    } else if (metrics.peRatio > highPE) {
      score += 10;
      valuationSignals++;
    }

    if (metrics.pegRatio > 4.0) {
      score += 20;
      valuationSignals++;
      reasons.push(`PEG ${metrics.pegRatio.toFixed(2)} (severely overvalued)`);
    } else if (metrics.pegRatio > 3.0) {
      score += 10;
      valuationSignals++;
      reasons.push(`PEG ${metrics.pegRatio.toFixed(2)} (overvalued)`);
    }

    if (metrics.evToEbitda > 40) {
      score += 10;
      valuationSignals++;
      reasons.push(`EV/EBITDA ${metrics.evToEbitda.toFixed(1)} (stretched)`);
    }

    // Require at least 2 valuation extremes
    if (valuationSignals < 2) {
      return 0;
    }

    return score;
  }

  scoreDeterioration(metrics, reasons) {
    let score = 0;

    const deceleration = metrics.revenueGrowthPrevQ - metrics.revenueGrowthQ;
    if (deceleration > 0.10) {
      score += 25;
      reasons.push(`Revenue decelerating: ${(metrics.revenueGrowthPrevQ * 100).toFixed(0)}% → ${(metrics.revenueGrowthQ * 100).toFixed(0)}%`);
    } else if (deceleration > 0.05) {
      score += 12;
      reasons.push('Revenue growth slowing');
    }

    const marginCompression = metrics.operatingMarginPrev - metrics.operatingMargin;
    if (marginCompression > 0.05) {
      score += 25;
      reasons.push(`Margin compression: -${(marginCompression * 100).toFixed(1)}pp`);
    } else if (marginCompression > 0.02) {
      score += 12;
    }

    if (metrics.fcfGrowth < -0.20) {
      score += 20;
      reasons.push(`FCF declining ${(metrics.fcfGrowth * 100).toFixed(0)}%`);
    }

    if (metrics.earningsGrowth < 0 && metrics.peRatio > 30) {
      score += 20;
      reasons.push('Negative earnings growth with high P/E');
    }

    return score;
  }

  shortSafetyCheck(metrics, reasons) {
    // Must be large enough to short safely
    if (metrics.marketCap < this.MIN_SHORT_MARKET_CAP) {
      reasons.push(`⚠️ Market cap too small for short ($${(metrics.marketCap / 1e9).toFixed(1)}B < $2B)`);
      return false;
    }

    // Must have good liquidity
    if (metrics.dollarVolume < this.MIN_SHORT_DOLLAR_VOLUME) {
      reasons.push('⚠️ Insufficient liquidity for short');
      return false;
    }

    // Short float check - high short float = squeeze risk (meme stock indicator)
    if (metrics.shortFloat && metrics.shortFloat > this.MAX_SHORT_FLOAT) {
      reasons.push(`⚠️ Short float ${(metrics.shortFloat * 100).toFixed(0)}% - squeeze/meme risk`);
      return false;
    }

    // Note: IV check happens at execution time in short-manager.js (80% IV cap)
    // ETB (easy to borrow) check also happens at execution

    return true;
  }

  /**
   * Get volume trend for a stock (institutional accumulation/distribution signal)
   * Uses Yahoo Finance historical data to compare recent vs older volume
   */
  async getVolumeTrend(symbol) {
    try {
      // Get 30 days of historical data
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      // Format dates for Tradier API (YYYY-MM-DD)
      const formatDate = (date) => date.toISOString().split('T')[0];

      const historicalData = await tradier.getHistory(
        symbol,
        'daily',
        formatDate(startDate),
        formatDate(endDate)
      );

      if (!historicalData || historicalData.length < 15) {
        return { trend: 'unknown', change: 0 };
      }

      // Recent 5 days average
      const recent5 = historicalData.slice(0, 5);
      const recentAvg = recent5.reduce((sum, d) => sum + (d.volume || 0), 0) / 5;

      // Older 5 days average (15 days back)
      const older5 = historicalData.slice(15, 20);
      const olderAvg = older5.reduce((sum, d) => sum + (d.volume || 0), 0) / 5;

      if (olderAvg === 0) {
        return { trend: 'unknown', change: 0 };
      }

      const change = ((recentAvg - olderAvg) / olderAvg) * 100;
      const trend = change > 20 ? 'rising' : change < -20 ? 'declining' : 'stable';

      return { trend, change };
    } catch (error) {
      return { trend: 'unknown', change: 0 };
    }
  }

  /**
   * Get all stocks from universe - screen them directly instead of using FMP screener
   * More accurate and avoids getting 1000+ irrelevant stocks from FMP's entire database
   */
  async getScreenerCandidates() {
    console.log('\n📊 Loading stocks from FMP-based universe...');

    // Query stock_universe table (populated from FMP)
    const result = await db.query(
      'SELECT symbol, sector, industry FROM stock_universe WHERE status = $1 ORDER BY market_cap DESC',
      ['active']
    );

    const stocks = result.rows.map(row => ({
      symbol: row.symbol,
      sector: row.sector,
      industry: row.industry
    }));

    console.log(`   ✅ Loaded ${stocks.length} stocks from universe`);
    return stocks;
  }

  /**
   * Update saturday_watchlist with both long and short candidates
   * Replaces old quality_watchlist and overvalued_watchlist
   */
  async updateSaturdayWatchlist(longCandidates, shortCandidates) {
    try {
      // Expire old entries
      await db.query(`UPDATE saturday_watchlist SET status = 'expired' WHERE status = 'active'`);

      // Insert long candidates
      for (const c of longCandidates) {
        await db.query(
          `INSERT INTO saturday_watchlist
           (symbol, intent, pathway, sector, industry, score, metrics, reasons, price, status, added_date)
           VALUES ($1, 'LONG', $2, $3, $4, $5, $6, $7, $8, 'active', NOW())
           ON CONFLICT (symbol, pathway) DO UPDATE SET
             intent = 'LONG', score = $5, metrics = $6, reasons = $7,
             price = $8, status = 'active', added_date = NOW()`,
          [
            c.symbol, c.longPathway, c.sector, c.industry, c.longScore,
            JSON.stringify(c.metrics), c.longReasons.join(', '), parseFloat(c.price)
          ]
        );
      }

      // Insert short candidates
      for (const c of shortCandidates) {
        await db.query(
          `INSERT INTO saturday_watchlist
           (symbol, intent, pathway, sector, industry, score, metrics, reasons, price, status, added_date)
           VALUES ($1, 'SHORT', $2, $3, $4, $5, $6, $7, $8, 'active', NOW())
           ON CONFLICT (symbol, pathway) DO UPDATE SET
             intent = 'SHORT', score = $5, metrics = $6, reasons = $7,
             price = $8, status = 'active', added_date = NOW()`,
          [
            c.symbol, c.shortPathway || 'overvalued', c.sector, c.industry, c.shortScore,
            JSON.stringify(c.metrics), c.shortReasons.join(', '), parseFloat(c.price)
          ]
        );
      }

      console.log(`   ✅ Saturday watchlist updated: ${longCandidates.length} longs, ${shortCandidates.length} shorts`);
    } catch (error) {
      console.error('Error updating saturday watchlist:', error);
      throw error;
    }
  }

  /**
   * Log FMP API usage statistics
   */
  async logCacheStats(stockCount) {
    try {
      const fmpStats = (await import('./fmp.js')).default.getUsageStats();
      console.log(`\n   📊 FMP API Usage: ${fmpStats.calls} calls`);
    } catch (error) {
      // Non-critical
    }
  }

  /**
   * Check value momentum during daily analysis
   */
  async checkValueMomentum(marketData) {
    try {
      const result = await db.query(
        `SELECT * FROM saturday_watchlist WHERE status = 'active' ORDER BY score DESC`
      );
      const momentumTriggers = [];

      for (const stock of result.rows) {
        const quote = marketData[stock.symbol];
        if (!quote) continue;

        const changePercent = quote.change_percentage || 0;
        const volumeSurge = (quote.average_volume || 0) > 0
          ? (quote.volume || 0) / (quote.average_volume || 1) : 0;

        if (Math.abs(changePercent) >= 5 && volumeSurge >= 1.5) {
          momentumTriggers.push({
            symbol: stock.symbol,
            score: stock.score,
            pathway: stock.pathway,
            changePercent: changePercent.toFixed(1) + '%',
            volumeSurge: volumeSurge.toFixed(1) + 'x',
            trigger: 'VALUE_MOMENTUM_CONFIRMATION'
          });
          console.log(`   🎯 ${stock.symbol} momentum: ${changePercent.toFixed(1)}% + ${volumeSurge.toFixed(1)}x (${stock.pathway})`);
        }
      }

      return momentumTriggers;
    } catch (error) {
      console.error('Error checking value momentum:', error);
      return [];
    }
  }
}

export default new FundamentalScreener();
