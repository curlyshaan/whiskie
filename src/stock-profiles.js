import * as db from './db.js';
import claude, { MODELS } from './claude.js';
import fmp from './fmp.js';
import tradier from './tradier.js';
import newsSearch from './news-search.js';

const profileBuildControllers = new Map();

class ProfileBuildCancelledError extends Error {
  constructor(symbol) {
    super(`Profile build cancelled for ${symbol}`);
    this.name = 'ProfileBuildCancelledError';
    this.symbol = symbol;
  }
}

function getProfileBuildController(symbol) {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  if (!profileBuildControllers.has(normalizedSymbol)) {
    profileBuildControllers.set(normalizedSymbol, { cancelled: false });
  }
  return profileBuildControllers.get(normalizedSymbol);
}

function clearProfileBuildController(symbol) {
  profileBuildControllers.delete(String(symbol || '').trim().toUpperCase());
}

export function cancelProfileBuild(symbol) {
  const controller = profileBuildControllers.get(String(symbol || '').trim().toUpperCase());
  if (!controller) return false;
  controller.cancelled = true;
  return true;
}

export function isProfileBuildCancelled(symbol) {
  return Boolean(profileBuildControllers.get(String(symbol || '').trim().toUpperCase())?.cancelled);
}

function throwIfProfileBuildCancelled(symbol) {
  if (isProfileBuildCancelled(symbol)) {
    throw new ProfileBuildCancelledError(symbol);
  }
}

function createProfileTimer(symbol, phase = 'full') {
  const startedAt = Date.now();
  let lastStepAt = startedAt;

  return {
    step(stepName) {
      const now = Date.now();
      const elapsedSeconds = ((now - lastStepAt) / 1000).toFixed(1);
      const totalSeconds = ((now - startedAt) / 1000).toFixed(1);
      console.log(`  ⏱️ [${symbol}] ${phase}:${stepName} took ${elapsedSeconds}s (total ${totalSeconds}s)`);
      lastStepAt = now;
    },
    finish(label = 'complete') {
      const totalSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`  🏁 [${symbol}] ${phase}:${label} total ${totalSeconds}s`);
    }
  };
}

function buildProfileContext(symbol, fundamentals, historicalData, news) {
  return `Build a detailed stock profile for ${symbol} using the data below.

**Fundamentals (FMP):**
${JSON.stringify(fundamentals, null, 2)}

**Price History (1 year):**
- Current: $${historicalData[historicalData.length - 1]?.close || 'N/A'}
- 52-week high: $${Math.max(...historicalData.map(d => d.high)).toFixed(2)}
- 52-week low: $${Math.min(...historicalData.map(d => d.low)).toFixed(2)}
- YTD return: ${(((historicalData[historicalData.length - 1]?.close - historicalData[0]?.close) / historicalData[0]?.close) * 100).toFixed(1)}%

**Recent News:**
${news.map(n => `- ${n.title}\n  ${n.content?.substring(0, 200)}...`).join('\n\n')}`;
}

