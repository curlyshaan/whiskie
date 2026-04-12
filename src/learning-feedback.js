/**
 * Learning Feedback Loop
 * Feeds Sunday review insights into daily analysis
 */

import * as db from './db.js';

class LearningFeedback {
  /**
   * Get recent learning insights for context
   */
  async getRecentInsights(daysBack = 30) {
    try {
      const result = await db.query(
        `SELECT insight_type, insight_text, confidence, supporting_evidence, insight_date
         FROM learning_insights
         WHERE insight_date >= NOW() - INTERVAL '${daysBack} days'
         AND applied = false
         ORDER BY insight_date DESC
         LIMIT 10`
      );

      if (result.rows.length === 0) return null;

      // Format insights for Opus context
      const insights = result.rows.map(row => ({
        type: row.insight_type,
        text: row.insight_text,
        confidence: row.confidence,
        date: row.insight_date,
        evidence: row.supporting_evidence
      }));

      return this.formatInsightsForPrompt(insights);

    } catch (error) {
      console.warn('Could not fetch learning insights:', error.message);
      return null;
    }
  }

  /**
   * Format insights for Opus prompt
   */
  formatInsightsForPrompt(insights) {
    if (!insights || insights.length === 0) return null;

    let prompt = '\n\n**RECENT LEARNING INSIGHTS** (from weekly reviews):\n\n';

    for (const insight of insights) {
      prompt += `- **${insight.type}** (${insight.date.toISOString().split('T')[0]}): ${insight.text}\n`;
      if (insight.confidence) {
        prompt += `  Confidence: ${insight.confidence}\n`;
      }
    }

    prompt += '\nConsider these insights when analyzing stocks and making recommendations.\n';
    return prompt;
  }

  /**
   * Mark insight as applied
   */
  async markApplied(insightId) {
    await db.query(
      `UPDATE learning_insights
       SET applied = true, applied_date = CURRENT_DATE
       WHERE id = $1`,
      [insightId]
    );
  }
}

export default new LearningFeedback();
