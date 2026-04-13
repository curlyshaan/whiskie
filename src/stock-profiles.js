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
 * Check if stock meets quality criteria for profile building
 * Filters out penny stocks, low volume, and low market cap
 */
function checkStockQuality(symbol, fundamentals) {
  // Check market cap (minimum $500M for both long and short)
  const marketCap = fundamentals?.marketCap || 0;
  if (marketCap < 500000000) {
    return { passesFilter: false, reason: `Market cap too low: $${(marketCap / 1000000).toFixed(0)}M (min $500M)` };
  }

  // Check price (no penny stocks - minimum $5)
  const price = fundamentals?.price || 0;
  if (price < 5) {
    return { passesFilter: false, reason: `Price too low: $${price.toFixed(2)} (min $5)` };
  }

  // Check average volume (minimum 500k shares/day)
  const avgVolume = fundamentals?.avgVolume || 0;
  if (avgVolume < 500000) {
    return { passesFilter: false, reason: `Volume too low: ${(avgVolume / 1000).toFixed(0)}k shares/day (min 500k)` };
  }

  return { passesFilter: true };
}

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
 * Checks for existing profile and does incremental update if fresh
 */
export async function buildStockProfile(symbol) {
  console.log(`\n🔬 Building profile for ${symbol}...`);

  try {
    // Check if profile already exists
    const existingProfile = await getStockProfile(symbol);

    // Check if stock should be skipped
    if (existingProfile && existingProfile.quality_flag !== 'active') {
      console.log(`  ⏭️  Skipping ${symbol} - marked as ${existingProfile.quality_flag}: ${existingProfile.skip_reason}`);
      return { symbol, skipped: true, reason: existingProfile.skip_reason };
    }

    if (existingProfile) {
      const daysOld = Math.floor((Date.now() - new Date(existingProfile.last_updated).getTime()) / (1000 * 60 * 60 * 24));

      // If profile is fresh (<14 days), do incremental update (5k tokens)
      if (daysOld < 14) {
        console.log(`  ✅ Profile exists and is fresh (${daysOld} days old)`);
        console.log(`  🔄 Running incremental update (5k tokens)...`);
        return await updateStockProfile(symbol, existingProfile);
      } else {
        console.log(`  ⚠️ Profile exists but is stale (${daysOld} days old)`);
        console.log(`  🔬 Running full rebuild (20k tokens)...`);
      }
    } else {
      console.log(`  🆕 No existing profile found`);
      console.log(`  🔬 Running full deep research (20k tokens)...`);
    }

    // Fetch comprehensive data from multiple sources
    console.log('  📊 Fetching fundamentals from FMP...');
    const fundamentals = await fmp.getFundamentals(symbol);

    // Quality check: filter out low-quality stocks
    const qualityCheck = checkStockQuality(symbol, fundamentals);
    if (!qualityCheck.passesFilter) {
      console.log(`  ⚠️  Stock failed quality check: ${qualityCheck.reason}`);
      // Save profile with skip flag
      await db.query(
        `INSERT INTO stock_profiles (symbol, quality_flag, skip_reason, last_updated)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (symbol) DO UPDATE SET
           quality_flag = $2,
           skip_reason = $3,
           last_updated = NOW()`,
        [symbol, 'low_quality', qualityCheck.reason]
      );
      return { symbol, skipped: true, reason: qualityCheck.reason };
    }

    console.log('  📊 Fetching fundamentals from FMP...');

    console.log('  📈 Fetching historical data...');
    const historicalData = await yahooFinance.getHistoricalData(
      symbol,
      new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
      new Date()
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
 * Incremental update for existing profile (5k tokens)
 */
async function updateStockProfile(symbol, existingProfile) {
  try {
    // Fetch latest fundamentals and news
    console.log('  📊 Fetching latest fundamentals...');
    const fundamentals = await fmp.getFundamentals(symbol);

    console.log('  📰 Fetching recent news...');
    const news = await tavily.search(`${symbol} stock news earnings catalyst`, 3);

    // Build incremental update prompt
    const updatePrompt = `Update the stock profile for ${symbol} with latest information.

**EXISTING PROFILE (${Math.floor((Date.now() - new Date(existingProfile.last_updated).getTime()) / (1000 * 60 * 60 * 24))} days old):**

Business Model: ${existingProfile.business_model?.substring(0, 300)}...
Moats: ${existingProfile.moats?.substring(0, 200)}...
Risks: ${existingProfile.risks?.substring(0, 200)}...
Catalysts: ${existingProfile.catalysts?.substring(0, 200)}...

**LATEST FUNDAMENTALS:**
${JSON.stringify(fundamentals, null, 2)}

**RECENT NEWS:**
${news.map(n => `- ${n.title}\n  ${n.content?.substring(0, 150)}...`).join('\n\n')}

**Your Task:** Provide ONLY updates to the profile. Focus on:
1. **CATALYSTS_UPDATE**: Any new catalysts or changes to existing ones
2. **RISKS_UPDATE**: New risks or changes to risk severity
3. **FUNDAMENTALS_UPDATE**: Material changes in financial metrics
4. **BUSINESS_UPDATE**: Any strategic shifts or business model changes

If nothing material has changed in a section, write "No material changes."

Keep it concise - this is an incremental update, not a full rebuild.`;

    console.log('  🤔 Running Opus incremental update (5k tokens)...');
    const updateStart = Date.now();
    const update = await claude.deepAnalysis(
      {},
      {},
      news,
      {},
      updatePrompt,
      5000  // 5k token thinking budget for incremental update
    );
    const updateDuration = ((Date.now() - updateStart) / 1000).toFixed(1);
    console.log(`  ✅ Update complete (${updateDuration}s)`);

    // Merge updates with existing profile
    const updatedProfile = {
      symbol,
      business_model: existingProfile.business_model,
      moats: existingProfile.moats,
      competitive_advantages: existingProfile.competitive_advantages,
      fundamentals: fundamentals || existingProfile.fundamentals,
      risks: update.analysis.includes('RISKS_UPDATE') ?
        update.analysis.match(/RISKS_UPDATE[:\s]*([\s\S]*?)(?=\n\n[A-Z_]+UPDATE|$)/)?.[1]?.trim() || existingProfile.risks :
        existingProfile.risks,
      catalysts: update.analysis.includes('CATALYSTS_UPDATE') ?
        update.analysis.match(/CATALYSTS_UPDATE[:\s]*([\s\S]*?)(?=\n\n[A-Z_]+UPDATE|$)/)?.[1]?.trim() || existingProfile.catalysts :
        existingProfile.catalysts,
      profile_version: (existingProfile.profile_version || 1) + 1
    };

    // Save updated profile
    console.log('  💾 Saving updated profile...');
    await saveStockProfile(updatedProfile);

    console.log(`✅ Incremental update for ${symbol} complete (saved 15k tokens vs full rebuild)`);
    return updatedProfile;

  } catch (error) {
    console.error(`❌ Error updating profile for ${symbol}:`, error.message);
    throw error;
  }
}

/**
 * Parse Opus research response into structured profile
 */
function parseResearchIntoProfile(symbol, researchText, fundamentals) {
  // Try both markdown headers (## SECTION) and bold headers (**SECTION**)
  const businessModelMatch = researchText.match(/(?:##\s*BUSINESS_MODEL|\*\*BUSINESS_MODEL\*\*)\s*\n([\s\S]*?)(?=\n(?:##|\*\*)(?:MOATS|COMPETITIVE)|$)/i);
  const moatsMatch = researchText.match(/(?:##\s*MOATS|\*\*MOATS\*\*)\s*\n([\s\S]*?)(?=\n(?:##|\*\*)COMPETITIVE|$)/i);
  const competitiveMatch = researchText.match(/(?:##\s*COMPETITIVE_ADVANTAGES|\*\*COMPETITIVE_ADVANTAGES\*\*)\s*\n([\s\S]*?)(?=\n(?:##|\*\*)(?:FUNDAMENTALS|RISKS)|$)/i);
  const risksMatch = researchText.match(/(?:##\s*RISKS|\*\*RISKS\*\*)\s*\n([\s\S]*?)(?=\n(?:##|\*\*)CATALYSTS|$)/i);
  const catalystsMatch = researchText.match(/(?:##\s*CATALYSTS|\*\*CATALYSTS\*\*)\s*\n([\s\S]*?)$/i);

  // Try to parse catalysts as JSON if it looks like JSON
  let catalystsData = null;
  if (catalystsMatch) {
    const catalystsText = catalystsMatch[1].trim();
    try {
      // Check if it looks like JSON
      if (catalystsText.startsWith('{') || catalystsText.startsWith('[')) {
        catalystsData = JSON.parse(catalystsText);
      }
    } catch (e) {
      // Not JSON, will store as text
    }
  }

  return {
    symbol,
    business_model: businessModelMatch ? businessModelMatch[1].trim() : researchText.substring(0, 1000),
    moats: moatsMatch ? moatsMatch[1].trim() : 'See full research',
    competitive_advantages: competitiveMatch ? competitiveMatch[1].trim() : 'See full research',
    valuation_assessment: 'To be determined', // Will be filled by Opus in future updates
    fundamentals: fundamentals || {},
    risks: risksMatch ? risksMatch[1].trim() : 'See full research',
    catalysts: catalystsData,
    catalysts_raw: catalystsMatch ? catalystsMatch[1].trim() : 'See full research',
    investment_thesis: businessModelMatch ? businessModelMatch[1].trim().substring(0, 500) : 'See full research',
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
    // Get stocks from ALL watchlists
    const mainWatchlist = await db.getWatchlist();
    const saturdayWatchlist = await db.query('SELECT DISTINCT symbol FROM saturday_watchlist WHERE status = $1', ['active']);

    // Combine all watchlists and deduplicate
    const allSymbols = new Set([
      ...mainWatchlist.map(w => w.symbol),
      ...saturdayWatchlist.rows.map(w => w.symbol)
    ]);

    const watchlistSymbols = Array.from(allSymbols);

    console.log(`📋 Found ${watchlistSymbols.length} unique stocks across all watchlists:`);
    console.log(`   - Main watchlist: ${mainWatchlist.length}`);
    console.log(`   - Saturday watchlist: ${saturdayWatchlist.rows.length}`);

    if (watchlistSymbols.length === 0) {
      console.log('ℹ️  No stocks in any watchlist, skipping deep research');
      return;
    }

    // Get stale profiles (>14 days old)
    const staleProfiles = await getStaleProfiles(14);
    console.log(`⏰ Found ${staleProfiles.length} stale profiles (>14 days old)`);

    // Prioritize: stale profiles first, then new watchlist stocks
    const staleSymbols = staleProfiles.map(p => p.symbol);
    const newSymbols = watchlistSymbols.filter(s => !staleSymbols.includes(s));

    const symbolsToResearch = [...staleSymbols, ...newSymbols].slice(0, 50);  // Increased limit to 50 per run

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

/**
 * Build profiles for a batch of stocks from stock_universe
 * Used for systematic coverage of all 400 stocks
 */
export async function buildProfileBatch(batchNumber, batchSize = 50) {
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log(`📚 BATCH PROFILE BUILD #${batchNumber}`);
  console.log('═══════════════════════════════════════');
  console.log('');

  try {
    // Get all active stocks from stock_universe
    const allStocks = await db.query(
      `SELECT symbol FROM stock_universe
       WHERE status = 'active'
       ORDER BY symbol`
    );

    const totalStocks = allStocks.rows.length;
    const offset = (batchNumber - 1) * batchSize;
    const batchStocks = allStocks.rows.slice(offset, offset + batchSize);

    console.log(`📊 Total stocks in universe: ${totalStocks}`);
    console.log(`📦 Batch ${batchNumber}: Processing stocks ${offset + 1}-${Math.min(offset + batchSize, totalStocks)}`);
    console.log(`🎯 Stocks in this batch: ${batchStocks.length}`);
    console.log('');

    if (batchStocks.length === 0) {
      console.log('ℹ️  No stocks in this batch');
      return { batchNumber, processed: 0, successful: 0, skipped: 0, failed: 0 };
    }

    // Build profiles sequentially
    const results = [];
    let successful = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < batchStocks.length; i++) {
      const symbol = batchStocks[i].symbol;
      console.log(`\n[${i + 1}/${batchStocks.length}] Processing ${symbol}...`);

      try {
        const result = await buildStockProfile(symbol);

        if (result.skipped) {
          skipped++;
          console.log(`  ⏭️  Skipped: ${result.reason}`);
        } else {
          successful++;
          console.log(`  ✅ Profile saved`);
        }

        results.push({ symbol, success: true, result });
      } catch (error) {
        failed++;
        console.error(`  ❌ Failed: ${error.message}`);
        results.push({ symbol, success: false, error: error.message });
      }
    }

    console.log('');
    console.log('═══════════════════════════════════════');
    console.log(`✅ BATCH ${batchNumber} COMPLETE`);
    console.log('═══════════════════════════════════════');
    console.log(`Processed: ${batchStocks.length}`);
    console.log(`Successful: ${successful}`);
    console.log(`Skipped (low quality): ${skipped}`);
    console.log(`Failed: ${failed}`);
    console.log('');

    return {
      batchNumber,
      processed: batchStocks.length,
      successful,
      skipped,
      failed,
      results
    };

  } catch (error) {
    console.error(`❌ Error in batch ${batchNumber}:`, error);
    throw error;
  }
}

export default {
  saveStockProfile,
  getStockProfile,
  getStockProfiles,
  getStaleProfiles,
  buildStockProfile,
  runBiweeklyDeepResearch,
  buildProfileBatch
};
