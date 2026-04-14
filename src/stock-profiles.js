import * as db from './db.js';
import claude from './claude.js';
import fmp from './fmp.js';
import tradier from './tradier.js';
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
        symbol, business_model, moats, competitive_advantages, competitive_landscape,
        management_quality, valuation_framework, fundamentals, risks, catalysts,
        industry_sector, market_cap_category, growth_stage,
        insider_ownership_pct, institutional_ownership_pct,
        last_earnings_date, next_earnings_date, key_metrics_to_watch,
        last_updated, profile_version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP, $19)
      ON CONFLICT (symbol)
      DO UPDATE SET
        business_model = $2,
        moats = $3,
        competitive_advantages = $4,
        competitive_landscape = $5,
        management_quality = $6,
        valuation_framework = $7,
        fundamentals = $8,
        risks = $9,
        catalysts = $10,
        industry_sector = $11,
        market_cap_category = $12,
        growth_stage = $13,
        insider_ownership_pct = $14,
        institutional_ownership_pct = $15,
        last_earnings_date = $16,
        next_earnings_date = $17,
        key_metrics_to_watch = $18,
        last_updated = CURRENT_TIMESTAMP,
        profile_version = stock_profiles.profile_version + 1
      RETURNING *`,
      [
        profile.symbol,
        profile.business_model,
        profile.moats,
        profile.competitive_advantages,
        profile.competitive_landscape,
        profile.management_quality,
        profile.valuation_framework,
        JSON.stringify(profile.fundamentals || {}),
        profile.risks,
        profile.catalysts,
        profile.industry_sector,
        profile.market_cap_category,
        profile.growth_stage,
        profile.insider_ownership_pct,
        profile.institutional_ownership_pct,
        profile.last_earnings_date,
        profile.next_earnings_date,
        profile.key_metrics_to_watch ? JSON.stringify(profile.key_metrics_to_watch) : null,
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
    const formatDate = (date) => date.toISOString().split('T')[0];
    const historicalData = await tradier.getHistory(
      symbol,
      'daily',
      formatDate(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)),
      formatDate(new Date())
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

**Your Task:** Create a comprehensive stock profile with the following sections. CRITICAL: Stay within character limits for each section.

1. **BUSINESS_MODEL** (MAX 1500 chars)
   - What does the company do? How do they make money?
   - Revenue streams, customer segments, key products/services
   - Business model sustainability and scalability

2. **MOATS** (MAX 1200 chars)
   - Identify 3-5 competitive moats (network effects, brand, switching costs, scale, IP, regulatory)
   - Rate strength of each moat (Strong/Moderate/Weak)
   - Explain why each moat is defensible

3. **COMPETITIVE_ADVANTAGES** (MAX 1000 chars)
   - What makes this company better than competitors?
   - Market position, technological edge, operational excellence

4. **COMPETITIVE_LANDSCAPE** (MAX 1000 chars)
   - Top 3-5 competitors and market share
   - Pricing dynamics and competitive threats
   - Industry structure and barriers to entry

5. **MANAGEMENT_QUALITY** (MAX 800 chars)
   - Capital allocation track record (buybacks, dividends, M&A)
   - Insider ownership percentage
   - Execution history and strategic vision

6. **VALUATION_FRAMEWORK** (MAX 1000 chars)
   - Primary valuation method (DCF, P/E, EV/EBITDA, etc.)
   - Key multiples vs peers and historical average
   - Normalized earnings and growth assumptions

7. **FUNDAMENTALS_SUMMARY** (structured analysis)
   - Revenue growth trajectory and sustainability
   - Profitability metrics (margins, ROIC, ROE)
   - Balance sheet strength (debt levels, cash position)
   - Capital allocation (buybacks, dividends, M&A)

8. **RISKS** (MAX 1500 chars)
   - Identify 5-7 key risks (competitive, regulatory, execution, macro, valuation)
   - Rate severity (High/Medium/Low)
   - Explain potential impact

9. **CATALYSTS** (MAX 1200 chars)
   - Near-term catalysts (next 3-6 months)
   - Medium-term catalysts (6-18 months)
   - Long-term thesis drivers (2+ years)

10. **METADATA** (REQUIRED - use exact format below)

   Industry sector: [e.g., "Technology - Software", "Healthcare - Biotech"]
   Market cap category: [mega/large/mid/small based on: mega >$200B, large $10-200B, mid $2-10B, small <$2B]
   Growth stage: [hyper_growth/growth/mature/turnaround/declining]
   Insider ownership: [X.X%]
   Institutional ownership: [X.X%]
   Last earnings date: [YYYY-MM-DD or "N/A"]
   Next earnings date: [YYYY-MM-DD or "N/A"]
   Key metrics: {"primary": ["revenue_growth", "operating_margin"], "thresholds": {"revenue_growth": {"concern": 0.10, "target": 0.20}}}

**Output Format:**
Structure your response with clear section headers. STAY WITHIN CHARACTER LIMITS. The METADATA section is REQUIRED and must use the exact format shown above. Be thorough but concise. Focus on insights that will be useful for daily trading decisions.`;

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

    // Merge updates with existing profile (apply cleanText to enforce character limits)
    const updatedProfile = {
      symbol,
      business_model: existingProfile.business_model,
      moats: existingProfile.moats,
      competitive_advantages: existingProfile.competitive_advantages,
      competitive_landscape: existingProfile.competitive_landscape,
      management_quality: existingProfile.management_quality,
      valuation_framework: existingProfile.valuation_framework,
      fundamentals: fundamentals || existingProfile.fundamentals,
      risks: update.analysis.includes('RISKS_UPDATE') ?
        cleanText(update.analysis.match(/RISKS_UPDATE[:\s]*([\s\S]*?)(?=\n\n[A-Z_]+UPDATE|$)/)?.[1]?.trim() || existingProfile.risks, 1500) :
        existingProfile.risks,
      catalysts: update.analysis.includes('CATALYSTS_UPDATE') ?
        cleanText(update.analysis.match(/CATALYSTS_UPDATE[:\s]*([\s\S]*?)(?=\n\n[A-Z_]+UPDATE|$)/)?.[1]?.trim() || existingProfile.catalysts, 1200) :
        existingProfile.catalysts,
      industry_sector: existingProfile.industry_sector,
      market_cap_category: existingProfile.market_cap_category,
      growth_stage: existingProfile.growth_stage,
      insider_ownership_pct: existingProfile.insider_ownership_pct,
      institutional_ownership_pct: existingProfile.institutional_ownership_pct,
      last_earnings_date: existingProfile.last_earnings_date,
      next_earnings_date: existingProfile.next_earnings_date,
      key_metrics_to_watch: existingProfile.key_metrics_to_watch,
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
 * Clean text by removing markdown formatting and limiting length
 */
function cleanText(text, maxChars = 2000) {
  if (!text) return '';

  // Remove markdown headers (## or **)
  let cleaned = text.replace(/^#+\s+/gm, '');
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');

  // Remove bullet point markers but keep the text
  cleaned = cleaned.replace(/^[\s]*[-*•]\s+/gm, '');

  // Remove extra whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.trim();

  // Limit length
  if (cleaned.length > maxChars) {
    cleaned = cleaned.substring(0, maxChars).trim();
    // Try to end at a sentence
    const lastPeriod = cleaned.lastIndexOf('.');
    if (lastPeriod > maxChars * 0.8) {
      cleaned = cleaned.substring(0, lastPeriod + 1);
    }
  }

  return cleaned;
}

/**
 * Parse Opus research response into structured profile
 */
function parseResearchIntoProfile(symbol, researchText, fundamentals) {
  // More flexible regex patterns - handle variations in header formatting
  const businessModelMatch = researchText.match(/(?:##\s*(?:BUSINESS[_\s]MODEL|Business\s+Model)|\*\*(?:BUSINESS[_\s]MODEL|Business\s+Model)\*\*)[:\s]*\n([\s\S]*?)(?=\n(?:##|\*\*)(?:MOATS?|Moats?|COMPETITIVE|Competitive)|$)/i);
  const moatsMatch = researchText.match(/(?:##\s*(?:MOATS?|Moats?)|\*\*(?:MOATS?|Moats?)\*\*)[:\s]*\n([\s\S]*?)(?=\n(?:##|\*\*)(?:COMPETITIVE|Competitive)|$)/i);
  const competitiveAdvMatch = researchText.match(/(?:##\s*(?:COMPETITIVE[_\s]ADVANTAGES?|Competitive\s+Advantages?)|\*\*(?:COMPETITIVE[_\s]ADVANTAGES?|Competitive\s+Advantages?)\*\*)[:\s]*\n([\s\S]*?)(?=\n(?:##|\*\*)(?:COMPETITIVE[_\s]LANDSCAPE|Competitive\s+Landscape|MANAGEMENT|Management|VALUATION|Valuation|FUNDAMENTALS?|Fundamentals?|RISKS?|Risks?)|$)/i);
  const competitiveLandscapeMatch = researchText.match(/(?:##\s*(?:COMPETITIVE[_\s]LANDSCAPE|Competitive\s+Landscape)|\*\*(?:COMPETITIVE[_\s]LANDSCAPE|Competitive\s+Landscape)\*\*)[:\s]*\n([\s\S]*?)(?=\n(?:##|\*\*)(?:MANAGEMENT|Management|VALUATION|Valuation|FUNDAMENTALS?|Fundamentals?|RISKS?|Risks?)|$)/i);
  const managementMatch = researchText.match(/(?:##\s*(?:MANAGEMENT[_\s]QUALITY|Management\s+Quality)|\*\*(?:MANAGEMENT[_\s]QUALITY|Management\s+Quality)\*\*)[:\s]*\n([\s\S]*?)(?=\n(?:##|\*\*)(?:VALUATION|Valuation|FUNDAMENTALS?|Fundamentals?|RISKS?|Risks?)|$)/i);
  const valuationMatch = researchText.match(/(?:##\s*(?:VALUATION[_\s]FRAMEWORK|Valuation\s+Framework)|\*\*(?:VALUATION[_\s]FRAMEWORK|Valuation\s+Framework)\*\*)[:\s]*\n([\s\S]*?)(?=\n(?:##|\*\*)(?:FUNDAMENTALS?|Fundamentals?|RISKS?|Risks?)|$)/i);
  const risksMatch = researchText.match(/(?:##\s*(?:RISKS?|Risks?)|\*\*(?:RISKS?|Risks?)\*\*)[:\s]*\n([\s\S]*?)(?=\n(?:##|\*\*)(?:CATALYSTS?|Catalysts?|METADATA|Metadata)|$)/i);
  const catalystsMatch = researchText.match(/(?:##\s*(?:CATALYSTS?|Catalysts?)|\*\*(?:CATALYSTS?|Catalysts?)\*\*)[:\s]*\n([\s\S]*?)(?=\n(?:##|\*\*)(?:METADATA|Metadata)|$)/i);
  const metadataMatch = researchText.match(/(?:##\s*(?:METADATA|Metadata)|\*\*(?:METADATA|Metadata)\*\*)[:\s]*\n([\s\S]*?)$/i);

  // Parse metadata section
  let industrySector = null;
  let marketCapCategory = null;
  let growthStage = null;
  let insiderOwnership = null;
  let institutionalOwnership = null;
  let lastEarningsDate = null;
  let nextEarningsDate = null;
  let keyMetrics = null;

  if (metadataMatch) {
    const metadata = metadataMatch[1];

    const sectorMatch = metadata.match(/Industry\s+sector[:\s]+([^\n]+)/i);
    if (sectorMatch) industrySector = sectorMatch[1].trim();

    const marketCapMatch = metadata.match(/Market\s+cap\s+category[:\s]+(mega|large|mid|small)/i);
    if (marketCapMatch) marketCapCategory = marketCapMatch[1].toLowerCase();

    const growthMatch = metadata.match(/Growth\s+stage[:\s]+(hyper_growth|growth|mature|turnaround|declining)/i);
    if (growthMatch) growthStage = growthMatch[1].toLowerCase();

    const insiderMatch = metadata.match(/Insider\s+ownership[:\s]+(\d+(?:\.\d+)?)/i);
    if (insiderMatch) insiderOwnership = parseFloat(insiderMatch[1]);

    const institutionalMatch = metadata.match(/Institutional\s+ownership[:\s]+(\d+(?:\.\d+)?)/i);
    if (institutionalMatch) institutionalOwnership = parseFloat(institutionalMatch[1]);

    const lastEarningsMatch = metadata.match(/Last\s+earnings\s+date[:\s]+(\d{4}-\d{2}-\d{2})/i);
    if (lastEarningsMatch) lastEarningsDate = lastEarningsMatch[1];

    const nextEarningsMatch = metadata.match(/Next\s+earnings\s+date[:\s]+(\d{4}-\d{2}-\d{2})/i);
    if (nextEarningsMatch) nextEarningsDate = nextEarningsMatch[1];

    const metricsMatch = metadata.match(/Key\s+metrics[:\s]+(\{[\s\S]*?\})/i);
    if (metricsMatch) {
      try {
        keyMetrics = JSON.parse(metricsMatch[1]);
      } catch (e) {
        console.warn('Failed to parse key_metrics JSON:', e.message);
      }
    }
  }

  // Fallback: derive metadata from fundamentals if not provided by Opus
  if (!marketCapCategory && fundamentals?.marketCap) {
    const marketCap = fundamentals.marketCap;
    if (marketCap > 200000000000) marketCapCategory = 'mega';
    else if (marketCap > 10000000000) marketCapCategory = 'large';
    else if (marketCap > 2000000000) marketCapCategory = 'mid';
    else marketCapCategory = 'small';
  }

  if (!industrySector && fundamentals?.sector && fundamentals?.industry) {
    industrySector = `${fundamentals.sector} - ${fundamentals.industry}`;
  }

  return {
    symbol,
    business_model: cleanText(businessModelMatch ? businessModelMatch[1] : researchText.substring(0, 1000), 1500),
    moats: cleanText(moatsMatch ? moatsMatch[1] : '', 1200),
    competitive_advantages: cleanText(competitiveAdvMatch ? competitiveAdvMatch[1] : '', 1000),
    competitive_landscape: cleanText(competitiveLandscapeMatch ? competitiveLandscapeMatch[1] : '', 1000),
    management_quality: cleanText(managementMatch ? managementMatch[1] : '', 800),
    valuation_framework: cleanText(valuationMatch ? valuationMatch[1] : '', 1000),
    fundamentals: fundamentals || {},
    risks: cleanText(risksMatch ? risksMatch[1] : '', 1500),
    catalysts: cleanText(catalystsMatch ? catalystsMatch[1] : '', 1200),
    industry_sector: industrySector,
    market_cap_category: marketCapCategory,
    growth_stage: growthStage,
    insider_ownership_pct: insiderOwnership,
    institutional_ownership_pct: institutionalOwnership,
    last_earnings_date: lastEarningsDate,
    next_earnings_date: nextEarningsDate,
    key_metrics_to_watch: keyMetrics,
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
