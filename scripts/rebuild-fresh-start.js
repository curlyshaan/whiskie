import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import fundamentalScreener from '../src/fundamental-screener.js';
import stockProfiles from '../src/stock-profiles.js';
import weeklyOpusReview from '../src/weekly-opus-review.js';
import * as db from '../src/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const execFileAsync = promisify(execFile);

async function runNodeScript(scriptPath, label) {
  console.log(`\n▶ ${label}`);
  const { stdout, stderr } = await execFileAsync('node', [scriptPath], {
    cwd: '/Users/sshanoor/ClaudeProjects/Whiskie',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024
  });

  if (stdout?.trim()) console.log(stdout.trim());
  if (stderr?.trim()) console.error(stderr.trim());
}

async function buildWatchlistProfiles() {
  console.log('\n▶ Build/update stock profiles for active saturday_watchlist');
  const watchlistResult = await db.getCanonicalSaturdayWatchlistRows(['active'], { includePromoted: true });
  const watchlistSymbols = [...new Set(watchlistResult.map(row => row.symbol))];
  console.log(`Active/promoted watchlist symbols: ${watchlistSymbols.length}`);

  let newProfiles = 0;
  let incrementalUpdates = 0;
  let skipped = 0;
  let failed = 0;

  const existingProfiles = await db.query(
    'SELECT symbol, last_updated FROM stock_profiles WHERE symbol = ANY($1)',
    [watchlistSymbols]
  );
  const existingProfileMap = new Map(existingProfiles.rows.map(row => [row.symbol, row.last_updated]));

  for (let i = 0; i < watchlistSymbols.length; i++) {
    const symbol = watchlistSymbols[i];
    const indexLabel = `[${i + 1}/${watchlistSymbols.length}]`;

    try {
      const lastUpdated = existingProfileMap.get(symbol);
      if (lastUpdated) {
        const daysSinceUpdate = (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceUpdate < 14) {
          console.log(`${indexLabel} Skipping ${symbol} (${daysSinceUpdate.toFixed(1)} days old)`);
          skipped++;
        } else {
          console.log(`${indexLabel} Updating ${symbol} (incremental, ${daysSinceUpdate.toFixed(1)} days old)`);
          await stockProfiles.updateStockProfile(symbol);
          incrementalUpdates++;
        }
      } else {
        console.log(`${indexLabel} Building ${symbol} (new profile)`);
        await stockProfiles.buildStockProfile(symbol);
        newProfiles++;
      }
    } catch (error) {
      failed++;
      console.error(`${indexLabel} Failed ${symbol}: ${error.message}`);
    }
  }

  console.log(`Profiles complete: ${newProfiles} new, ${incrementalUpdates} updated, ${skipped} skipped, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`Profile build had ${failed} failures`);
  }
}

async function printCounts() {
  const counts = {};
  for (const table of ['stock_universe', 'earnings_calendar', 'saturday_watchlist', 'stock_profiles']) {
    const result = await db.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    counts[table] = result.rows[0].count;
  }
  console.log('\nCurrent row counts:');
  for (const [table, count] of Object.entries(counts)) {
    console.log(`- ${table}: ${count}`);
  }
}

async function main() {
  try {
    console.log('\n═══════════════════════════════════════');
    console.log('🚀 WHISKIE FRESH START REBUILD');
    console.log('═══════════════════════════════════════');

    await runNodeScript('/Users/sshanoor/ClaudeProjects/Whiskie/scripts/populate-universe-v2.js', 'Populate stock_universe');
    await printCounts();

    await runNodeScript('/Users/sshanoor/ClaudeProjects/Whiskie/scripts/refresh-earnings-fmp.js', 'Refresh earnings_calendar');
    await printCounts();

    console.log('\n▶ Run Saturday screening');
    await fundamentalScreener.runWeeklyScreen('full');
    await printCounts();

    await buildWatchlistProfiles();
    await printCounts();

    console.log('\n▶ Run Weekly Opus review');
    const results = await weeklyOpusReview.runWeeklyReview();
    console.log(`Weekly Opus review complete: analyzed ${results.analyzed}, activated ${results.activated}`);
    await printCounts();

    console.log('\n✅ Fresh start rebuild complete');
  } catch (error) {
    console.error('\n❌ Fresh start rebuild failed:', error);
    process.exit(1);
  }
}

main();
