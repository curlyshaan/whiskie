import * as db from '../src/db.js';

async function checkCatalysts() {
  // Count stocks with and without catalysts
  const counts = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE catalysts IS NOT NULL) as with_catalysts,
      COUNT(*) FILTER (WHERE catalysts IS NULL) as without_catalysts,
      COUNT(*) as total
    FROM stock_profiles
  `);

  console.log('Catalyst Status:');
  console.log(`  With catalysts: ${counts.rows[0].with_catalysts}`);
  console.log(`  Without catalysts: ${counts.rows[0].without_catalysts}`);
  console.log(`  Total profiles: ${counts.rows[0].total}`);

  // Show sample catalysts to see what cleaning is needed
  const samples = await db.query(`
    SELECT symbol, catalysts
    FROM stock_profiles
    WHERE catalysts IS NOT NULL
    LIMIT 3
  `);

  console.log('\nSample catalyst data:');
  samples.rows.forEach(row => {
    console.log(`\n${row.symbol}:`);
    console.log(row.catalysts);
    console.log('---');
  });

  process.exit(0);
}

checkCatalysts().catch(err => {
  console.error(err);
  process.exit(1);
});
