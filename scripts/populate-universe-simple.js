import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const FMP_API_KEY = process.env.FMP_API_KEY_1;
const MIN_MARKET_CAP = 7_000_000_000;
const STOCKS_PER_INDUSTRY = 5;

async function main() {
  console.log('🚀 Populating stock universe...\n');

  try {
    // Fetch stocks from FMP
    console.log('📊 Fetching from FMP...');
    const url = `https://financialmodelingprep.com/stable/company-screener?marketCapMoreThan=${MIN_MARKET_CAP}&apikey=${FMP_API_KEY}`;
    const response = await fetch(url);
    const allStocks = await response.json();

    if (!Array.isArray(allStocks)) {
      throw new Error('Invalid FMP response');
    }

    // Filter US stocks, no ETFs
    const filtered = allStocks.filter(s =>
      !s.isEtf && !s.isFund && s.isActivelyTrading &&
      ['NASDAQ', 'NYSE', 'AMEX'].includes(s.exchangeShortName)
    );

    console.log(`   Found ${filtered.length} US stocks (7B+)\n`);

    // Group by industry
    const byIndustry = {};
    filtered.forEach(stock => {
      const ind = stock.industry || 'Unknown';
      if (!byIndustry[ind]) byIndustry[ind] = [];
      byIndustry[ind].push(stock);
    });

    // Select top N per industry
    const selected = [];
    Object.values(byIndustry).forEach(stocks => {
      const sorted = stocks.sort((a, b) => b.marketCap - a.marketCap);
      selected.push(...sorted.slice(0, STOCKS_PER_INDUSTRY));
    });

    console.log(`   Selected ${selected.length} stocks (top ${STOCKS_PER_INDUSTRY} per industry)\n`);

    // Insert into database
    console.log('💾 Inserting into database...');
    const client = await pool.connect();

    try {
      await client.query('DELETE FROM stock_universe');
      console.log('   Cleared existing data\n');

      let inserted = 0;
      for (const stock of selected) {
        const marketCapB = stock.marketCap / 1e9;
        const tier = marketCapB >= 200 ? 'mega' : marketCapB >= 10 ? 'large' : marketCapB >= 2 ? 'mid' : 'small';

        await client.query(
          `INSERT INTO stock_universe
           (symbol, company_name, sector, industry, market_cap, market_cap_tier, price, avg_daily_volume, exchange, country, is_etf, is_actively_trading, status)
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

        inserted++;
        if (inserted % 50 === 0) {
          console.log(`   Progress: ${inserted}/${selected.length}`);
        }
      }

      console.log(`\n✅ Inserted ${inserted} stocks\n`);

      // Show stats
      const stats = await client.query(`
        SELECT market_cap_tier, COUNT(*) as count
        FROM stock_universe
        GROUP BY market_cap_tier
        ORDER BY MIN(market_cap) DESC
      `);

      console.log('📊 Market cap distribution:');
      stats.rows.forEach(r => console.log(`   ${r.market_cap_tier}: ${r.count} stocks`));

      const sectorStats = await client.query(`
        SELECT sector, COUNT(*) as count
        FROM stock_universe
        GROUP BY sector
        ORDER BY count DESC
        LIMIT 10
      `);

      console.log('\n📊 Top sectors:');
      sectorStats.rows.forEach(r => console.log(`   ${r.sector}: ${r.count} stocks`));

    } finally {
      client.release();
    }

    console.log('\n✅ Universe population complete!\n');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