async function generateProfileSections(symbol, contextPrompt, timer) {
  const sectionCalls = [
    {
      name: 'core-business',
      maxTokens: 9000,
      prompt: `${contextPrompt}

Return only these sections with exact headers:

BUSINESS_MODEL
MOATS
COMPETITIVE_ADVANTAGES

Requirements:
- Keep each section under 2000 characters
- Be concise and decision-useful
- For MOATS, identify 3-5 moats, rate each Strong/Moderate/Weak, and explain why`
    },
    {
      name: 'competition-management',
      maxTokens: 9000,
      prompt: `${contextPrompt}

Return only these sections with exact headers:

COMPETITIVE_LANDSCAPE
MANAGEMENT_QUALITY
VALUATION_FRAMEWORK

Requirements:
- Keep each section under 2000 characters
- Be concise and decision-useful
- Include top competitors, management capital allocation, and valuation lens`
    },
    {
      name: 'risks-catalysts-metadata',
      maxTokens: 9000,
      prompt: `${contextPrompt}

Return only these sections with exact headers:

FUNDAMENTALS_SUMMARY
RISKS
CATALYSTS
METADATA

Requirements:
- Keep FUNDAMENTALS_SUMMARY, RISKS, and CATALYSTS under 2000 characters each
- METADATA must use this exact format:
Industry sector: [text]
Market cap category: [mega/large/mid/small]
Growth stage: [hyper_growth/growth/mature/turnaround/declining]
Insider ownership: [X.X%]
Institutional ownership: [X.X%]
Last earnings date: [YYYY-MM-DD or "N/A"]
Next earnings date: [YYYY-MM-DD or "N/A"]
Key metrics: {"primary": ["revenue_growth", "operating_margin"], "thresholds": {"revenue_growth": {"concern": 0.10, "target": 0.20}}}`
    }
  ];

  const sectionOutputs = [];

  for (const sectionCall of sectionCalls) {
    throwIfProfileBuildCancelled(symbol);
    console.log(`  🤔 Running Gemini 3.1 Pro profile section: ${sectionCall.name}...`);
    const startedAt = Date.now();
    const response = await claude.sendMessage(
      [{ role: 'user', content: sectionCall.prompt }],
      MODELS.GEMINI_PRO,
      null,
      false,
      20000,
      { maxTokens: sectionCall.maxTokens }
    );
    const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`  ✅ Section ${sectionCall.name} complete (${duration}s)`);
    timer.step(`llm-${sectionCall.name}`);
    const text = response?.content?.map(block => block?.text || '').join('\n').trim() || '';
    sectionOutputs.push(text);
  }

  return sectionOutputs.filter(Boolean).join('\n\n');
}

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
        profile_status, refresh_tier, last_full_refresh_at, last_incremental_refresh_at,
        next_refresh_due, refresh_priority, coverage_score, research_quality,
        facts_last_verified_at, last_catalyst_refresh_at, last_news_refresh_at,
        last_updated, profile_version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, CURRENT_TIMESTAMP, $30)
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
        profile_status = $19,
        refresh_tier = $20,
        last_full_refresh_at = COALESCE($21, stock_profiles.last_full_refresh_at),
        last_incremental_refresh_at = COALESCE($22, stock_profiles.last_incremental_refresh_at),
        next_refresh_due = $23,
        refresh_priority = $24,
        coverage_score = $25,
        research_quality = $26,
        facts_last_verified_at = $27,
        last_catalyst_refresh_at = $28,
        last_news_refresh_at = $28,
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
        profile.profile_status || 'active',
        profile.refresh_tier || 'full',
        profile.last_full_refresh_at || null,
        profile.last_incremental_refresh_at || null,
        profile.next_refresh_due || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        profile.refresh_priority ?? 50,
        profile.coverage_score ?? 80,
        profile.research_quality || 'standard',
        profile.facts_last_verified_at || new Date(),
        profile.last_catalyst_refresh_at || new Date(),
        profile.last_news_refresh_at || new Date(),
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
      `SELECT symbol, last_updated, next_refresh_due, refresh_priority
       FROM stock_profiles
       WHERE COALESCE(next_refresh_due, last_updated + INTERVAL '${daysOld} days') <= NOW()
       ORDER BY refresh_priority DESC, last_updated ASC`,
      []
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching stale profiles:', error);
    return [];
  }
}

export function getProfileFreshness(profile, staleAfterDays = 14) {
  if (!profile?.last_updated) {
    return {
      hasProfile: false,
      isFresh: false,
      isStale: false,
      daysOld: null,
      staleAfterDays,
      needsBuild: true,
      needsRefresh: false
    };
  }

  const daysOld = Math.floor((Date.now() - new Date(profile.last_updated).getTime()) / (1000 * 60 * 60 * 24));
  const isStale = daysOld >= staleAfterDays;

  return {
    hasProfile: true,
    isFresh: !isStale,
    isStale,
    daysOld,
    staleAfterDays,
    needsBuild: false,
    needsRefresh: isStale
  };
}

