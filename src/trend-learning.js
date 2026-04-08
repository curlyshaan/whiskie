import * as db from './db.js';
import claude from './claude.js';

/**
 * Trend Learning Module
 * Learns from historical analysis patterns to improve future decisions
 */

/**
 * Save stock analysis to history
 */
export async function saveStockAnalysis(analysis) {
  try {
    const result = await db.query(
      `INSERT INTO stock_analysis_history (
        symbol, analysis_date, analysis_type, price_at_analysis,
        thesis, recommendation, confidence, key_factors
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (symbol, analysis_date, analysis_type)
      DO UPDATE SET
        price_at_analysis = $4,
        thesis = $5,
        recommendation = $6,
        confidence = $7,
        key_factors = $8
      RETURNING *`,
      [
        analysis.symbol,
        analysis.date || new Date().toISOString().split('T')[0],
        analysis.type, // 'daily', 'weekly', 'earnings', 'news_event'
        analysis.price,
        analysis.thesis,
        analysis.recommendation,
        analysis.confidence,
        JSON.stringify(analysis.keyFactors || [])
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving stock analysis:', error);
    throw error;
  }
}

/**
 * Get historical analysis for a stock
 */
export async function getStockAnalysisHistory(symbol, limit = 10) {
  try {
    const result = await db.query(
      `SELECT * FROM stock_analysis_history
       WHERE symbol = $1
       ORDER BY analysis_date DESC
       LIMIT $2`,
      [symbol, limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching stock analysis history:', error);
    return [];
  }
}

/**
 * Update analysis outcome (called after time passes)
 */
export async function updateAnalysisOutcome(analysisId, outcome) {
  try {
    const result = await db.query(
      `UPDATE stock_analysis_history
       SET outcome = $2,
           outcome_notes = $3,
           days_to_outcome = $4,
           price_change_pct = $5
       WHERE id = $1
       RETURNING *`,
      [
        analysisId,
        outcome.result, // 'correct', 'incorrect', 'partial'
        outcome.notes,
        outcome.daysToOutcome,
        outcome.priceChangePct
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error updating analysis outcome:', error);
    throw error;
  }
}

/**
 * Save market trend pattern
 */
export async function saveMarketTrendPattern(pattern) {
  try {
    const result = await db.query(
      `INSERT INTO market_trend_patterns (
        pattern_date, pattern_type, pattern_description,
        affected_sectors, key_indicators, opus_insight, action_taken
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        pattern.date || new Date().toISOString().split('T')[0],
        pattern.type,
        pattern.description,
        JSON.stringify(pattern.affectedSectors || []),
        JSON.stringify(pattern.keyIndicators || {}),
        pattern.opusInsight,
        pattern.actionTaken
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving market trend pattern:', error);
    throw error;
  }
}

/**
 * Get recent market trend patterns
 */
export async function getRecentMarketTrends(days = 30, limit = 20) {
  try {
    const result = await db.query(
      `SELECT * FROM market_trend_patterns
       WHERE pattern_date >= CURRENT_DATE - INTERVAL '${days} days'
       ORDER BY pattern_date DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching market trends:', error);
    return [];
  }
}

/**
 * Save learning insight
 */
export async function saveLearningInsight(insight) {
  try {
    const result = await db.query(
      `INSERT INTO learning_insights (
        insight_date, insight_type, insight_text,
        confidence, supporting_evidence
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [
        insight.date || new Date().toISOString().split('T')[0],
        insight.type,
        insight.text,
        insight.confidence,
        JSON.stringify(insight.supportingEvidence || [])
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving learning insight:', error);
    throw error;
  }
}

/**
 * Get unapplied learning insights
 */
export async function getUnappliedInsights() {
  try {
    const result = await db.query(
      `SELECT * FROM learning_insights
       WHERE applied = FALSE
       ORDER BY insight_date DESC`
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching unapplied insights:', error);
    return [];
  }
}

/**
 * Mark insight as applied
 */
export async function markInsightApplied(insightId, effectiveness = 'pending') {
  try {
    const result = await db.query(
      `UPDATE learning_insights
       SET applied = TRUE,
           applied_date = CURRENT_DATE,
           effectiveness = $2
       WHERE id = $1
       RETURNING *`,
      [insightId, effectiveness]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error marking insight as applied:', error);
    throw error;
  }
}

/**
 * Build a human-readable learning summary for the last N days
 * Used to inject into Claude's analysis prompt
 */
export async function getLearningSummary(days = 30) {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    // Get analyses with known outcomes
    const result = await db.query(`
      SELECT symbol, recommendation, outcome, price_change_pct, days_to_outcome
      FROM stock_analysis_history
      WHERE analysis_date >= $1
        AND outcome IS NOT NULL
      ORDER BY analysis_date DESC
      LIMIT 50
    `, [cutoff.toISOString().split('T')[0]]);

    if (result.rows.length === 0) return null;

    const correct = result.rows.filter(r => r.outcome === 'correct');
    const incorrect = result.rows.filter(r => r.outcome === 'incorrect');

    // Find symbols where AI was wrong repeatedly
    const wrongSymbols = {};
    incorrect.forEach(r => {
      wrongSymbols[r.symbol] = (wrongSymbols[r.symbol] || 0) + 1;
    });
    const repeatMistakes = Object.entries(wrongSymbols)
      .filter(([_, count]) => count > 1)
      .map(([sym, count]) => `${sym} (wrong ${count}x)`);

    let summary = `AI accuracy last ${days} days: ${correct.length}/${result.rows.length} correct (${((correct.length/result.rows.length)*100).toFixed(0)}%)`;
    if (repeatMistakes.length > 0) {
      summary += `\nRepeated wrong calls: ${repeatMistakes.join(', ')} — avoid these stocks`;
    }

    return summary;
  } catch (error) {
    console.error('Error building learning summary:', error);
    return null;
  }
}

/**
 * Ask Opus to learn from historical patterns (daily)
 */
export async function runDailyTrendLearning(currentPositions, recentTrades) {
  try {
    console.log('🧠 Running daily trend learning...');

    // Get recent analysis history for held positions
    const analysisHistory = [];
    for (const pos of currentPositions) {
      const history = await getStockAnalysisHistory(pos.symbol, 5);
      if (history.length > 0) {
        analysisHistory.push({ symbol: pos.symbol, history });
      }
    }

    // Get recent market trends
    const marketTrends = await getRecentMarketTrends(7);

    if (analysisHistory.length === 0 && marketTrends.length === 0) {
      console.log('   No historical data to learn from yet');
      return null;
    }

    const prompt = `
You are analyzing DAILY TRADING PATTERNS to improve future decisions.

RECENT ANALYSIS HISTORY:
${analysisHistory.map(a => `${a.symbol}: ${a.history.length} analyses in past week`).join('\n')}

RECENT MARKET TRENDS:
${marketTrends.map(t => `${t.pattern_date}: ${t.pattern_type} - ${t.pattern_description}`).join('\n')}

RECENT TRADES:
${recentTrades.map(t => `${t.symbol}: ${t.action} at $${t.price} - ${t.reasoning}`).join('\n')}

QUESTIONS FOR DAILY LEARNING:
1. Are there any stock-specific patterns emerging? (e.g., "NVDA always gaps up on partnership news")
2. Are there any market-level patterns? (e.g., "tech sells off when yields spike")
3. What worked well in recent trades that we should repeat?
4. What didn't work that we should avoid?
5. Any insights that should inform tomorrow's analysis?

Provide specific, actionable insights. Format as:

STOCK_PATTERN: [symbol] - [pattern description]
MARKET_PATTERN: [pattern description]
REPEAT: [what worked well]
AVOID: [what didn't work]
INSIGHT: [actionable insight for future]
`;

    const analysis = await claude.analyze(prompt, { model: 'opus' });

    // Parse and save insights
    const insights = parseInsights(analysis.analysis);
    for (const insight of insights) {
      await saveLearningInsight(insight);
    }

    console.log(`   Generated ${insights.length} learning insights`);
    return { insights, analysis: analysis.analysis };

  } catch (error) {
    console.error('Error in daily trend learning:', error);
    return null;
  }
}

/**
 * Ask Opus to learn from weekly patterns
 */
export async function runWeeklyTrendLearning(weeklyReviews, weeklyPerf) {
  try {
    console.log('🧠 Running weekly trend learning...');

    // Get all unapplied insights
    const unappliedInsights = await getUnappliedInsights();

    // Get market trends from past 30 days
    const marketTrends = await getRecentMarketTrends(30);

    const prompt = `
You are conducting WEEKLY STRATEGIC LEARNING to improve long-term performance.

WEEKLY POSITION REVIEWS:
${weeklyReviews.map(r => `${r.symbol}: ${r.gainPercent}% - ${r.analysis.substring(0, 200)}...`).join('\n\n')}

WEEKLY PERFORMANCE:
${JSON.stringify(weeklyPerf, null, 2)}

UNAPPLIED INSIGHTS FROM DAILY LEARNING:
${unappliedInsights.map(i => `[${i.insight_type}] ${i.insight_text}`).join('\n')}

MARKET TRENDS (PAST 30 DAYS):
${marketTrends.map(t => `${t.pattern_date}: ${t.pattern_type} - ${t.opus_insight}`).join('\n')}

QUESTIONS FOR WEEKLY LEARNING:
1. Which daily insights should we apply going forward? Which should we discard?
2. Are there any longer-term patterns emerging across multiple stocks?
3. What strategic adjustments should we make based on what we learned this week?
4. Are there any sector rotation patterns we should act on?
5. What's our biggest blind spot right now?

Provide strategic, high-confidence insights only. Format as:

APPLY_INSIGHT: [insight ID or description] - [why and how to apply]
DISCARD_INSIGHT: [insight ID or description] - [why it's not useful]
STRATEGIC_PATTERN: [pattern description] - [how to use it]
ADJUSTMENT: [what to change] - [why]
BLIND_SPOT: [what we're missing] - [how to address]
`;

    const analysis = await claude.analyze(prompt, { model: 'opus' });

    // Parse and save strategic insights
    const insights = parseInsights(analysis.analysis);
    for (const insight of insights) {
      await saveLearningInsight(insight);
    }

    console.log(`   Generated ${insights.length} strategic insights`);
    return { insights, analysis: analysis.analysis };

  } catch (error) {
    console.error('Error in weekly trend learning:', error);
    return null;
  }
}

/**
 * Parse insights from Opus analysis
 */
function parseInsights(analysisText) {
  const insights = [];

  // Parse STOCK_PATTERN
  const stockPatterns = analysisText.match(/STOCK_PATTERN: (.+?)(?:\n|$)/gi);
  if (stockPatterns) {
    stockPatterns.forEach(match => {
      const text = match.replace(/STOCK_PATTERN: /i, '').trim();
      insights.push({
        type: 'stock_pattern',
        text,
        confidence: 'medium',
        supportingEvidence: []
      });
    });
  }

  // Parse MARKET_PATTERN
  const marketPatterns = analysisText.match(/MARKET_PATTERN: (.+?)(?:\n|$)/gi);
  if (marketPatterns) {
    marketPatterns.forEach(match => {
      const text = match.replace(/MARKET_PATTERN: /i, '').trim();
      insights.push({
        type: 'market_pattern',
        text,
        confidence: 'medium',
        supportingEvidence: []
      });
    });
  }

  // Parse INSIGHT
  const generalInsights = analysisText.match(/INSIGHT: (.+?)(?:\n|$)/gi);
  if (generalInsights) {
    generalInsights.forEach(match => {
      const text = match.replace(/INSIGHT: /i, '').trim();
      insights.push({
        type: 'strategy_adjustment',
        text,
        confidence: 'high',
        supportingEvidence: []
      });
    });
  }

  // Parse STRATEGIC_PATTERN
  const strategicPatterns = analysisText.match(/STRATEGIC_PATTERN: (.+?)(?:\n|$)/gi);
  if (strategicPatterns) {
    strategicPatterns.forEach(match => {
      const text = match.replace(/STRATEGIC_PATTERN: /i, '').trim();
      insights.push({
        type: 'strategy_adjustment',
        text,
        confidence: 'high',
        supportingEvidence: []
      });
    });
  }

  return insights;
}

export default {
  saveStockAnalysis,
  getStockAnalysisHistory,
  updateAnalysisOutcome,
  saveMarketTrendPattern,
  getRecentMarketTrends,
  saveLearningInsight,
  getUnappliedInsights,
  markInsightApplied,
  runDailyTrendLearning,
  runWeeklyTrendLearning
};
