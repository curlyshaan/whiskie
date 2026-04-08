import tradier from './tradier.js';

/**
 * Options Data Analyzer
 * Extracts sentiment and volatility signals from options chains
 */
class OptionsAnalyzer {
  /**
   * Analyze options chain for sentiment indicators
   */
  async analyzeOptionsChain(symbol) {
    try {
      // Get nearest expiration
      const expirations = await tradier.getOptionsExpirations(symbol);
      if (!expirations || expirations.length === 0) {
        return null;
      }

      // Use nearest expiration (most liquid)
      const nearestExpiration = expirations[0];

      // Get options chain
      const chain = await tradier.getOptionsChain(symbol, nearestExpiration);
      if (!chain || chain.length === 0) {
        return null;
      }

      // Separate calls and puts
      const calls = chain.filter(o => o.option_type === 'call');
      const puts = chain.filter(o => o.option_type === 'put');

      // Calculate put/call ratio (volume and open interest)
      const putVolume = puts.reduce((sum, p) => sum + (p.volume || 0), 0);
      const callVolume = calls.reduce((sum, c) => sum + (c.volume || 0), 0);
      const putCallVolumeRatio = callVolume > 0 ? putVolume / callVolume : 0;

      const putOI = puts.reduce((sum, p) => sum + (p.open_interest || 0), 0);
      const callOI = calls.reduce((sum, c) => sum + (c.open_interest || 0), 0);
      const putCallOIRatio = callOI > 0 ? putOI / callOI : 0;

      // Get ATM options for IV
      const currentPrice = chain[0]?.underlying || 0;
      const atmCall = calls.reduce((closest, c) =>
        Math.abs(c.strike - currentPrice) < Math.abs(closest.strike - currentPrice) ? c : closest
      , calls[0]);
      const atmPut = puts.reduce((closest, p) =>
        Math.abs(p.strike - currentPrice) < Math.abs(closest.strike - currentPrice) ? p : closest
      , puts[0]);

      const impliedVolatility = ((atmCall?.greeks?.mid_iv || 0) + (atmPut?.greeks?.mid_iv || 0)) / 2;

      // Detect unusual activity (volume > 2x open interest)
      const unusualCalls = calls.filter(c => c.volume > (c.open_interest * 2));
      const unusualPuts = puts.filter(p => p.volume > (p.open_interest * 2));

      // Sentiment interpretation
      let sentiment = 'neutral';
      if (putCallVolumeRatio > 1.5) sentiment = 'bearish';
      else if (putCallVolumeRatio < 0.67) sentiment = 'bullish';

      return {
        symbol,
        expiration: nearestExpiration,
        putCallVolumeRatio: putCallVolumeRatio.toFixed(2),
        putCallOIRatio: putCallOIRatio.toFixed(2),
        impliedVolatility: (impliedVolatility * 100).toFixed(2) + '%',
        sentiment,
        unusualActivity: {
          calls: unusualCalls.length,
          puts: unusualPuts.length
        },
        interpretation: this.interpretSentiment(putCallVolumeRatio, impliedVolatility, unusualCalls.length, unusualPuts.length)
      };
    } catch (error) {
      console.error(`Error analyzing options for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Interpret options sentiment
   */
  interpretSentiment(pcRatio, iv, unusualCalls, unusualPuts) {
    const signals = [];

    // Put/Call ratio interpretation
    if (pcRatio > 1.5) {
      signals.push('High put/call ratio suggests bearish sentiment');
    } else if (pcRatio < 0.67) {
      signals.push('Low put/call ratio suggests bullish sentiment');
    }

    // IV interpretation
    if (iv > 0.5) {
      signals.push('High implied volatility - expect large price moves');
    } else if (iv < 0.2) {
      signals.push('Low implied volatility - market expects stability');
    }

    // Unusual activity
    if (unusualCalls > 3) {
      signals.push(`${unusualCalls} calls with unusual volume - potential bullish bet`);
    }
    if (unusualPuts > 3) {
      signals.push(`${unusualPuts} puts with unusual volume - potential bearish bet or hedging`);
    }

    return signals.join('. ');
  }

  /**
   * Get options summary for multiple symbols
   */
  async analyzeMultipleSymbols(symbols) {
    const results = [];

    for (const symbol of symbols) {
      const analysis = await this.analyzeOptionsChain(symbol);
      if (analysis) {
        results.push(analysis);
      }
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return results;
  }
}

export default new OptionsAnalyzer();