export async function ensureFreshStockProfile(symbol, options = {}) {
  const {
    staleAfterDays = 14,
    incrementalRefreshDays = 14
  } = options;

  const existingProfile = await getStockProfile(symbol);
  const freshness = getProfileFreshness(existingProfile, staleAfterDays);

  if (!existingProfile) {
    const profile = await buildStockProfile(symbol, { staleAfterDays: incrementalRefreshDays });
    return { profile, action: 'built', freshness };
  }

  if (freshness.isStale) {
    const profile = await updateStockProfile(symbol, existingProfile, { staleAfterDays: incrementalRefreshDays });
    return { profile, action: 'refreshed', freshness };
  }

  return { profile: existingProfile, action: 'reused', freshness };
}

/**
 * Build comprehensive stock profile using deep research
 * Checks for existing profile and does incremental update if fresh
 */
export async function buildStockProfile(symbol, options = {}) {
  console.log(`\n🔬 Building profile for ${symbol}...`);
  const timer = createProfileTimer(symbol, 'full');
  const staleAfterDays = options.staleAfterDays ?? 14;
  getProfileBuildController(symbol);

  try {
    throwIfProfileBuildCancelled(symbol);
    // Check if profile already exists
    const existingProfile = await getStockProfile(symbol);
    timer.step('load-existing-profile');
    throwIfProfileBuildCancelled(symbol);

    // Check if stock should be skipped
    if (existingProfile && existingProfile.quality_flag !== 'active') {
      console.log(`  ⏭️  Skipping ${symbol} - marked as ${existingProfile.quality_flag}: ${existingProfile.skip_reason}`);
      return { symbol, skipped: true, reason: existingProfile.skip_reason };
    }

    if (existingProfile) {
      const freshness = getProfileFreshness(existingProfile, staleAfterDays);
      const daysOld = freshness.daysOld ?? 0;

      // If profile is fresh (<14 days), do incremental update (5k tokens)
      if (!freshness.isStale) {
        console.log(`  ✅ Profile exists and is fresh (${daysOld} days old)`);
        console.log(`  🔄 Running incremental update (5k tokens)...`);
        return await updateStockProfile(symbol, existingProfile, { staleAfterDays });
      } else {
        console.log(`  ⚠️ Profile exists but is stale (${daysOld} days old)`);
        console.log(`  🔄 Running incremental refresh before analysis...`);
        return await updateStockProfile(symbol, existingProfile, { staleAfterDays });
      }
    } else {
      console.log(`  🆕 No existing profile found`);
      console.log(`  🔬 Running full deep research (20k tokens)...`);
    }

    // Fetch comprehensive data from multiple sources
    console.log('  📊 Fetching fundamentals from FMP...');
    const fundamentals = await fmp.getFundamentals(symbol);
    timer.step('fetch-fundamentals');
    throwIfProfileBuildCancelled(symbol);

    // Quality check: filter out low-quality stocks
    const qualityCheck = checkStockQuality(symbol, fundamentals);
    if (!qualityCheck.passesFilter) {
      console.log(`  ⚠️  Stock failed quality check: ${qualityCheck.reason}`);
      // Save profile with skip flag
      await db.query(
        `INSERT INTO stock_profiles (symbol, quality_flag, skip_reason, profile_status, refresh_priority, next_refresh_due, last_updated)
         VALUES ($1, $2, $3, 'skipped', 5, NOW() + INTERVAL '30 days', NOW())
         ON CONFLICT (symbol) DO UPDATE SET
           quality_flag = $2,
           skip_reason = $3,
           profile_status = 'skipped',
           refresh_priority = 5,
           next_refresh_due = NOW() + INTERVAL '30 days',
           last_updated = NOW()`,
        [symbol, 'low_quality', qualityCheck.reason]
      );
      return { symbol, skipped: true, reason: qualityCheck.reason };
    }

    console.log('  📈 Fetching historical data from FMP...');
    const formatDate = (date) => date.toISOString().split('T')[0];
    const historicalData = await fmp.getHistoricalPriceEodFull(
      symbol,
      formatDate(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)),
      formatDate(new Date())
    );
    timer.step('fetch-historical-data');
    throwIfProfileBuildCancelled(symbol);

    console.log('  📰 Fetching recent news...');
    const news = await newsSearch.searchStructuredStockContext(symbol, {
      maxResults: 5,
      timeRange: 'month'
    });
    timer.step('fetch-news');
    throwIfProfileBuildCancelled(symbol);

    const profileContext = buildProfileContext(symbol, fundamentals, historicalData, news);
    const researchText = await generateProfileSections(symbol, profileContext, timer);

    // Parse model response into structured profile
    const profile = parseResearchIntoProfile(symbol, researchText, fundamentals);
    timer.step('parse-profile');
    profile.profile_status = 'active';
    profile.refresh_tier = 'full';
    profile.last_full_refresh_at = new Date();
    profile.last_incremental_refresh_at = null;
    profile.next_refresh_due = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    profile.refresh_priority = 50;
    profile.coverage_score = 80;
    profile.research_quality = 'standard';
    profile.facts_last_verified_at = new Date();
    profile.last_catalyst_refresh_at = new Date();
    profile.last_news_refresh_at = new Date();

    // Save to database
    console.log('  💾 Saving profile to database...');
    await saveStockProfile(profile);
    timer.step('save-profile');

    console.log(`✅ Profile for ${symbol} complete`);
    timer.finish();
    return profile;

  } catch (error) {
    timer.finish('failed');
    console.error(`❌ Error building profile for ${symbol}:`, error.message);
    throw error;
  } finally {
    clearProfileBuildController(symbol);
  }
}

