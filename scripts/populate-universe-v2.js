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
const RATE_LIMIT_DELAY = 400; // 400ms = 150 calls/min (under 300/min limit)

/**
 * Fetch all stocks with 7B+ market cap from FMP
 */
async function fetchStocksFromFMP() {
  console.log('📊 Fetching stocks from FMP company-screener...');
  console.log(`   Filter: Market cap >= $${(MIN_MARKET_CAP / 1e9).toFixed(0)}B\n`);

  try {
    // FMP company-screener doesn't have a limit parameter, so we get all results
    const url = `https://financialmodelingprep.com/stable/company-screener?marketCapMoreThan=${MIN_MARKET_CAP}&apikey=${FMP_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    console.log(`   Response status: ${response.status}`);
    console.log(`   Data type: ${typeof data}`);
    console.log(`   Is array: ${Array.isArray(data)}`);
    console.log(`   Data length: ${data?.length || 'N/A'}`);

    if (!Array.isArray(data)) {
      console.log(`   Actual data:`, JSON.stringify(data).substring(0, 200));
      throw new Error('FMP API returned non-array response');
    }

    // Filter out ETFs and non-actively trading stocks
    const filtered = data.filter(stock =>
      !stock.isEtf &&
      !stock.isFund &&
      stock.isActivelyTrading &&
      stock.exchangeShortName &&
      ['NASDAQ', 'NYSE', 'AMEX'].includes(stock.exchangeShortName)
    );

    console.log(`   ✅ Fetched ${data.length} stocks from FMP`);
    console.log(`   ✅ Filtered to ${filtered.length} US stocks (7B+, actively trading, no ETFs)\n`);

    return filtered;

  } catch (error) {
    console.error('❌ Error fetching from FMP:', error.message);
    throw error;
  }
}

/**
 * Group stocks by industry and take top N by market cap per industry
 */
function selectTopStocksPerIndustry(stocks, topN) {
  console.log('🎯 Selecting top stocks per industry...\n');

  // Group by industry
  const byIndustry = {};
  stocks.forEach(stock => {
    const industry = stock.industry || 'Unknown';
    if (!byIndustry[industry]) {
      byIndustry[industry] = [];
    }
    byIndustry[industry].push(stock);
  });

  console.log(`   Found ${Object.keys(byIndustry).length} unique industries`);

  // Sort each industry by market cap and take top N
  const selected = [];
  const industryStats = [];

  Object.entries(byIndustry).forEach(([industry, stocks]) => {
    const sorted = stocks.sort((a, b) => b.marketCap - a.marketCap);
    const top = sorted.slice(0, topN);
    selected.push(...top);

    industryStats.push({
      industry,
      total: stocks.length,
      selected: top.length,
      topSymbol: top[0]?.symbol,
      topMarketCap: top[0]?.marketCap
    });
  });

  // Sort industries by total stocks for display
  industryStats.sort((a, b) => b.total - a.total);

  console.log(`\n   📋 Industry breakdown (top 20):`);
  industryStats.slice(0, 20).forEach(stat => {
    console.log(`      ${stat.industry}: ${stat.selected}/${stat.total} stocks (top: ${stat.topSymbol} $${(stat.topMarketCap / 1e9).toFixed(1)}B)`);
  });

  console.log(`\n   ✅ Selected ${selected.length} stocks total\n`);

  return selected;
}

/**
 * Insert stocks into stock_universe table
 */
async function populateDatabase(stocks) {
  console.log('💾 Populating stock_universe table...\n');

  const client = await pool.connect();

  try {
    // Clear existing data
    await client.query('DELETE FROM stock_universe');
    console.log('   🗑️  Cleared existing data');

    let inserted = 0;
    let errors = 0;

    for (const stock of stocks) {
      try {
        // Determine market cap tier
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
            stock.isEtf || false,
            stock.isActivelyTrading !== false,
            'active'
          ]
        );

        inserted++;

        if (inserted % 50 === 0) {
          console.log(`   Progress: ${inserted}/${stocks.length} stocks inserted`);
        }

      } catch (error) {
        console.error(`   ⚠️  Error inserting ${stock.symbol}:`, error.message);
        errors++;
      }
    }

    console.log(`\n   ✅ Inserted ${inserted} stocks`);
    if (errors > 0) {
      console.log(`   ⚠️  ${errors} errors`);
    }

    // Show summary stats
    const stats = await client.query(`
      SELECT
        market_cap_tier,
        COUNT(*) as count,
        MIN(market_cap) as min_cap,
        MAX(market_cap) as max_cap
      FROM stock_universe
      GROUP BY market_cap_tier
      ORDER BY MIN(market_cap) DESC
    `);

    console.log('\n   📊 Market cap distribution:');
    stats.rows.forEach(row => {
      console.log(`      ${row.market_cap_tier}: ${row.count} stocks ($${(row.min_cap / 1e9).toFixed(1)}B - $${(row.max_cap / 1e9).toFixed(1)}B)`);
    });

    const sectorStats = await client.query(`
      SELECT sector, COUNT(*) as count
      FROM stock_universe
      GROUP BY sector
      ORDER BY count DESC
      LIMIT 10
    `);

    console.log('\n   📊 Top sectors:');
    sectorStats.rows.forEach(row => {
      console.log(`      ${row.sector}: ${row.count} stocks`);
    });

  } catch (error) {
    console.error('❌ Database error:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('\n═══════════════════════════════════════');
  console.log('🚀 POPULATE STOCK UNIVERSE (FMP-BASED)');
  console.log('═══════════════════════════════════════\n');
  console.log(`Configuration:`);
  console.log(`  - Min market cap: $${(MIN_MARKET_CAP / 1e9).toFixed(0)}B`);
  console.log(`  - Stocks per industry: ${STOCKS_PER_INDUSTRY}`);
  console.log(`  - Rate limit: ${RATE_LIMIT_DELAY}ms delay\n`);

  try {
    // Step 1: Fetch all 7B+ stocks from FMP
    const allStocks = await fetchStocksFromFMP();

    // Step 2: Select top N per industry
    const selectedStocks = selectTopStocksPerIndustry(allStocks, STOCKS_PER_INDUSTRY);

    // Step 3: Populate database
    await populateDatabase(selectedStocks);

    console.log('\n═══════════════════════════════════════');
    console.log('✅ UNIVERSE POPULATION COMPLETE');
    console.log('═══════════════════════════════════════\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

main();
