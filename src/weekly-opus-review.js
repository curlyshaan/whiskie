import * as db from './db.js';
import claude, { MODELS } from './claude.js';
import fmp from './fmp.js';
import tavily from './tavily.js';
import email from './email.js';

/**
 * Weekly Opus Review Module
 *
 * Analyzes all saturday_watchlist candidates with Opus extended thinking
 * to identify top 10-15 stocks per pathway based on thesis strength.
 *
 * This fixes the momentum bias issue where deepValue stocks get filtered out
 * if they don't have volume surge on a given day.
 *
 * Runs: Sunday 9pm ET (after Saturday 3pm fundamental screening)
 */

class WeeklyOpusReview {
  constructor() {
    this.TOP_PER_PATHWAY = 15; // Top 15 stocks per pathway
    this.THINKING_BUDGET = 30000; // 30k tokens per stock
  }

  /**
   * Main entry point - analyze all pending watchlist stocks
   */
  async runWeeklyReview() {
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('🔬 WEEKLY OPUS REVIEW');
    console.log('═══════════════════════════════════════');
    console.log('');

    try {
      // Get all stocks from saturday_watchlist (status = 'active' from Saturday screening)
      const result = await db.query(
        `SELECT symbol, intent, pathway, sector, industry, score, metrics, reasons, price
         FROM saturday_watchlist
         WHERE status = 'active'
         ORDER BY pathway, score DESC`
      );

      const candidates = result.rows;
      console.log(`📋 Found ${candidates.length} candidates from Saturday screening`);

      if (candidates.length === 0) {
        console.log('ℹ️  No candidates to review, skipping');
        return { analyzed: 0, activated: 0 };
      }

      // Group by pathway
      const byPathway = {};
      for (const candidate of candidates) {
        const pathway = candidate.pathway || 'unknown';
        if (!byPathway[pathway]) {
          byPathway[pathway] = [];
        }
        byPathway[pathway].push(candidate);
      }

      console.log(`\n📊 Candidates by pathway:`);
      for (const [pathway, stocks] of Object.entries(byPathway)) {
        console.log(`   ${pathway}: ${stocks.length} stocks`);
      }

      // Set all to 'pending' before Opus review
      await db.query(`UPDATE saturday_watchlist SET status = 'pending' WHERE status = 'active'`);
      console.log(`\n⏸️  Set all ${candidates.length} stocks to 'pending' status`);

      // Analyze each pathway
      let totalAnalyzed = 0;
      let totalActivated = 0;

      for (const [pathway, stocks] of Object.entries(byPathway)) {
        console.log(`\n🔍 Analyzing ${pathway} pathway (${stocks.length} stocks)...`);

        const analyzed = await this.analyzePathway(pathway, stocks);
        totalAnalyzed += analyzed.length;

        // Sort by Opus conviction score and take top N
        const topStocks = analyzed
          .sort((a, b) => b.opusScore - a.opusScore)
          .slice(0, this.TOP_PER_PATHWAY);

        // Set top stocks to 'active'
        for (const stock of topStocks) {
          await db.query(
            `UPDATE saturday_watchlist
             SET status = 'active',
                 last_reviewed = NOW(),
                 opus_conviction = $1,
                 opus_reasoning = $2
             WHERE symbol = $3 AND pathway = $4`,
            [stock.opusScore, stock.opusReasoning, stock.symbol, pathway]
          );
        }

        totalActivated += topStocks.length;

        console.log(`   ✅ Activated top ${topStocks.length}/${stocks.length} stocks for ${pathway}`);
        console.log(`   Top 3: ${topStocks.slice(0, 3).map(s => `${s.symbol} (${s.opusScore})`).join(', ')}`);
      }

      console.log(`\n✅ Weekly Opus review complete`);
      console.log(`   Analyzed: ${totalAnalyzed} stocks`);
      console.log(`   Activated: ${totalActivated} stocks (top ${this.TOP_PER_PATHWAY} per pathway)`);
      console.log(`   Pending: ${totalAnalyzed - totalActivated} stocks`);

      // Send summary email
      await this.sendSummaryEmail(byPathway, totalAnalyzed, totalActivated);

      return { analyzed: totalAnalyzed, activated: totalActivated };

    } catch (error) {
      console.error('❌ Error in weekly Opus review:', error);
      await email.sendErrorAlert(error, 'Weekly Opus review failed');
      throw error;
    }
  }