/**
 * Incremental update for existing profile (5k tokens)
 */
async function updateStockProfile(symbol, existingProfile = null, options = {}) {
  const timer = createProfileTimer(symbol, 'incremental');
  try {
    getProfileBuildController(symbol);
    throwIfProfileBuildCancelled(symbol);
    const staleAfterDays = options.staleAfterDays ?? 14;
    const profileToUpdate = existingProfile || await getStockProfile(symbol);

    if (!profileToUpdate) {
      timer.step('load-missing-profile');
      console.log(`  🆕 No existing profile available for ${symbol}; falling back to full build...`);
      return await buildStockProfile(symbol, { staleAfterDays });
    }

    // Fetch latest fundamentals and news
    console.log('  📊 Fetching latest fundamentals...');
    const fundamentals = await fmp.getFundamentals(symbol);
    timer.step('fetch-fundamentals');
    throwIfProfileBuildCancelled(symbol);

    console.log('  📰 Fetching recent news...');
    const news = await newsSearch.searchStructuredStockContext(symbol, { maxResults: 3 });
    timer.step('fetch-news');
    throwIfProfileBuildCancelled(symbol);

    // Build incremental update prompt
    const updatePrompt = `Update the stock profile for ${symbol} with latest information.

**EXISTING PROFILE (${Math.floor((Date.now() - new Date(profileToUpdate.last_updated).getTime()) / (1000 * 60 * 60 * 24))} days old):**

Business Model: ${profileToUpdate.business_model?.substring(0, 300)}...
Moats: ${profileToUpdate.moats?.substring(0, 200)}...
Risks: ${profileToUpdate.risks?.substring(0, 200)}...
Catalysts: ${profileToUpdate.catalysts?.substring(0, 200)}...

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

    console.log('  🤔 Running Gemini 3.1 Pro incremental update (5k tokens)...');
    const updateStart = Date.now();
    const update = await claude.sendMessage(
      [{ role: 'user', content: updatePrompt }],
      MODELS.GEMINI_PRO,
      null,
      false,
      5000
    );
    const updateDuration = ((Date.now() - updateStart) / 1000).toFixed(1);
    console.log(`  ✅ Update complete (${updateDuration}s)`);
    timer.step('llm-update');
    throwIfProfileBuildCancelled(symbol);
    const updateText = update?.content?.map(block => block?.text || '').join('\n').trim() || '';

    // Merge updates with existing profile (apply cleanText to enforce character limits)
    const updatedProfile = {
      symbol,
      business_model: profileToUpdate.business_model,
      moats: profileToUpdate.moats,
      competitive_advantages: profileToUpdate.competitive_advantages,
      competitive_landscape: profileToUpdate.competitive_landscape,
      management_quality: profileToUpdate.management_quality,
      valuation_framework: profileToUpdate.valuation_framework,
      fundamentals: fundamentals || profileToUpdate.fundamentals,
      risks: updateText.includes('RISKS_UPDATE') ?
        cleanText(updateText.match(/RISKS_UPDATE[:\s]*([\s\S]*?)(?=\n\n[A-Z_]+UPDATE|$)/)?.[1]?.trim() || profileToUpdate.risks, 2000) :
        profileToUpdate.risks,
      catalysts: updateText.includes('CATALYSTS_UPDATE') ?
        cleanText(updateText.match(/CATALYSTS_UPDATE[:\s]*([\s\S]*?)(?=\n\n[A-Z_]+UPDATE|$)/)?.[1]?.trim() || profileToUpdate.catalysts, 2000) :
        profileToUpdate.catalysts,
      industry_sector: profileToUpdate.industry_sector,
      market_cap_category: profileToUpdate.market_cap_category,
      growth_stage: profileToUpdate.growth_stage,
      insider_ownership_pct: profileToUpdate.insider_ownership_pct,
      institutional_ownership_pct: profileToUpdate.institutional_ownership_pct,
      last_earnings_date: profileToUpdate.last_earnings_date,
      next_earnings_date: profileToUpdate.next_earnings_date,
      key_metrics_to_watch: profileToUpdate.key_metrics_to_watch,
      profile_status: profileToUpdate.profile_status || 'active',
      refresh_tier: 'incremental',
      last_full_refresh_at: profileToUpdate.last_full_refresh_at || profileToUpdate.last_updated || new Date(),
      last_incremental_refresh_at: new Date(),
      next_refresh_due: new Date(Date.now() + staleAfterDays * 24 * 60 * 60 * 1000),
      refresh_priority: profileToUpdate.refresh_priority ?? 50,
      coverage_score: profileToUpdate.coverage_score ?? 80,
      research_quality: profileToUpdate.research_quality || 'standard',
      facts_last_verified_at: new Date(),
      last_catalyst_refresh_at: new Date(),
      last_news_refresh_at: new Date(),
      profile_version: (profileToUpdate.profile_version || 1) + 1
    };

    // Save updated profile
    console.log('  💾 Saving updated profile...');
    await saveStockProfile(updatedProfile);
    timer.step('save-profile');

    console.log(`✅ Incremental update for ${symbol} complete (saved 15k tokens vs full rebuild)`);
    timer.finish();
    return updatedProfile;

  } catch (error) {
    timer.finish('failed');
    console.error(`❌ Error updating profile for ${symbol}:`, error.message);
    throw error;
  } finally {
    clearProfileBuildController(symbol);
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
  cleaned = cleaned.replace(/^\*\*+\s*/, '');
  cleaned = cleaned.replace(/\s*\*\*+$/, '');

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
  const normalized = String(researchText || '').replace(/\r\n/g, '\n');
  const sectionAliases = {
    BUSINESS_MODEL: ['BUSINESS_MODEL', 'Business Model'],
    MOATS: ['MOATS', 'Moats'],
    COMPETITIVE_ADVANTAGES: ['COMPETITIVE_ADVANTAGES', 'Competitive Advantages'],
    COMPETITIVE_LANDSCAPE: ['COMPETITIVE_LANDSCAPE', 'Competitive Landscape'],
    MANAGEMENT_QUALITY: ['MANAGEMENT_QUALITY', 'Management Quality'],
    VALUATION_FRAMEWORK: ['VALUATION_FRAMEWORK', 'Valuation Framework'],
    FUNDAMENTALS_SUMMARY: ['FUNDAMENTALS_SUMMARY', 'Fundamentals Summary'],
    RISKS: ['RISKS', 'Risks'],
    CATALYSTS: ['CATALYSTS', 'Catalysts'],
    METADATA: ['METADATA', 'Metadata']
  };

  const sectionValues = {};
  let currentSection = null;
  const lines = normalized.split('\n');

  const normalizeHeaderCandidate = (value) => String(value || '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\*\*+/, '')
    .replace(/\*\*+$/, '')
    .replace(/^[_*`~-]+/, '')
    .replace(/[_*`~-]+$/, '')
    .replace(/^\d+[\.)]\s*/, '')
    .replace(/^\(?[A-Z]\)\s*/, '')
    .trim();

  const findSectionMatch = (value) => {
    const cleanedValue = normalizeHeaderCandidate(value).replace(/:$/, '').trim();
    if (!cleanedValue) return null;

    return Object.entries(sectionAliases).find(([, aliases]) =>
      aliases.some(alias => alias.toLowerCase() === cleanedValue.toLowerCase())
    )?.[0] || null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (currentSection) {
        sectionValues[currentSection].push(rawLine);
      }
      continue;
    }

    let matchedSection = findSectionMatch(line);
    let inlineContent = '';

    if (!matchedSection) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const headerCandidate = line.slice(0, colonIndex);
        matchedSection = findSectionMatch(headerCandidate);
        if (matchedSection) {
          inlineContent = line.slice(colonIndex + 1).trim();
        }
      }
    }

    if (matchedSection) {
      currentSection = matchedSection;
      if (!sectionValues[currentSection]) sectionValues[currentSection] = [];
      if (inlineContent) {
        sectionValues[currentSection].push(inlineContent);
      }
      continue;
    }

    if (currentSection) {
      sectionValues[currentSection].push(rawLine);
    }
  }

  const businessModelText = sectionValues.BUSINESS_MODEL?.join('\n').trim() || '';
  const moatsText = sectionValues.MOATS?.join('\n').trim() || '';
  const competitiveAdvantagesText = sectionValues.COMPETITIVE_ADVANTAGES?.join('\n').trim() || '';
  const competitiveLandscapeText = sectionValues.COMPETITIVE_LANDSCAPE?.join('\n').trim() || '';
  const managementText = sectionValues.MANAGEMENT_QUALITY?.join('\n').trim() || '';
  const valuationText = sectionValues.VALUATION_FRAMEWORK?.join('\n').trim() || '';
  const risksText = sectionValues.RISKS?.join('\n').trim() || '';
  const catalystsText = sectionValues.CATALYSTS?.join('\n').trim() || '';
  const metadata = sectionValues.METADATA?.join('\n').trim() || '';

  // Parse metadata section
  let industrySector = null;
  let marketCapCategory = null;
  let growthStage = null;
  let insiderOwnership = null;
  let institutionalOwnership = null;
  let lastEarningsDate = null;
  let nextEarningsDate = null;
  let keyMetrics = null;

  if (metadata) {
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

    const metricsMatch = metadata.match(/Key\s+metrics[:\s]+(\{[^\n]*\})/i);
    if (metricsMatch) {
      try {
        keyMetrics = JSON.parse(metricsMatch[1]);
      } catch (e) {
        console.warn('Failed to parse key_metrics JSON, skipping metadata field:', e.message);
        // Attempt to sanitize common JSON errors
        const sanitized = metricsMatch[1]
          .replace(/,\s*}/g, '}')  // Remove trailing commas in objects
          .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
          .replace(/([{,]\s*)(\w+):/g, '$1"$2":')  // Quote unquoted keys
          .replace(/:\s*'([^']*)'/g, ':"$1"');  // Replace single quotes with double quotes
        try {
          keyMetrics = JSON.parse(sanitized);
          console.log('Successfully parsed key_metrics after sanitization');
        } catch (e2) {
          keyMetrics = null;  // Fallback to null
        }
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
    business_model: cleanText(businessModelText || normalized.substring(0, 2000), 2000),
    moats: cleanText(moatsText, 2000),
    competitive_advantages: cleanText(competitiveAdvantagesText, 2000),
    competitive_landscape: cleanText(competitiveLandscapeText, 2000),
    management_quality: cleanText(managementText, 2000),
    valuation_framework: cleanText(valuationText, 2000),
    fundamentals: fundamentals || {},
    risks: cleanText(risksText, 2000),
    catalysts: cleanText(catalystsText, 2000),
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
  cancelProfileBuild,
  isProfileBuildCancelled,
  saveStockProfile,
  getStockProfile,
  getStockProfiles,
  getStaleProfiles,
  getProfileFreshness,
  buildStockProfile,
  ensureFreshStockProfile,
  updateStockProfile,
  runBiweeklyDeepResearch,
  buildProfileBatch
};
