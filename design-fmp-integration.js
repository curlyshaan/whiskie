import claude from './src/claude.js';
import advancedFMPScreener from './src/advanced-fmp-screener.js';
import fmpCache from './src/fmp-cache.js';
import * as db from './src/db.js';

/**
 * Opus Integration Designer
 * Asks Opus to design how to integrate advanced FMP data feeds
 * into the screening and decision-making process
 */

async function askOpusToDesignIntegration() {
  console.log('\n🧠 Asking Opus to design advanced FMP integration...\n');

  const prompt = `You are designing the integration of advanced FMP data feeds into Whiskie's trading system.

## Available Data Feeds (All 3 Phases)

**Phase 1 - Smart Money Signals:**
- Insider Trading: Executive buys/sells, transaction values, filing dates
- Institutional Ownership: Top holders, position changes, % of portfolio
- Analyst Estimates: EPS/revenue estimates, revisions, consensus changes

**Phase 2 - Quality & Sentiment:**
- Earnings Surprises: Beat/miss history, consistency patterns
- Price Targets: Analyst targets, revisions, consensus vs current price
- Cash Flow Statement: Operating/investing/financing CF, FCF trends

**Phase 3 - Deep Fundamentals:**
- SEC Filings: 10-K, 10-Q, 8-K (for NLP risk detection)
- ETF Holdings: Which ETFs hold the stock, passive flow impact
- Balance Sheet: Assets, liabilities, working capital trends

## Current System Architecture

**Weekly Flow (Sunday 9pm):**
1. Fundamental screening (FMP: P/E, margins, growth, debt)
2. Opus screening (identifies quality + overvalued stocks)
3. Weekly portfolio review

**Daily Flow (10am/2pm):**
1. Quality watchlist check (dip opportunities)
2. Overvalued watchlist check (breakdown opportunities)
3. Opus analyzes → submits trades for approval

**Current Scoring:**
- Value screening: Revenue/earnings growth, PEG, debt/equity, margins, FCF
- Quality screening: Opus decides based on fundamentals
- Overvalued screening: Opus decides based on fundamentals + technical

## Design Task

Design how to integrate ALL 3 phases of advanced FMP data to improve:

1. **Quality Stock Selection** - Which signals identify true quality?
2. **Overvalued/Broken Detection** - Which signals confirm deterioration?
3. **Entry Timing** - Which signals indicate optimal entry points?
4. **Risk Assessment** - Which signals warn of elevated risk?

**Output Format (JSON):**

\`\`\`json
{
  "phase1_integration": {
    "insider_trading": {
      "use_cases": ["quality_confirmation", "overvalued_warning", "entry_timing"],
      "scoring_rules": {
        "bullish_signal": "3+ insider buys in 90 days, buy value > 2x sell value",
        "bearish_signal": "5+ insider sells in 90 days, sell value > 3x buy value",
        "quality_boost": "+8 points if cluster of insider buying",
        "overvalued_boost": "+6 points if cluster of insider selling"
      },
      "integration_points": ["opus_screener", "daily_analysis"],
      "cache_duration": "7 days"
    },
    "institutional_ownership": {
      "use_cases": ["smart_money_confirmation", "accumulation_detection"],
      "scoring_rules": {
        "bullish_signal": "6+ of top 10 institutions increasing positions >5%",
        "bearish_signal": "6+ of top 10 institutions decreasing positions >5%",
        "quality_boost": "+7 points if institutional accumulation",
        "overvalued_boost": "+7 points if institutional distribution"
      },
      "integration_points": ["opus_screener", "weekly_review"],
      "cache_duration": "30 days"
    },
    "analyst_estimates": {
      "use_cases": ["estimate_revision_momentum", "consensus_divergence"],
      "scoring_rules": {
        "bullish_signal": "EPS estimates revised up >10% quarter-over-quarter",
        "bearish_signal": "EPS estimates revised down >10% quarter-over-quarter",
        "quality_boost": "+6 points if positive estimate revisions",
        "overvalued_boost": "+6 points if negative estimate revisions"
      },
      "integration_points": ["opus_screener", "daily_analysis"],
      "cache_duration": "30 days"
    }
  },
  "phase2_integration": {
    "earnings_surprises": {
      "use_cases": ["quality_consistency", "execution_track_record"],
      "scoring_rules": {
        "quality_signal": "6+ consecutive quarters beating estimates",
        "broken_signal": "3+ consecutive quarters missing estimates",
        "quality_boost": "+5 points if consistent beats",
        "overvalued_boost": "+5 points if recent misses"
      },
      "integration_points": ["opus_screener"],
      "cache_duration": "90 days"
    },
    "price_targets": {
      "use_cases": ["sentiment_gauge", "upside_potential"],
      "scoring_rules": {
        "bullish_signal": "Consensus target >20% above current price",
        "bearish_signal": "Consensus target <10% above current price",
        "quality_consideration": "High targets support quality thesis",
        "overvalued_consideration": "Low targets support overvalued thesis"
      },
      "integration_points": ["opus_screener", "daily_analysis"],
      "cache_duration": "30 days"
    },
    "cash_flow": {
      "use_cases": ["quality_validation", "financial_health"],
      "scoring_rules": {
        "quality_signal": "Positive FCF, growing operating CF",
        "broken_signal": "Negative FCF despite positive earnings",
        "quality_boost": "+8 points if strong FCF generation",
        "overvalued_boost": "+8 points if FCF deterioration"
      },
      "integration_points": ["opus_screener"],
      "cache_duration": "90 days"
    }
  },
  "phase3_integration": {
    "sec_filings": {
      "use_cases": ["risk_detection", "language_analysis"],
      "implementation": "NLP analysis of MD&A section for risk factor changes",
      "integration_points": ["weekly_review"],
      "priority": "low - implement after Phase 1 & 2 proven"
    },
    "etf_holdings": {
      "use_cases": ["passive_flow_analysis", "rebalancing_pressure"],
      "implementation": "Track which ETFs hold stock, predict rebalancing flows",
      "integration_points": ["weekly_review"],
      "priority": "medium - useful for timing"
    },
    "balance_sheet": {
      "use_cases": ["deep_fundamental_health", "working_capital_trends"],
      "implementation": "Supplement existing debt/equity with working capital analysis",
      "integration_points": ["opus_screener"],
      "priority": "medium - enhances quality detection"
    }
  },
  "implementation_priority": {
    "immediate": ["insider_trading", "institutional_ownership", "analyst_estimates"],
    "next_sprint": ["earnings_surprises", "price_targets", "cash_flow"],
    "future": ["sec_filings", "etf_holdings", "balance_sheet"]
  },
  "integration_workflow": {
    "sunday_screening": [
      "Step 1: Fetch fundamental data (existing)",
      "Step 2: Fetch Phase 1 data (insider, institutional, estimates)",
      "Step 3: Fetch Phase 2 data (surprises, targets, cash flow)",
      "Step 4: Opus analyzes ALL data → scores quality/overvalued",
      "Step 5: Update watchlists with enhanced scores"
    ],
    "daily_analysis": [
      "Step 1: Check watchlists for triggers (existing)",
      "Step 2: Fetch recent insider trading (7-day cache)",
      "Step 3: Check analyst estimate changes",
      "Step 4: Opus analyzes with fresh signals → trade decisions"
    ]
  },
  "scoring_framework": {
    "quality_score_max": 100,
    "quality_components": {
      "fundamentals": 40,
      "insider_trading": 8,
      "institutional_ownership": 7,
      "analyst_estimates": 6,
      "earnings_consistency": 5,
      "cash_flow": 8,
      "price_targets": 6,
      "balance_sheet": 5,
      "technical": 15
    },
    "overvalued_score_max": 100,
    "overvalued_components": {
      "valuation_metrics": 35,
      "insider_selling": 6,
      "institutional_distribution": 7,
      "estimate_downgrades": 6,
      "earnings_misses": 5,
      "fcf_deterioration": 8,
      "target_downgrades": 6,
      "technical_breakdown": 20,
      "debt_growth": 7
    }
  }
}
\`\`\`

Design the complete integration strategy. Be specific about scoring rules, integration points, and implementation priority.`;

  const response = await claude.analyze(prompt, {
    model: 'opus',
    extendedThinking: true,
    thinkingBudget: 20000
  });

  return response.analysis;
}

// Run the design session
(async () => {
  try {
    await advancedFMPScreener.initDatabase();
    const design = await askOpusToDesignIntegration();

    console.log('\n' + '='.repeat(80));
    console.log('OPUS INTEGRATION DESIGN');
    console.log('='.repeat(80));
    console.log(design);
    console.log('='.repeat(80));

    // Save design to file
    const fs = await import('fs/promises');
    await fs.writeFile(
      'opus-fmp-integration-design.json',
      design,
      'utf8'
    );

    console.log('\n✅ Design saved to opus-fmp-integration-design.json');

  } catch (error) {
    console.error('❌ Error:', error);
  }
})();
