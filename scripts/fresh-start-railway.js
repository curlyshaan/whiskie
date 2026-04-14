import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const FMP_API_KEY = process.env.FMP_API_KEY_1;
const MIN_MARKET_CAP = 7_000_000_000; // 7B
const STOCKS_PER_INDUSTRY = 7; // Top 7 per industry

/**
 * STEP 1: Clean up all databases
 */
async function cleanupDatabases() {
  console.log('\n🧹 STEP 1: Cleaning up all databases...\n');

  const client = await pool.connect();

  try {
    await client.query('DELETE FROM trade_approvals');
    await client.query('DELETE FROM positions');
    await client.query('DELETE FROM trades');
    await client.query('DELETE FROM stock_profiles');
    await client.query('DELETE FROM saturday_watchlist');
    await client.query('DELETE FROM watchlist');
    await client.query('DELETE FROM stock_universe');

    console.log('✅ All databases cleaned\n');
  } finally {
    client.release();
  }
}

/**
 * STEP 2: Populate stock universe from FMP API
 */
async function populateStockUniverse() {
  console.log('📊 STEP 2: Populating stock universe from FMP API...\n');

  // Fetch stocks from FMP
  const url = `https://financialmodelingprep.com/stable/company-screener?marketCapMoreThan=${MIN_MARKET_CAP}&apikey=${FMP_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error('FMP API returned non-array response');
  }

  // Filter to US stocks, no ETFs
  const filtered = data.filter(stock =>
    !stock.isEtf &&
    !stock.isFund &&
    stock.isActivelyTrading &&
    stock.exchangeShortName &&
    ['NASDAQ', 'NYSE', 'AMEX'].includes(stock.exchangeShortName)
  );

  console.log(`   Fetched ${data.length} stocks from FMP`);
  console.log(`   Filtered to ${filtered.length} US stocks (7B+, no ETFs)\n`);

  // Group by industry and take top 7 per industry
  const byIndustry = {};
  filtered.forEach(stock => {
    const industry = stock.industry || 'Unknown';
    if (!byIndustry[industry]) byIndustry[industry] = [];
    byIndustry[industry].push(stock);
  });

  const selected = [];
  Object.entries(byIndustry).forEach(([industry, stocks]) => {
    const sorted = stocks.sort((a, b) => b.marketCap - a.marketCap);
    selected.push(...sorted.slice(0, STOCKS_PER_INDUSTRY));
  });

  console.log(`   Selected ${selected.length} stocks (top 7 per industry)\n`);

  // Insert into database
  const client = await pool.connect();

  try {
    for (const stock of selected) {
      const marketCapB = stock.marketCap / 1e9;
      let tier;
      if (marketCapB >= 200) tier = 'mega';
      else if (marketCapB >= 10) tier = 'large';
      else if (marketCapB >= 2) tier = 'mid';
      else tier = 'small';

      await client.query(
        `INSERT INTO stock_universe
         (symbol, company_name, sector, industry, market_cap, market_cap_tier,
          price, avg_daily_volume, exchange, country, is_etf, is_actively_trading, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          stock.symbol,
          stock.companyName,
          stock.sector,
          stock.industry,
          stock.marketCap,
          tier,
          stock.price,
          stock.volume || 0,
          stock.exchangeShortName,
          stock.country || 'US',
          false,
          true,
          'active'
        ]
      );
    }

    console.log(`✅ Inserted ${selected.length} stocks into stock_universe\n`);
  } finally {
    client.release();
  }

  return selected.length;
}

/**
 * STEP 3: Build stock profiles for all stocks in universe
 */
async function buildAllStockProfiles(totalStocks) {
  console.log(`🔬 STEP 3: Building stock profiles for all ${totalStocks} stocks...\n`);
  console.log('   This will be triggered via API endpoint\n');

  // Trigger profile building via API
  const apiUrl = process.env.RAILWAY_API_URL || 'https://whiskie-production.up.railway.app';

  try {
    const response = await fetch(`${apiUrl}/api/trigger-profile-build-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.ok) {
      console.log('✅ Stock profile building triggered on Railway\n');
    } else {
      console.log('⚠️  Could not trigger via API, will need manual trigger\n');
    }
  } catch (error) {
    console.log('⚠️  Could not trigger via API, will need manual trigger\n');
  }
}

/**
 * STEP 4: Run Saturday screening
 */
async function runSaturdayScreening() {
  console.log('💎 STEP 4: Running Saturday screening...\n');
  console.log('   This will be triggered via API endpoint\n');

  const apiUrl = process.env.RAILWAY_API_URL || 'https://whiskie-production.up.railway.app';

  try {
    const response = await fetch(`${apiUrl}/api/trigger-saturday-screening`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.ok) {
      console.log('✅ Saturday screening triggered on Railway\n');
    } else {
      console.log('⚠️  Could not trigger via API, will need manual trigger\n');
    }
  } catch (error) {
    console.log('⚠️  Could not trigger via API, will need manual trigger\n');
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('\n═══════════════════════════════════════');
  console.log('🚀 FRESH START - RAILWAY');
  console.log('═══════════════════════════════════════\n');

  try {
    // Step 1: Clean databases
    await cleanupDatabases();

    // Step 2: Populate stock universe
    const totalStocks = await populateStockUniverse();

    // Step 3: Build stock profiles
    await buildAllStockProfiles(totalStocks);

    // Step 4: Run Saturday screening
    await runSaturdayScreening();

    console.log('═══════════════════════════════════════');
    console.log('✅ FRESH START COMPLETE');
    console.log('═══════════════════════════════════════\n');
    console.log('Next steps:');
    console.log('1. Monitor Railway logs for profile building progress');
    console.log('2. Monitor Railway logs for Saturday screening results');
    console.log('3. Check /approvals dashboard for trade recommendations\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

main();
