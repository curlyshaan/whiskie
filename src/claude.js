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
  async sendMessage(messages, model = MODELS.SONNET, systemPrompt = null, enableThinking = false) {
    try {
      const payload = {
        model,
        max_tokens: 16000,
        temperature: 0.1, // Consistent, focused decisions
        messages
      };

      if (systemPrompt) {
        payload.system = systemPrompt;
      }

      // Enable extended thinking for Opus with MAX budget
      if (enableThinking && model === MODELS.OPUS) {
        console.log('🧠 Enabling extended thinking with 50,000 token budget (MAX)...');
        payload.thinking = {
          type: 'enabled',
          budget_tokens: 50000
        };
        console.log('⏳ This may take 3-7 minutes for DEEP analysis...');
      }

      console.log(`📡 Calling Claude API (model: ${model}, temp: 0.1)...`);
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
  async deepAnalysis(portfolioData, marketData, newsData, economicData, question) {
    const prompt = this.buildDeepAnalysisPrompt(
      portfolioData,
      marketData,
      newsData,
      economicData,
      question
    );

    const messages = [{ role: 'user', content: prompt }];

    // Use Opus with extended thinking for major decisions
    const response = await this.sendMessage(messages, MODELS.OPUS, null, true);
    return this.parseAnalysisResponse(response);
  }

  /**
   * Evaluate a specific stock for purchase
   */
  async evaluateStock(symbol, fundamentals, technicals, newsData) {
    const prompt = `You are a professional stock analyst. Evaluate ${symbol} for potential purchase.

**Fundamental Data:**
${JSON.stringify(fundamentals, null, 2)}

**Technical Data:**
${JSON.stringify(technicals, null, 2)}

**Recent News:**
${newsData}

**Analysis Required:**
1. Fundamental strength (revenue growth, profitability, debt levels)
2. Technical setup (trend, support/resistance, momentum)
3. Risk assessment
4. Entry price recommendation
5. Position size recommendation (as % of portfolio)
6. Stop-loss level
7. Take-profit targets

**Provide a BUY/HOLD/AVOID recommendation with detailed reasoning.**`;

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
3. Sector allocation review
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

    // Strip out thinking protocol tags if they appear in the text
    // Some APIs return thinking inline wrapped in <thinking_protocol> tags
    if (analysisText.includes('<thinking_protocol>')) {
      const thinkingStart = analysisText.indexOf('<thinking_protocol>');
      const thinkingEnd = analysisText.indexOf('</thinking_protocol>');
      if (thinkingStart !== -1 && thinkingEnd !== -1) {
        // Remove everything from <thinking_protocol> to </thinking_protocol>
        analysisText = analysisText.substring(0, thinkingStart) +
                      analysisText.substring(thinkingEnd + '</thinking_protocol>'.length);
        // Clean up extra whitespace
        analysisText = analysisText.trim();
      }
    }

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
}

export default new ClaudeAPI();
