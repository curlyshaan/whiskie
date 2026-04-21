import tradier from './tradier.js';
import fmp from './fmp.js';
import tavily from './tavily.js';
import claude, { MODELS } from './claude.js';
import * as db from './db.js';
import earningsGuard from './earnings-guard.js';

const HORIZON_CONFIG = {
  short_term: {
    label: 'Short term',
    minDays: 14,
    maxDays: 42,
    thesisWindow: '2-6 weeks'
  },
  medium_term: {
    label: 'Medium term',
    minDays: 60,
    maxDays: 120,
    thesisWindow: '2-4 months'
  },
  long_term: {
    label: 'Long term',
    minDays: 180,
    maxDays: 540,
    thesisWindow: '6-18 months'
  }
};

const STRIKE_TOLERANCE = {
  bullish: { min: -0.2, max: 0.25 },
  bearish: { min: -0.25, max: 0.2 },
  neutral: { min: -0.2, max: 0.2 }
};

const STRATEGY_LIBRARY = {
  bullish_directional: {
    recommendationType: 'use_options',
    strategyType: 'long_call',
    optionType: 'call',
    deltaRange: [0.35, 0.7],
    strikeRange: [0.92, 1.1],
    rationale: 'Directional upside exposure with defined premium at risk.'
  },
  bullish_defined_risk: {
    recommendationType: 'use_options',
    strategyType: 'bull_call_spread',
    optionType: 'call',
    deltaRange: [0.25, 0.55],
    strikeRange: [0.95, 1.08],
    rationale: 'Defined-risk bullish structure when IV or premium cost is elevated.'
  },
  bearish_directional: {
    recommendationType: 'use_options',
    strategyType: 'long_put',
    optionType: 'put',
    deltaRange: [-0.7, -0.35],
    strikeRange: [0.9, 1.08],
    rationale: 'Directional downside exposure with defined premium at risk.'
  },
  bearish_defined_risk: {
    recommendationType: 'use_options',
    strategyType: 'bear_put_spread',
    optionType: 'put',
    deltaRange: [-0.55, -0.25],
    strikeRange: [0.92, 1.05],
    rationale: 'Defined-risk bearish structure when outright puts are expensive.'
  },
  income_covered_call: {
    recommendationType: 'use_options',
    strategyType: 'covered_call',
    optionType: 'call',
    deltaRange: [0.15, 0.35],
    strikeRange: [1.02, 1.15],
    rationale: 'Income overlay only if shares are already owned.'
  },
  income_cash_secured_put: {
    recommendationType: 'use_options',
    strategyType: 'cash_secured_put',
    optionType: 'put',
    deltaRange: [-0.35, -0.15],
    strikeRange: [0.85, 0.98],
    rationale: 'Premium collection when willing to accumulate stock lower.'
  },
  hedge_protective_put: {
    recommendationType: 'use_options',
    strategyType: 'protective_put',
    optionType: 'put',
    deltaRange: [-0.45, -0.2],
    strikeRange: [0.88, 1.0],
    rationale: 'Portfolio hedge if shares are held and near-term downside risk is elevated.'
  }
};

class OptionsAnalyzer {
  applyThesisRiskOverrides(thesis) {
    const updatedThesis = {
      ...thesis,
      risks: Array.isArray(thesis?.risks) ? [...thesis.risks] : []
    };

    if (updatedThesis.conviction === 'low' && updatedThesis.equity_preference === 'use_options') {
      updatedThesis.equity_preference = 'no_trade';
      updatedThesis.risks.unshift('Low conviction — options premium at risk with no strong directional edge.');
      updatedThesis.why_options_or_not = updatedThesis.why_options_or_not || 'Low-conviction options setups default to no-trade.';
    }

    return updatedThesis;
  }