  /**
   * Analyze all stocks in a pathway with Opus
   */
  async analyzePathway(pathway, stocks) {
    const analyzed = [];

    // Performance optimization: Only analyze top 20 per pathway (not all candidates)
    // Sorted by fundamental score, then Opus picks top 15 by thesis strength
    const topCandidates = stocks
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    console.log(`   Analyzing top ${topCandidates.length}/${stocks.length} candidates (sorted by fundamental score)`);

    for (let i = 0; i < topCandidates.length; i++) {
      const stock = topCandidates[i];
      console.log(`   [${i + 1}/${topCandidates.length}] Analyzing ${stock.symbol}...`);

      try {
        const analysis = await this.analyzeStock(stock, pathway);
        analyzed.push({
          symbol: stock.symbol,
          opusScore: analysis.score,
          opusReasoning: analysis.reasoning
        });

        // Rate limiting: 2-second delay between calls
        if (i < topCandidates.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

      } catch (error) {
        console.error(`   ❌ Error analyzing ${stock.symbol}:`, error.message);
        // Continue with next stock
      }
    }

    return analyzed;
  }

  /**
   * Analyze a single stock with Opus extended thinking
   */
  async analyzeStock(stock, pathway) {
    try {
      // Get stock profile if exists
      const profileResult = await db.query(
        'SELECT * FROM stock_profiles WHERE symbol = $1',
        [stock.symbol]
      );
      const profile = profileResult.rows[0];

      // Get latest fundamentals from FMP
      const [ratios, keyMetrics, quote] = await Promise.all([
        fmp.getRatiosTTM(stock.symbol),
        fmp.getKeyMetricsTTM(stock.symbol),
        fmp.getQuote(stock.symbol)
      ]);

      // Search recent news
      const news = await tavily.search(`${stock.symbol} stock news earnings`, {
        days: 7,
        max_results: 3
      });

      // Build Opus prompt
      const prompt = this.buildAnalysisPrompt(stock, pathway, profile, ratios, keyMetrics, quote, news);

      // Call Opus with extended thinking
      const messages = [{ role: 'user', content: prompt }];
      const response = await claude.sendMessage(
        messages,
        MODELS.OPUS,
        null,
        true, // enableThinking
        this.THINKING_BUDGET
      );

      // Extract text from response
      let responseText = '';
      if (response.content && response.content[0] && response.content[0].text) {
        responseText = response.content[0].text;
      } else if (typeof response === 'string') {
        responseText = response;
      }

      // Parse Opus output
      const parsed = this.parseOpusResponse(responseText);

      return {
        score: parsed.score,
        reasoning: parsed.reasoning
      };

    } catch (error) {
      console.error(`Error analyzing ${stock.symbol}:`, error);
      throw error;
    }
  }

  /**
   * Build Opus analysis prompt
   */
  buildAnalysisPrompt(stock, pathway, profile, ratios, keyMetrics, quote, news) {
    const intent = stock.intent;
    const metrics = typeof stock.metrics === 'string' ? JSON.parse(stock.metrics) : stock.metrics;

    let prompt = `You are analyzing ${stock.symbol} for the ${pathway} pathway (${intent} position).

SATURDAY SCREENING RESULTS:
- Pathway: ${pathway}
- Score: ${stock.score}
- Reasons: ${stock.reasons}
- Price: $${stock.price}

`;

    // Add stock profile if exists
    if (profile) {
      prompt += `STOCK PROFILE:
- Business Model: ${profile.business_model || 'N/A'}
- Moats: ${profile.moats || 'N/A'}
- Risks: ${profile.risks || 'N/A'}
- Catalysts: ${profile.catalysts || 'N/A'}

`;
    }

    // Add fundamentals
    prompt += `CURRENT FUNDAMENTALS:
- P/E: ${ratios?.peRatio?.toFixed(2) || 'N/A'}
- PEG: ${ratios?.pegRatio?.toFixed(2) || 'N/A'}
- Revenue Growth (YoY): ${(metrics?.revenueGrowthQ * 100)?.toFixed(1) || 'N/A'}%
- Operating Margin: ${(ratios?.operatingMargin * 100)?.toFixed(1) || 'N/A'}%
- ROE: ${(ratios?.returnOnEquity * 100)?.toFixed(1) || 'N/A'}%
- FCF Yield: ${(keyMetrics?.freeCashFlowYield * 100)?.toFixed(1) || 'N/A'}%
- Current Price: $${quote?.last || stock.price}

`;

    // Add recent news
    if (news && news.length > 0) {
      prompt += `RECENT NEWS:\n`;
      news.forEach((item, i) => {
        prompt += `${i + 1}. ${item.title}\n   ${item.snippet}\n\n`;
      });
    }

    // Pathway-specific evaluation criteria
    if (intent === 'LONG') {
      prompt += `EVALUATION CRITERIA FOR ${pathway.toUpperCase()}:

Assess this stock's investment thesis strength considering:
1. **Thesis Validity**: How compelling is the ${pathway} thesis? Is it backed by data?
2. **Catalyst Timing**: Are there near-term catalysts (earnings, product launches, etc.)?
3. **Risk/Reward**: What's the upside potential vs downside risk?
4. **Entry Opportunity**: Is current price an attractive entry point?
5. **Competitive Position**: How defensible is the business model?

`;
    } else {
      prompt += `EVALUATION CRITERIA FOR SHORT (${pathway.toUpperCase()}):

Assess this short thesis strength considering:
1. **Overvaluation Severity**: How extreme is the valuation vs fundamentals?
2. **Deterioration Evidence**: Are fundamentals clearly weakening?
3. **Catalyst Timing**: What could trigger a re-rating lower?
4. **Short Safety**: Borrow availability, squeeze risk, meme stock risk?
5. **Risk/Reward**: Downside potential vs risk of squeeze/rally?

`;
    }

    prompt += `OUTPUT FORMAT:
Return ONLY a JSON object (no markdown, no other text):
{
  "score": <0-100 conviction score>,
  "reasoning": "<2-3 sentence summary of why this is/isn't a compelling opportunity>"
}

Score guidelines:
- 80-100: Exceptional opportunity, high conviction
- 60-79: Good opportunity, moderate conviction
- 40-59: Marginal opportunity, low conviction
- 0-39: Weak opportunity, pass

Take your time to think through this carefully. Consider both bull and bear cases.`;

    return prompt;
  }

  /**
   * Parse Opus response
   */
  parseOpusResponse(responseText) {
    try {
      // Strip markdown code blocks if present
      const cleaned = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      return {
        score: parsed.score || 0,
        reasoning: parsed.reasoning || 'No reasoning provided'
      };
    } catch (error) {
      console.error('Failed to parse Opus response:', error.message);
      console.error('Response text:', responseText);
      return {
        score: 0,
        reasoning: 'Failed to parse Opus response'
      };
    }
  }

  /**
   * Send summary email
   */
  async sendSummaryEmail(byPathway, totalAnalyzed, totalActivated) {
    try {
      let emailBody = `<h2>Weekly Opus Review Complete</h2>`;
      emailBody += `<p><strong>Total Analyzed:</strong> ${totalAnalyzed} stocks</p>`;
      emailBody += `<p><strong>Total Activated:</strong> ${totalActivated} stocks (top ${this.TOP_PER_PATHWAY} per pathway)</p>`;
      emailBody += `<p><strong>Pending:</strong> ${totalAnalyzed - totalActivated} stocks</p>`;

      emailBody += `<h3>Breakdown by Pathway:</h3><ul>`;
      for (const [pathway, stocks] of Object.entries(byPathway)) {
        const activated = Math.min(stocks.length, this.TOP_PER_PATHWAY);
        emailBody += `<li><strong>${pathway}</strong>: ${activated}/${stocks.length} activated</li>`;
      }
      emailBody += `</ul>`;

      emailBody += `<p>Active stocks are now ready for daily analysis. Pending stocks remain in watchlist but won't be analyzed unless they show momentum.</p>`;

      await email.sendEmail(
        'Weekly Opus Review Complete',
        emailBody
      );
    } catch (error) {
      console.error('Failed to send summary email:', error);
      // Non-critical, continue
    }
  }
}

export default new WeeklyOpusReview();
