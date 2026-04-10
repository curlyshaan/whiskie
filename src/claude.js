import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const QUATARLY_API_KEY = process.env.QUATARLY_API_KEY;
const QUATARLY_BASE_URL = process.env.QUATARLY_BASE_URL;

/**
 * Claude AI Models
 */
export const MODELS = {
  OPUS: 'claude-opus-4-6-thinking',      // Use for everything - consistent decisions
  SONNET: 'claude-sonnet-4-6-thinking',  // Deprecated - use Opus instead
  HAIKU: 'claude-haiku-4-5-20251001'     // Deprecated - use Opus instead
};

/**
 * Claude API Wrapper
 * Handles all AI analysis and decision-making
 */
class ClaudeAPI {
  constructor() {
    this.client = axios.create({
      baseURL: QUATARLY_BASE_URL,
      headers: {
        'Authorization': `Bearer ${QUATARLY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Send message to Claude (non-streaming)
   */
  async sendMessage(messages, model = MODELS.SONNET, systemPrompt = null, enableThinking = false, thinkingBudget = 50000) {
    try {
      const payload = {
        model,
        max_tokens: 16000,
        messages
      };

      // Extended thinking requires temperature 1.0
      if (enableThinking && model === MODELS.OPUS) {
        console.log(`🧠 Enabling extended thinking with ${thinkingBudget.toLocaleString()} token budget...`);
        payload.thinking = {
          type: 'enabled',
          budget_tokens: thinkingBudget
        };
        payload.temperature = 1; // Required for extended thinking
        console.log('⏳ This may take 3-7 minutes for DEEP analysis...');
      } else {
        payload.temperature = 0.1; // Consistent, focused decisions for non-thinking calls
      }

      if (systemPrompt) {
        payload.system = systemPrompt;
      }

      console.log(`📡 Calling Claude API (model: ${model}, temp: ${payload.temperature})...`);
      const response = await this.client.post('/v1/messages', payload);
      console.log('✅ Claude API response received');

      return response.data;
    } catch (error) {
      console.error('❌ Claude API Error:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Analyze portfolio and suggest trades
   */
  async analyzePortfolio(portfolioData, marketData, newsData, economicData) {
    const prompt = this.buildPortfolioAnalysisPrompt(
      portfolioData,
      marketData,
      newsData,
      economicData
    );

    const messages = [{ role: 'user', content: prompt }];

    // Use Opus with thinking for all analysis (consistency)
    const response = await this.sendMessage(messages, MODELS.OPUS, null, true);
    return this.parseAnalysisResponse(response);
  }

  /**
   * Deep analysis with Opus (for major decisions)
   */
  async deepAnalysis(portfolioData, marketData, newsData, economicData, question, thinkingBudget = 50000) {
    const prompt = this.buildDeepAnalysisPrompt(
      portfolioData,
      marketData,
      newsData,
      economicData,
      question
    );

    const messages = [{ role: 'user', content: prompt }];

    // Use Opus with extended thinking for major decisions
    const response = await this.sendMessage(messages, MODELS.OPUS, null, true, thinkingBudget);
    return this.parseAnalysisResponse(response);
  }

  /**
   * Evaluate a specific stock for purchase or short
   */
  async evaluateStock(symbol, fundamentals, technicals, newsData) {
    // Format the integrated technical signal for Claude clearly
    const signalSummary = technicals?.technicalSignal
      ? `
**Integrated Technical Signal:** ${technicals.technicalSignal.signal} (score: ${technicals.technicalSignal.score})
Action guidance: ${technicals.technicalSignal.action}
Supporting reasons: ${(technicals.technicalSignal.reasons || []).join('; ')}
Cautions: ${(technicals.technicalSignal.cautions || []).join('; ') || 'None'}

**Key Technical Levels:**
- Price: $${technicals.currentPrice} | SMA50: $${technicals.sma50?.toFixed(2)} | SMA200: $${technicals.sma200?.toFixed(2)}
- Above 50MA: ${technicals.aboveSMA50} | Above 200MA: ${technicals.aboveSMA200}
- 200MA Trending: ${technicals.ma200Trending} (slope: ${technicals.sma200Slope})
- Distance from 200MA: ${technicals.distanceFrom200MA}%
- RSI(14): ${technicals.rsi?.toFixed(1)} | MACD: ${technicals.macd?.bullish ? 'Bullish' : 'Bearish'} | Crossover: ${technicals.macd?.crossover}
- ATR(14): $${technicals.atr14} (${technicals.atrPercent}% of price) — use for stop sizing
- Volume ratio vs 20-day avg: ${technicals.volumeRatio}x`
      : `**Technical Data:** ${JSON.stringify(technicals, null, 2)}`;

    const prompt = `You are a professional stock analyst evaluating ${symbol} for swing/position trading.

**Fundamental Data:**
${JSON.stringify(fundamentals, null, 2)}

${signalSummary}

**Recent News:**
${newsData}

**Analysis Required:**
1. Fundamental strength (revenue growth, profitability, debt levels)
2. Technical setup interpretation — use the integrated signal score above as your starting point, then add your own assessment of support/resistance and trend context
3. SHORT ELIGIBILITY CHECK: If signal is WEAK_SHORT or STRONG_SHORT, verify: (a) is 200MA slope declining? (b) is RSI NOT oversold (<30)? (c) is there no earnings in next 2 weeks? Only recommend short if all three pass.
4. BUY ELIGIBILITY CHECK: If signal is WEAK_BUY or STRONG_BUY, verify: (a) is 200MA rising? (b) is RSI not overbought (>70)? (c) is volume confirming the move?
5. Entry price recommendation — for longs: buy at/near 50MA or 200MA support. For shorts: enter on failed retest of 200MA from below, not on initial breakdown.
6. Stop-loss level — use ATR to set stop: longs stop = entry - (1.5 × ATR14), shorts stop = entry + (1.5 × ATR14)
7. Position size recommendation (as % of portfolio) — reduce size if ATR% > 3% (high volatility)
8. Take-profit targets

**Provide a BUY / SHORT / HOLD / AVOID recommendation with detailed reasoning. Be specific about which technical conditions you are relying on.**`;

    const messages = [{ role: 'user', content: prompt }];
    const response = await this.sendMessage(messages, MODELS.OPUS, null, true);
    return this.parseAnalysisResponse(response);
  }

  /**
   * Evaluate whether to sell a position
   */
  async evaluateSell(symbol, position, currentPrice, newsData, reason) {
    const prompt = `You are a professional portfolio manager. Evaluate whether to sell ${symbol}.

**Current Position:**
- Shares: ${position.quantity}
- Entry Price: $${position.cost_basis}
- Current Price: $${currentPrice}
- Gain/Loss: ${((currentPrice - position.cost_basis) / position.cost_basis * 100).toFixed(2)}%

**Reason for Review:**
${reason}

**Recent News:**
${newsData}

**Decision Required:**
1. Should we SELL, HOLD, or TRIM (partial sell)?
2. If selling, what % of position?
3. Reasoning for decision
4. Risk if we hold vs risk if we sell

**Provide clear recommendation with reasoning.**`;

    const messages = [{ role: 'user', content: prompt }];
    const response = await this.sendMessage(messages, MODELS.OPUS, null, true);
    return this.parseAnalysisResponse(response);
  }

  /**
   * Build portfolio analysis prompt
   */
  buildPortfolioAnalysisPrompt(portfolio, market, news, economic) {
    return `You are Whiskie, an AI portfolio manager with $100,000 under management.

**Current Portfolio:**
${JSON.stringify(portfolio, null, 2)}

**Market Data:**
${JSON.stringify(market, null, 2)}

**Recent News:**
${news}

**Economic Indicators:**
${JSON.stringify(economic, null, 2)}

**Your Task:**
Analyze the portfolio and provide:
1. Overall portfolio health assessment
2. Any positions that need attention (stop-loss triggers, take-profit opportunities)
3. Asset class allocation review
4. Rebalancing recommendations
5. New opportunities to consider
6. Risk assessment

**Investment Strategy:**
- Moderate risk tolerance
- 10-12 positions max
- Max 15% per position
- Core/Satellite approach (60% core, 25% growth, 15% opportunistic)
- Time horizon: months to years

**Provide actionable recommendations with specific reasoning.**`;
  }

  /**
   * Build deep analysis prompt with REAL-TIME prices emphasized
   */
  buildDeepAnalysisPrompt(portfolio, market, news, economic, question) {
    // Format market data to emphasize current prices
    let marketPricesText = '\n**🔴 REAL-TIME STOCK PRICES (USE THESE - NOT YOUR TRAINING DATA):**\n';
    if (market && Object.keys(market).length > 0) {
      Object.entries(market).forEach(([symbol, data]) => {
        marketPricesText += `- ${symbol}: $${data.price} (${data.change_percentage >= 0 ? '+' : ''}${data.change_percentage}%)\n`;
      });
    } else {
      marketPricesText += '(No market data available)\n';
    }

    return `You are Whiskie, an AI portfolio manager. Use extended thinking to deeply analyze this question.

**Question:**
${question}

**Current Portfolio:**
${JSON.stringify(portfolio, null, 2)}

${marketPricesText}

**⚠️ CRITICAL INSTRUCTION:**
The prices above are LIVE, REAL-TIME quotes from Tradier API as of RIGHT NOW.
DO NOT use prices from your training data. ONLY use the prices listed above.
When recommending trades, use THESE EXACT PRICES.

**Recent News:**
${news}

**Economic Data:**
${JSON.stringify(economic, null, 2)}

**Think deeply about:**
- Multiple scenarios and outcomes
- Second-order effects
- Risk vs reward tradeoffs
- Alternative approaches
- What could go wrong

**Provide a thorough, well-reasoned answer with specific recommendations using CURRENT PRICES.**`;
  }

  /**
   * Parse Claude's response
   * Note: thinking blocks are kept internal, only text is returned to user
   */
  parseAnalysisResponse(response) {
    const textBlock = response.content.find(b => b.type === 'text');
    const thinkingBlock = response.content.find(b => b.type === 'thinking');

    let analysisText = textBlock?.text || '';

    // AGGRESSIVE thinking block removal - strip everything before the actual recommendations
    // Extended thinking often starts with "<thinking>" and contains internal reasoning

    // Remove everything from start until we find actual content markers
    // Look for common start patterns: "##", "EXECUTE_", "WATCHLIST_", or numbered lists
    const contentStartPatterns = [
      /^[\s\S]*?(?=##\s+\w)/m,  // Starts with markdown header
      /^[\s\S]*?(?=EXECUTE_BUY:|EXECUTE_SHORT:|WATCHLIST_ADD:)/m,  // Starts with trade commands
      /^[\s\S]*?(?=\*\*SELL)/m,  // Starts with SELL section
      /^[\s\S]*?(?=\d+\.\s+\*\*)/m,  // Starts with numbered list
    ];

    // Try each pattern to find where actual content begins
    for (const pattern of contentStartPatterns) {
      const match = analysisText.match(pattern);
      if (match && match[0].includes('<thinking>')) {
        // Found thinking block before content - remove it
        analysisText = analysisText.replace(pattern, '');
        break;
      }
    }

    // Fallback: Remove any remaining thinking tags
    analysisText = analysisText.replace(/<thinking_protocol>[\s\S]*?<\/thinking_protocol>/gi, '');
    analysisText = analysisText.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    analysisText = analysisText.replace(/```thinking[\s\S]*?```/gi, '');

    // Clean up excessive whitespace
    analysisText = analysisText.replace(/\n{3,}/g, '\n\n').trim();

    return {
      analysis: analysisText,
      thinking: thinkingBlock?.thinking || null, // Stored but not displayed
      model: response.model,
      usage: response.usage
    };
  }

  /**
   * Quick sentiment check (now uses Opus for consistency)
   */
  async quickSentimentCheck(newsHeadlines) {
    const prompt = `Analyze market sentiment from these headlines. Respond with: BULLISH, BEARISH, or NEUTRAL and brief reason.

Headlines:
${newsHeadlines}`;

    const messages = [{ role: 'user', content: prompt }];
    const response = await this.sendMessage(messages, MODELS.OPUS, null, true);
    return this.parseAnalysisResponse(response);
  }

  /**
   * General-purpose analysis with extended thinking
   * Used by weekly-review and other modules
   */
  async analyze(prompt, options = {}) {
    const model = options.model === 'opus' ? MODELS.OPUS : MODELS.SONNET;
    const messages = [{ role: 'user', content: prompt }];
    // Always use extended thinking for thorough analysis
    const response = await this.sendMessage(messages, model, null, true);
    return this.parseAnalysisResponse(response);
  }
}

export default new ClaudeAPI();
