import * as db from '../src/db.js';
import * as claude from '../src/claude.js';

/**
 * ONE-TIME SCRIPT: Backfill key_metrics_to_watch for existing profiles
 *
 * This script updates profiles that have NULL key_metrics_to_watch field.
 * It calls Opus to generate ONLY the key_metrics field (minimal tokens).
 *
 * Run once after deploying the JSON parsing fix, then delete this script.
 */

async function backfillKeyMetrics() {
  console.log('\n🔧 Backfilling key_metrics_to_watch for existing profiles...\n');

  try {
    // Get profiles with NULL key_metrics
    const result = await db.query(
      `SELECT symbol, business_model, fundamentals, risks, catalysts
       FROM stock_profiles
       WHERE key_metrics_to_watch IS NULL
       ORDER BY symbol`
    );

    const profiles = result.rows;
    console.log(`Found ${profiles.length} profiles with NULL key_metrics\n`);

    if (profiles.length === 0) {
      console.log('✅ All profiles already have key_metrics populated!');
      process.exit(0);
    }

    let updated = 0;
    let failed = 0;

    for (const profile of profiles) {
      try {
        console.log(`[${updated + failed + 1}/${profiles.length}] Processing ${profile.symbol}...`);

        // Generate key_metrics using Opus (minimal prompt)
        const prompt = `You are analyzing ${profile.symbol}. Based on the profile below, identify 3-5 key metrics to monitor.

Business Model: ${profile.business_model}

Fundamentals: ${JSON.stringify(profile.fundamentals, null, 2)}

Risks: ${profile.risks}

Catalysts: ${profile.catalysts}

Return ONLY a JSON object with this structure (no other text):
{
  "metric_name": "why it matters for this stock"
}

Example:
{
  "Revenue Growth Rate": "Key indicator of market share gains in competitive landscape",
  "Operating Margin": "Tracks operational efficiency improvements from automation",
  "Free Cash Flow": "Critical for funding expansion without dilution"
}`;

        const response = await claude.generateText(prompt, {
          model: claude.MODELS.OPUS,
          temperature: 0.1,
          maxTokens: 500
        });

        // Parse and sanitize JSON
        let keyMetrics = null;
        try {
          keyMetrics = JSON.parse(response);
        } catch (e) {
          // Attempt sanitization
          const sanitized = response
            .replace(/,\s*}/g, '}')
            .replace(/,\s*]/g, ']')
            .replace(/([{,]\s*)(\w+):/g, '$1"$2":')
            .replace(/:\s*'([^']*)'/g, ':"$1"');
          try {
            keyMetrics = JSON.parse(sanitized);
          } catch (e2) {
            console.warn(`  ⚠️  Failed to parse JSON for ${profile.symbol}`);
            failed++;
            continue;
          }
        }

        // Update database
        await db.query(
          'UPDATE stock_profiles SET key_metrics_to_watch = $1 WHERE symbol = $2',
          [keyMetrics, profile.symbol]
        );

        updated++;
        console.log(`  ✅ Updated ${profile.symbol}`);

        // Rate limiting: 2-second delay between calls
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`  ❌ Error processing ${profile.symbol}:`, error.message);
        failed++;
      }
    }

    console.log(`\n✅ Backfill complete: ${updated} updated, ${failed} failed`);
    console.log('\n⚠️  DELETE THIS SCRIPT after verifying results\n');
    process.exit(0);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

backfillKeyMetrics();