  normalizeChain(chain) {
    const options = Array.isArray(chain) ? chain : chain ? [chain] : [];
    return options.map(option => {
      const greeks = option.greeks || {};
      const bid = Number(option.bid) || 0;
      const ask = Number(option.ask) || 0;
      const strike = Number(option.strike) || 0;
      return {
        symbol: option.symbol,
        expiration: option.expiration_date || option.expiration,
        optionType: option.option_type,
        strike,
        bid,
        ask,
        mark: bid > 0 && ask > 0 ? (bid + ask) / 2 : Number(option.last) || bid || ask || 0,
        volume: Number(option.volume) || 0,
        openInterest: Number(option.open_interest) || 0,
        delta: Number(greeks.delta) || 0,
        gamma: Number(greeks.gamma) || 0,
        theta: Number(greeks.theta) || 0,
        vega: Number(greeks.vega) || 0,
        iv: Number(greeks.mid_iv || greeks.smv_vol || greeks.ask_iv || greeks.bid_iv) || 0,
        raw: option
      };
    });
  }

  getStockContextSummary(profile, watchlistEntry, approval, positions) {
    const hasLongPosition = positions.some(position => position.symbol === approval?.symbol && position.position_type !== 'short');
    return {
      profileSummary: profile ? {
        businessModel: profile.business_model?.slice(0, 400) || '',
        risks: profile.risks?.slice(0, 400) || '',
        catalysts: profile.catalysts?.slice(0, 400) || '',
        profileVersion: profile.profile_version || null
      } : null,
      watchlist: watchlistEntry ? {
        status: watchlistEntry.status,
        pathway: watchlistEntry.primary_pathway || watchlistEntry.pathway || null,
        score: watchlistEntry.score || null,
        intent: watchlistEntry.intent || null
      } : null,
      latestApproval: approval ? {
        action: approval.action,
        strategyType: approval.strategy_type,
        confidence: approval.confidence,
        thesisState: approval.thesis_state
      } : null,
      hasLongPosition
    };
  }

  async buildThesis(symbol, intentHorizon, profile, fundamentals, quote, news, watchlistEntry, approval, positions) {
    const horizon = HORIZON_CONFIG[intentHorizon];
    const contextSummary = this.getStockContextSummary(profile, watchlistEntry, approval, positions);
    const prompt = `You are evaluating ${symbol} for a ${horizon.label.toLowerCase()} options/equity decision.\n\nHorizon windows:\n- Near term: 2-6 weeks\n- Mid term: 2-4 months\n- Long term: 6-18 months\n\nUser-selected horizon: ${horizon.label} (${horizon.thesisWindow}).\n\nReturn ONLY valid JSON with this exact shape:\n{\n  "direction_call": "bullish|bearish|neutral|volatile",\n  "conviction": "low|medium|high",\n  "equity_preference": "buy_shares|short_shares|use_options|no_trade",\n  "thesis_summary": "string",\n  "near_term_catalysts": ["..."],\n  "mid_term_catalysts": ["..."],\n  "long_term_catalysts": ["..."],\n  "risks": ["..."],\n  "guardrails": ["..."],\n  "why_options_or_not": "string"\n}\n\nUse stock profile, fundamentals, recent context, and trading practicality. If options are a bad fit because of horizon, expected move, or likely premium inefficiency, say so in equity_preference and why_options_or_not.\n\nStock profile summary:\n${JSON.stringify(contextSummary.profileSummary || {}, null, 2)}\n\nWatchlist / prior approval context:\n${JSON.stringify({ watchlist: contextSummary.watchlist, latestApproval: contextSummary.latestApproval, positions: positions.filter(p => p.symbol === symbol) }, null, 2)}\n\nFundamentals:\n${JSON.stringify(fundamentals || {}, null, 2)}\n\nQuote:\n${JSON.stringify(quote || {}, null, 2)}\n\nRecent context:\n${JSON.stringify(news.slice(0, 5).map(item => ({ title: item.title, content: item.content?.slice(0, 280) || '' })), null, 2)}`;

    const response = await claude.sendMessage(
      [{ role: 'user', content: prompt }],
      MODELS.OPUS,
      null,
      true,
      35000,
      { quiet: true, maxTokens: 3000 }
    );

    const responseText = response?.content?.map(block => block?.text || '').join('\n').trim() || '{}';
    const cleaned = responseText.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  }

