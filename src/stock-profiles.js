import * as db from './db.js';
import claude from './claude.js';
import fmp from './fmp.js';
import yahooFinance from './yahoo-finance.js';
import tavily from './tavily.js';

/**
 * Stock Profiles Module
 * Manages comprehensive stock research profiles for efficient daily analysis
 */

/**
 * Save or update stock profile
 */
export async function saveStockProfile(profile) {
  try {
    const result = await db.query(
      `INSERT INTO stock_profiles (
        symbol, business_model, moats, competitive_advantages,
        fundamentals, risks, catalysts, last_updated, profile_version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $8)
      ON CONFLICT (symbol)
      DO UPDATE SET
        business_model = $2,
        moats = $3,
        competitive_advantages = $4,
        fundamentals = $5,
        risks = $6,
        catalysts = $7,
        last_updated = CURRENT_TIMESTAMP,
        profile_version = stock_profiles.profile_version + 1
      RETURNING *`,
      [
        profile.symbol,
        profile.business_model,
        profile.moats,
        profile.competitive_advantages,
        JSON.stringify(profile.fundamentals || {}),
        profile.risks,
        profile.catalysts,
        profile.profile_version || 1
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error(`Error saving stock profile for ${profile.symbol}:`, error);
    throw error;
  }
}

/**
 * Get stock profile
 */
export async function getStockProfile(symbol) {
  try {
    const result = await db.query(
      `SELECT * FROM stock_profiles WHERE symbol = $1`,
      [symbol]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error(`Error fetching stock profile for ${symbol}:`, error);
    return null;
  }
}

/**
 * Get multiple stock profiles
 */
export async function getStockProfiles(symbols) {
  try {
    const result = await db.query(
      `SELECT * FROM stock_profiles WHERE symbol = ANY($1)`,
      [symbols]
    );

    // Return as map for easy lookup
    const profileMap = {};
    result.rows.forEach(profile => {
      profileMap[profile.symbol] = profile;
    });
    return profileMap;
  } catch (error) {
    console.error('Error fetching stock profiles:', error);
    return {};
  }
}

/**
 * Get stale profiles (older than N days)
 */
export async function getStaleProfiles(daysOld = 14) {
  try {
    const result = await db.query(
      `SELECT symbol, last_updated
       FROM stock_profiles
       WHERE last_updated < NOW() - INTERVAL '${daysOld} days'
       ORDER BY last_updated ASC`,
      []
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching stale profiles:', error);
    return [];
  }
}

/**
 * Build comprehensive stock profile using deep research
 */
export async function buildStockProfile(symbol) {
  console.log(`\n🔬 Building comprehensive profile for ${symbol}...`);

  try {
    // Fetch comprehensive data from multiple sources
    console.log('  📊 Fetching fundamentals from FMP...');
    const fundamentals = await fmp.getFundamentals(symbol);

    console.log('  📈 Fetching historical data...');
    const historicalData = await yahooFinance.getHistoricalData(
      symbol,
      new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      new Date().toISOString().split('T')[0]
    );

    console.log('  📰 Fetching recent news...');
    const news = await tavily.search(`${symbol} stock analysis business model competitive advantages`, 5);

    // Build context for Opus deep research
    const researchPrompt = `Conduct comprehensive research on ${symbol} and build a detailed stock profile.

**Available Data:**

**Fundamentals (FMP):**
${JSON.stringify(fundamentals, null, 2)}

**Price History (1 year):**
- Current: $${historicalData[historicalData.length - 1]?.close || 'N/A'}
- 52-week high: $${Math.max(...historicalData.map(d => d.high)).toFixed(2)}
- 52-week low: $${Math.min(...historicalData.map(d => d.low)).toFixed(2)}
- YTD return: ${(((historicalData[historicalData.length - 1]?.close - historicalData[0]?.close) / historicalData[0]?.close) * 100).toFixed(1)}%

**Recent News:**
${news.map(n => `- ${n.title}\n  ${n.content?.substring(0, 200)}...`).join('\n\n')}

**Your Task:** Create a comprehensive stock profile with the following sections:

1. **BUSINESS_MODEL** (2-3 paragraphs)
   - What does the company do? How do they make money?
   - Revenue streams, customer segments, key products/services
   - Business model sustainability and scalability

2. **MOATS** (bullet points)
   - Identify 3-5 competitive moats (network effects, brand, switching costs, scale, IP, regulatory)
   - Rate strength of each moat (Strong/Moderate/Weak)
   - Explain why each moat is defensible

3. **COMPETITIVE_ADVANTAGES** (2-3 paragraphs)
   - What makes this company better than competitors?
   - Market position, technological edge, operational excellence
   - Competitive landscape and threats

4. **FUNDAMENTALS_SUMMARY** (structured analysis)
   - Revenue growth trajectory and sustainability
   - Profitability metrics (margins, ROIC, ROE)
   - Balance sheet strength (debt levels, cash position)
   - Valuation assessment (P/E, P/S, PEG relative to growth)
   - Capital allocation (buybacks, dividends, M&A)

5. **RISKS** (bullet points)
   - Identify 5-7 key risks (competitive, regulatory, execution, macro, valuation)
   - Rate severity (High/Medium/Low)
   - Explain potential impact

6. **CATALYSTS** (bullet points)
   - Near-term catalysts (next 3-6 months)
   - Medium-term catalysts (6-18 months)
   - Long-term thesis drivers (2+ years)

**Output Format:**
Structure your response with clear section headers. Be thorough but concise. Focus on insights that will be useful for daily trading decisions.`;

    console.log('  🤔 Running Opus deep research (10-20k tokens)...');
    const researchStart = Date.now();
    const research = await claude.deepAnalysis(
      {},
      {},
      news,
      {},
      researchPrompt,
      20000  // 20k token thinking budget for deep research
    );
    const researchDuration = ((Date.now() - researchStart) / 1000).toFixed(1);
    console.log(`  ✅ Research complete (${researchDuration}s)`);

    // Parse Opus response into structured profile
    const profile = parseResearchIntoProfile(symbol, research.analysis, fundamentals);

    // Save to database
    console.log('  💾 Saving profile to database...');
    await saveStockProfile(profile);

    console.log(`✅ Profile for ${symbol} complete`);
    return profile;

  } catch (error) {
    console.error(`❌ Error building profile for ${symbol}:`, error.message);
    throw error;
  }
}

/**
 * Parse Opus research response into structured profile
 */
function parseResearchIntoProfile(symbol, researchText, fundamentals) {
  // Extract sections using regex patterns
  const businessModelMatch = researchText.match(/\*\*BUSINESS_MODEL\*\*\s*\n([\s\S]*?)(?=\n\*\*MOATS\*\*|\n\*\*COMPETITIVE|$)/i);
  const moatsMatch = researchText.match(/\*\*MOATS\*\*\s*\n([\s\S]*?)(?=\n\*\*COMPETITIVE|$)/i);
  const competitiveMatch = researchText.match(/\*\*COMPETITIVE_ADVANTAGES\*\*\s*\n([\s\S]*?)(?=\n\*\*FUNDAMENTALS|$)/i);
  const risksMatch = researchText.match(/\*\*RISKS\*\*\s*\n([\s\S]*?)(?=\n\*\*CATALYSTS|$)/i);
  const catalystsMatch = researchText.match(/\*\*CATALYSTS\*\*\s*\n([\s\S]*?)$/i);

  return {
    symbol,
    business_model: businessModelMatch ? businessModelMatch[1].trim() : researchText.substring(0, 1000),
    moats: moatsMatch ? moatsMatch[1].trim() : 'See full research',
    competitive_advantages: competitiveMatch ? competitiveMatch[1].trim() : 'See full research',
    fundamentals: fundamentals || {},
    risks: risksMatch ? risksMatch[1].trim() : 'See full research',
    catalysts: catalystsMatch ? catalystsMatch[1].trim() : 'See full research',
    profile_version: 1
  };
}

/**
 * Run biweekly deep research on watchlist stocks
 */
export async function runBiweeklyDeepResearch() {
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('🔬 BIWEEKLY DEEP STOCK RESEARCH');
  console.log('═══════════════════════════════════════');
  console.log('');

  try {
    // Get watchlist stocks
    const watchlist = await db.getWatchlist();
    console.log(`📋 Found ${watchlist.length} stocks in watchlist`);

    if (watchlist.length === 0) {
      console.log('ℹ️  No stocks in watchlist, skipping deep research');
      return;
    }

    // Get stale profiles (>14 days old)
    const staleProfiles = await getStaleProfiles(14);
    console.log(`⏰ Found ${staleProfiles.length} stale profiles (>14 days old)`);

    // Prioritize: stale profiles first, then new watchlist stocks
    const staleSymbols = staleProfiles.map(p => p.symbol);
    const watchlistSymbols = watchlist.map(w => w.symbol);
    const newSymbols = watchlistSymbols.filter(s => !staleSymbols.includes(s));

    const symbolsToResearch = [...staleSymbols, ...newSymbols].slice(0, 10);  // Limit to 10 per run

    console.log(`🎯 Researching ${symbolsToResearch.length} stocks:`);
    console.log(`   - ${staleSymbols.length} stale profiles to refresh`);
    console.log(`   - ${newSymbols.length} new stocks to profile`);
    console.log('');

    // Build profiles sequentially (each takes 2-3 minutes)
    const results = [];
    for (const symbol of symbolsToResearch) {
      try {
        const profile = await buildStockProfile(symbol);
        results.push({ symbol, success: true, profile });
      } catch (error) {
        console.error(`❌ Failed to build profile for ${symbol}:`, error.message);
        results.push({ symbol, success: false, error: error.message });
      }
    }

    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('✅ BIWEEKLY RESEARCH COMPLETE');
    console.log('═══════════════════════════════════════');
    console.log(`Successful: ${results.filter(r => r.success).length}/${results.length}`);
    console.log(`Failed: ${results.filter(r => !r.success).length}/${results.length}`);
    console.log('');

    return results;

  } catch (error) {
    console.error('❌ Error in biweekly deep research:', error);
    throw error;
  }
}

export default {
  saveStockProfile,
  getStockProfile,
  getStockProfiles,
  getStaleProfiles,
  buildStockProfile,
  runBiweeklyDeepResearch
};
