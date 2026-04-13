import * as db from '../src/db.js';
import tavily from '../src/tavily.js';
import claude from '../src/claude.js';

/**
 * Update catalyst column for existing stock profiles
 * Uses Tavily to fetch recent news and Opus to synthesize catalysts
 */

async function cleanExistingCatalysts() {
  console.log('\n🧹 Cleaning existing catalyst data...');

  const result = await db.query(`
    UPDATE stock_profiles
    SET catalysts = TRIM(LEADING '**' FROM catalysts)
    WHERE catalysts LIKE '**%'
    RETURNING symbol
  `);

  console.log(`   ✅ Cleaned ${result.rowCount} catalyst entries`);
  return result.rowCount;
}

async function updateCatalystsForStock(symbol) {
  console.log(`\n📰 Updating catalysts for ${symbol}...`);

  try {
    // Get existing profile
    const profile = await db.query(
      'SELECT * FROM stock_profiles WHERE symbol = $1',
      [symbol]
    );

    if (!profile.rows.length) {
      console.log(`  ⏭️  No profile found for ${symbol}, skipping`);
      return { symbol, skipped: true, reason: 'no_profile' };
    }

    // Fetch recent news
    console.log(`  🔍 Fetching recent news...`);
    const newsResults = await tavily.search(`${symbol} stock news catalyst earnings`, {
      days: 90,
      maxResults: 10
    });

    if (!newsResults || newsResults.length === 0) {
      console.log(`  ⚠️  No recent news found for ${symbol}`);
      return { symbol, skipped: true, reason: 'no_news' };
    }

    // Build news summary
    const newsContext = newsResults.map(r =>
      `- ${r.title} (${r.publishedDate || 'recent'}): ${r.content}`
    ).join('\n');

    // Use Opus to synthesize catalysts
    console.log(`  🤖 Synthesizing catalysts with Opus...`);
    const prompt = `Analyze recent news for ${symbol} and identify key catalysts (positive or negative events that could drive stock price).

Recent News:
${newsContext}

Existing Business Context:
${profile.rows[0].business_model || 'N/A'}

Provide a concise list of catalysts in this format:
- [POSITIVE/NEGATIVE] Brief catalyst description (timeframe if known)

Focus on:
1. Upcoming earnings or product launches
2. Regulatory changes or legal issues
3. Management changes or strategic shifts
4. Market trends affecting the company
5. Competitive dynamics

Keep it under 200 words total. Do NOT include any markdown formatting like ** or headers.`;

    const messages = [{ role: 'user', content: prompt }];
    const response = await claude.sendMessage(messages, 'claude-opus-4-6-thinking', null, false);

    let catalysts = response.content[0].text.trim();

    // Clean any markdown formatting that might slip through
    catalysts = catalysts.replace(/^\*\*\s*/gm, '');
    catalysts = catalysts.replace(/\*\*/g, '');

    // Update database
    await db.query(
      `UPDATE stock_profiles
       SET catalysts = $1,
           last_updated = CURRENT_TIMESTAMP,
           profile_version = profile_version + 1
       WHERE symbol = $2`,
      [catalysts, symbol]
    );

    console.log(`  ✅ Updated catalysts for ${symbol}`);
    return { symbol, success: true, catalysts };

  } catch (error) {
    console.error(`  ❌ Error updating ${symbol}:`, error.message);
    return { symbol, error: error.message };
  }
}

export async function updateAllCatalysts(cleanOnly = false) {
  console.log('🚀 Starting catalyst update...\n');

  try {
    // Step 1: Clean existing catalysts
    const cleanedCount = await cleanExistingCatalysts();

    if (cleanOnly) {
      console.log('\n✅ Cleaning complete. Exiting (cleanOnly mode).');
      return { cleaned: cleanedCount };
    }

    // Step 2: Get stocks without catalysts
    const result = await db.query(
      'SELECT symbol FROM stock_profiles WHERE catalysts IS NULL ORDER BY symbol'
    );

    const symbols = result.rows.map(r => r.symbol);
    console.log(`\n📊 Found ${symbols.length} profiles needing catalysts\n`);

    if (symbols.length === 0) {
      console.log('✅ All profiles already have catalysts!');
      return { cleaned: cleanedCount, success: [], skipped: [], errors: [] };
    }

    const results = {
      cleaned: cleanedCount,
      success: [],
      skipped: [],
      errors: []
    };

    // Process in batches of 5 to avoid rate limits
    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(symbols.length / batchSize)}`);
      console.log(`   Symbols: ${batch.join(', ')}`);

      const batchResults = await Promise.all(
        batch.map(symbol => updateCatalystsForStock(symbol))
      );

      // Categorize results
      batchResults.forEach(r => {
        if (r.success) results.success.push(r.symbol);
        else if (r.skipped) results.skipped.push(r.symbol);
        else if (r.error) results.errors.push(r.symbol);
      });

      // Rate limit delay between batches (Tavily + Opus)
      if (i + batchSize < symbols.length) {
        console.log('\n⏳ Waiting 45 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 45000));
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 CATALYST UPDATE SUMMARY');
    console.log('='.repeat(60));
    console.log(`🧹 Cleaned existing: ${results.cleaned}`);
    console.log(`✅ Successfully updated: ${results.success.length}`);
    console.log(`⏭️  Skipped: ${results.skipped.length}`);
    console.log(`❌ Errors: ${results.errors.length}`);

    if (results.errors.length > 0) {
      console.log(`\nErrors for: ${results.errors.join(', ')}`);
    }

    return results;

  } catch (error) {
    console.error('Fatal error:', error);
    throw error;
  }
}

// Allow running as standalone script
if (import.meta.url === `file://${process.argv[1]}`) {
  const cleanOnly = process.argv.includes('--clean-only');
  updateAllCatalysts(cleanOnly)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