  getExpirationWindow(expirations, minDays, maxDays) {
    const today = new Date();
    return expirations.filter(expiration => {
      const expirationDate = new Date(expiration);
      const diffDays = Math.round((expirationDate - today) / (1000 * 60 * 60 * 24));
      return diffDays >= minDays && diffDays <= maxDays;
    });
  }

  scoreContract(option, currentPrice, strategy) {
    const spreadPct = option.ask > 0 ? (option.ask - option.bid) / option.ask : 1;
    const distance = currentPrice > 0 ? Math.abs(option.strike - currentPrice) / currentPrice : 1;
    const liquidityScore = Math.min(option.openInterest / 500, 10) + Math.min(option.volume / 100, 5);
    const spreadScore = Math.max(0, (0.18 - spreadPct) * 40);
    const deltaAbs = Math.abs(option.delta);
    const deltaMid = (Math.abs(strategy.deltaRange[0]) + Math.abs(strategy.deltaRange[1])) / 2;
    const deltaScore = Math.max(0, 10 - Math.abs(deltaAbs - deltaMid) * 20);
    const distanceScore = Math.max(0, 8 - distance * 20);
    return Number((liquidityScore + spreadScore + deltaScore + distanceScore).toFixed(2));
  }

  filterContracts(chain, currentPrice, strategy, hasLongPosition) {
    const [minDelta, maxDelta] = strategy.deltaRange;
    const [minStrike, maxStrike] = strategy.strikeRange;

    return chain
      .filter(option => option.optionType === strategy.optionType)
      .filter(option => option.strike >= currentPrice * minStrike && option.strike <= currentPrice * maxStrike)
      .filter(option => option.openInterest >= 50 || option.volume >= 10)
      .filter(option => option.bid > 0 && option.ask > 0)
      .filter(option => ((option.ask - option.bid) / option.ask) <= 0.18)
      .filter(option => option.delta >= minDelta && option.delta <= maxDelta)
      .filter(option => {
        if (strategy.strategyType === 'covered_call' || strategy.strategyType === 'protective_put') {
          return hasLongPosition;
        }
        return true;
      })
      .map(option => ({
        ...option,
        score: this.scoreContract(option, currentPrice, strategy)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }

  getStrikeToleranceWindow(currentPrice, strategy) {
    const isCall = strategy.optionType === 'call';
    const isPut = strategy.optionType === 'put';
    const tolerance = isCall
      ? STRIKE_TOLERANCE.bullish
      : isPut
        ? STRIKE_TOLERANCE.bearish
        : STRIKE_TOLERANCE.neutral;

    return {
      minStrike: Number((currentPrice * (1 + tolerance.min)).toFixed(2)),
      maxStrike: Number((currentPrice * (1 + tolerance.max)).toFixed(2)),
      toleranceLabel: `${Math.abs(tolerance.min * 100)}% to ${Math.abs(tolerance.max * 100)}% ${isCall ? 'around/above' : isPut ? 'around/below' : 'around'} spot`
    };
  }

  summarizeSentiment(chain, currentPrice) {
    const calls = chain.filter(option => option.optionType === 'call');
    const puts = chain.filter(option => option.optionType === 'put');
    const callVolume = calls.reduce((sum, option) => sum + option.volume, 0);
    const putVolume = puts.reduce((sum, option) => sum + option.volume, 0);
    const callOI = calls.reduce((sum, option) => sum + option.openInterest, 0);
    const putOI = puts.reduce((sum, option) => sum + option.openInterest, 0);
    const putCallVolumeRatio = callVolume > 0 ? putVolume / callVolume : null;
    const putCallOIRatio = callOI > 0 ? putOI / callOI : null;

    const nearestCall = calls.reduce((best, option) => (
      !best || Math.abs(option.strike - currentPrice) < Math.abs(best.strike - currentPrice) ? option : best
    ), null);
    const nearestPut = puts.reduce((best, option) => (
      !best || Math.abs(option.strike - currentPrice) < Math.abs(best.strike - currentPrice) ? option : best
    ), null);

    const atmIV = nearestCall && nearestPut
      ? ((nearestCall.iv || 0) + (nearestPut.iv || 0)) / 2
      : nearestCall?.iv || nearestPut?.iv || 0;

    return {
      putCallVolumeRatio: putCallVolumeRatio ? Number(putCallVolumeRatio.toFixed(2)) : null,
      putCallOIRatio: putCallOIRatio ? Number(putCallOIRatio.toFixed(2)) : null,
      atmImpliedVolatility: Number((atmIV * 100).toFixed(2)),
      unusualCalls: calls.filter(option => option.volume > option.openInterest * 2 && option.volume > 20).length,
      unusualPuts: puts.filter(option => option.volume > option.openInterest * 2 && option.volume > 20).length
    };
  }

  getStrategyCandidates(thesis, hasLongPosition, intentHorizon) {
    const candidates = [];
    if (thesis.direction_call === 'bullish') {
      candidates.push('bullish_directional');
      candidates.push('bullish_defined_risk');
      if (intentHorizon !== 'short_term') candidates.push('income_cash_secured_put');
      if (hasLongPosition) candidates.push('income_covered_call');
    } else if (thesis.direction_call === 'bearish') {
      candidates.push('bearish_directional');
      candidates.push('bearish_defined_risk');
      if (hasLongPosition) candidates.push('hedge_protective_put');
    } else if (thesis.direction_call === 'volatile') {
      if (hasLongPosition) candidates.push('hedge_protective_put');
      candidates.push('bullish_defined_risk', 'bearish_defined_risk');
    } else if (hasLongPosition) {
      candidates.push('income_covered_call');
    }

    return [...new Set(candidates)];
  }

  selectBestRecommendation(thesis, strategyResults, sentimentSummary, context = {}) {
    if (context.earningsOverlap && thesis.equity_preference === 'use_options') {
      return {
        recommendationType: 'no_trade',
        strategyType: null,
        reason: `EARNINGS OVERLAP DETECTED: ${context.earningsOverlap.reason}`
      };
    }

    if (!strategyResults.length) {
      return {
        recommendationType: thesis.equity_preference === 'short_shares' ? 'short_shares'
          : thesis.equity_preference === 'buy_shares' ? 'buy_shares'
            : 'no_trade',
        strategyType: null,
        reason: thesis.why_options_or_not || 'No liquid options contracts met the guardrails.'
      };
    }

    if (thesis.equity_preference === 'buy_shares' || thesis.equity_preference === 'short_shares') {
      return {
        recommendationType: thesis.equity_preference,
        strategyType: null,
        reason: thesis.why_options_or_not || 'Equity exposure is cleaner than options for this setup.'
      };
    }

    if (thesis.equity_preference === 'no_trade') {
      return {
        recommendationType: 'no_trade',
        strategyType: null,
        reason: thesis.why_options_or_not || 'Setup quality is not strong enough.'
      };
    }

    if (thesis.direction_call === 'volatile') {
      const protective = strategyResults.find(result => result.strategy.strategyType === 'protective_put');
      if (protective) {
        return {
          recommendationType: 'use_options',
          strategyType: protective.strategy.strategyType,
          reason: 'Volatile thesis with an existing long position defaults to protective downside hedging.',
          sentimentSummary
        };
      }

      return {
        recommendationType: 'no_trade',
        strategyType: null,
        reason: 'Volatile thesis does not auto-select a bullish or bearish spread without directional conviction.'
      };
    }

    const [best] = strategyResults.sort((a, b) => b.bestScore - a.bestScore);
    const recommendationType = best.candidates.length ? 'use_options' : 'no_trade';
    return {
      recommendationType,
      strategyType: recommendationType === 'use_options' ? best.strategy.strategyType : null,
      reason: best.strategy.rationale,
      sentimentSummary
    };
  }

  async analyzeSymbol({ symbol, intentHorizon, capital = null, eventMode = null }) {
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    if (!normalizedSymbol) throw new Error('Symbol is required');
    if (!HORIZON_CONFIG[intentHorizon]) throw new Error('Invalid intent horizon');
    const normalizedEventMode = String(eventMode || '').trim().toLowerCase();

    const [quote, fundamentals, profile, watchlistEntry, approval, positions, news, expirations] = await Promise.all([
      fmp.getQuote(normalizedSymbol),
      fmp.getFundamentals(normalizedSymbol),
      db.getLatestStockProfile(normalizedSymbol),
      db.getLatestSaturdayWatchlistEntry(normalizedSymbol),
      db.getLatestPendingApprovalForSymbol(normalizedSymbol),
      db.getPositions(),
      tavily.searchStructuredStockContext(normalizedSymbol, { maxResults: 5, depth: 'advanced', topic: 'news', timeRange: 'month' }).catch(() => []),
      tradier.getOptionsExpirations(normalizedSymbol)
    ]);

    const currentPrice = Number(quote?.price || fundamentals?.price || 0);
    if (!currentPrice) throw new Error(`No current price available for ${normalizedSymbol}`);

    const rawThesis = await this.buildThesis(normalizedSymbol, intentHorizon, profile, fundamentals, quote, news, watchlistEntry, approval, positions);
    const thesis = this.applyThesisRiskOverrides(rawThesis);
    const expirationWindow = this.getExpirationWindow(expirations, HORIZON_CONFIG[intentHorizon].minDays, HORIZON_CONFIG[intentHorizon].maxDays).slice(0, 6);
    if (!expirationWindow.length) {
      throw new Error(`No option expirations found in the ${HORIZON_CONFIG[intentHorizon].thesisWindow} window`);
    }

    const chainResults = await Promise.all(expirationWindow.map(async expiration => {
      const chain = await tradier.getOptionsChain(normalizedSymbol, expiration);
      return this.normalizeChain(chain);
    }));

    const normalizedChain = chainResults.flat();
    const sentimentSummary = this.summarizeSentiment(normalizedChain, currentPrice);
    const heldPosition = positions.find(position => position.symbol === normalizedSymbol && position.position_type !== 'short');
    const earningsBlackout = await earningsGuard.isEarningsBlackout(normalizedSymbol);
    const nextEarnings = await db.getNextEarning(normalizedSymbol).catch(() => null);
    const earningsOverlap = nextEarnings && intentHorizon === 'short_term' && expirationWindow.some(expiration => {
      const earningsDate = new Date(nextEarnings.earnings_date);
      const expirationDate = new Date(expiration);
      return !Number.isNaN(earningsDate.getTime()) && !Number.isNaN(expirationDate.getTime()) && earningsDate <= expirationDate;
    }) ? {
      earningsDate: nextEarnings.earnings_date,
      timing: nextEarnings.earnings_time || 'unknown',
      reason: `${normalizedSymbol} has earnings on ${nextEarnings.earnings_date} (${nextEarnings.earnings_time || 'unknown'}) within the short-term expiration window.`
    } : null;

    let strategyKeys = this.getStrategyCandidates(thesis, Boolean(heldPosition), intentHorizon);
    if (sentimentSummary.atmImpliedVolatility >= 60) {
      strategyKeys = strategyKeys.filter(key => !['bullish_directional', 'bearish_directional'].includes(key));
    }

    const strategyResults = strategyKeys.map(key => {
      const strategy = STRATEGY_LIBRARY[key];
      const strikeTolerance = this.getStrikeToleranceWindow(currentPrice, strategy);
      const candidates = this.filterContracts(normalizedChain, currentPrice, strategy, Boolean(heldPosition));
      return {
        strategy,
        strikeTolerance,
        candidates,
        bestScore: candidates[0]?.score || 0
      };
    }).filter(result => result.candidates.length > 0);

    const recommendation = this.selectBestRecommendation(thesis, strategyResults, sentimentSummary, {
      earningsOverlap: normalizedEventMode === 'earnings' ? null : earningsOverlap
    });

    const warnings = [
      ...(thesis.risks || []).slice(0, 4),
      earningsOverlap ? `EARNINGS OVERLAP DETECTED: ${earningsOverlap.reason}` : null,
      earningsBlackout?.blocked ? earningsBlackout.reason : null,
      !strategyResults.length ? 'No liquid options passed spread/OI/volume guardrails.' : null,
      sentimentSummary.atmImpliedVolatility >= 60 ? 'High IV environment — outright premium buys excluded, preferring defined-risk spreads.' : null,
      capital && capital < 100 ? 'Capital input is below preferred minimum for practical options sizing.' : null
    ].filter(Boolean);

    const result = {
      symbol: normalizedSymbol,
      intentHorizon,
      horizonLabel: HORIZON_CONFIG[intentHorizon].label,
      symbolContext: {
        price: currentPrice,
        sector: fundamentals?.sector || profile?.industry_sector || null,
        industry: fundamentals?.industry || profile?.industry_sector || null,
        marketCap: fundamentals?.marketCap || null,
        watchlistStatus: watchlistEntry?.status || null,
        hasLongPosition: Boolean(heldPosition),
        profileVersion: profile?.profile_version || null
      },
      directionCall: thesis.direction_call,
      conviction: thesis.conviction,
      thesisSummary: thesis.thesis_summary,
      catalysts: {
        nearTerm: thesis.near_term_catalysts || [],
        midTerm: thesis.mid_term_catalysts || [],
        longTerm: thesis.long_term_catalysts || []
      },
      risks: thesis.risks || [],
      recommendation: {
        type: recommendation.recommendationType,
        strategyType: recommendation.strategyType,
        reason: recommendation.reason
      },
      mode: normalizedEventMode === 'earnings' ? 'earnings' : 'standard',
      optionsSentiment: sentimentSummary,
      expirationWindow,
      candidateStrategies: strategyResults.map(result => ({
        strategyType: result.strategy.strategyType,
        rationale: result.strategy.rationale,
        strikeTolerance: result.strikeTolerance,
        candidates: result.candidates
      })),
      warnings,
      guardrails: thesis.guardrails || [
        'Reject contracts with wide bid/ask spreads.',
        'Reject low volume and low open-interest contracts.',
        'Prefer no-trade or equity if options pricing is unattractive.',
        'Keep selected strikes within roughly 20-25% of spot based on bullish/bearish structure.'
      ],
      profileSnapshot: profile ? {
        businessModel: profile.business_model?.slice(0, 350) || '',
        risks: profile.risks?.slice(0, 350) || '',
        catalysts: profile.catalysts?.slice(0, 350) || ''
      } : null,
      sourceContext: {
        latestApprovalIntent: approval?.intent || null,
        latestApprovalStrategyType: approval?.strategy_type || null,
        watchlistPathway: watchlistEntry?.primary_pathway || watchlistEntry?.pathway || null,
        nextEarningsDate: nextEarnings?.earnings_date || null,
        nextEarningsTiming: nextEarnings?.earnings_time || null,
        earningsOverlap: earningsOverlap || null,
        eventMode: normalizedEventMode || null
      }
    };

    if (normalizedEventMode === 'earnings') {
      result.warnings.unshift('Earnings event mode enabled — this output is event-driven and higher risk than standard options analysis.');
    }

    await db.saveOptionsAnalysisRun({
      symbol: normalizedSymbol,
      intent_horizon: intentHorizon,
      underlying_price: currentPrice,
      recommendation_type: result.recommendation.type,
      strategy_type: result.recommendation.strategyType,
      direction_call: result.directionCall,
      conviction: result.conviction,
      thesis_summary: result.thesisSummary,
      catalysts: result.catalysts,
      risks: result.risks,
      warnings: result.warnings,
      guardrails: result.guardrails,
      profile_version: profile?.profile_version || null,
      result_payload: result
    });

    return result;
  }
}

export default new OptionsAnalyzer();
