#!/bin/bash

echo "🔥 WHISKIE FRESH START - Complete System Reset"
echo "================================================"
echo ""

# Database connection
export PGPASSWORD=FfUODiEUFXZPGEeJifsKToEvxnavlkGz
DB_HOST="hopper.proxy.rlwy.net"
DB_PORT="44407"
DB_USER="postgres"
DB_NAME="railway"

echo "Step 1: Clearing all databases..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF
-- Clear all tables
DELETE FROM trade_approvals;
DELETE FROM positions;
DELETE FROM trades;
DELETE FROM stock_profiles;
DELETE FROM saturday_watchlist;
DELETE FROM watchlist;

-- Show counts
SELECT 'trade_approvals' as table_name, COUNT(*) as count FROM trade_approvals
UNION ALL SELECT 'positions', COUNT(*) FROM positions
UNION ALL SELECT 'trades', COUNT(*) FROM trades
UNION ALL SELECT 'stock_profiles', COUNT(*) FROM stock_profiles
UNION ALL SELECT 'saturday_watchlist', COUNT(*) FROM saturday_watchlist
UNION ALL SELECT 'watchlist', COUNT(*) FROM watchlist;
EOF

echo ""
echo "Step 2: Populating stock universe..."
npm run populate-stocks

echo ""
echo "Step 3: Running Saturday screening (full universe)..."
node -e "
import('./src/fundamental-screener.js').then(async (module) => {
  const screener = module.default;
  await screener.runWeeklyScreen('full');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
"

echo ""
echo "Step 4: Building ALL stock profiles (one batch)..."
node -e "
import('./src/stock-profiles.js').then(async (module) => {
  const db = await import('./src/db.js');

  // Get all symbols from saturday_watchlist
  const result = await db.query(
    'SELECT DISTINCT symbol FROM saturday_watchlist WHERE status = \$1 ORDER BY symbol',
    ['active']
  );

  const symbols = result.rows.map(r => r.symbol);
  console.log(\`Building profiles for \${symbols.length} stocks...\n\`);

  let completed = 0;
  let failed = 0;

  for (const symbol of symbols) {
    try {
      console.log(\`[\${completed + failed + 1}/\${symbols.length}] Building \${symbol}...\`);
      await module.buildStockProfile(symbol);
      completed++;

      // Add 2-second delay between profiles to avoid rate limiting
      // Each profile makes ~6 FMP API calls, so this keeps us well under 300/min
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(\`Failed \${symbol}: \${error.message}\`);
      failed++;
    }
  }

  console.log(\`\n✅ Profile building complete: \${completed} succeeded, \${failed} failed\`);
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
"

echo ""
echo "Step 5: Running weekly review..."
node -e "
import('./src/weekly-portfolio-review.js').then(async (module) => {
  await module.default.runWeeklyPortfolioReview();
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
"

echo ""
echo "================================================"
echo "✅ FRESH START COMPLETE!"
echo "================================================"
echo ""
echo "Summary:"
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF
SELECT 'stock_universe' as table_name, COUNT(*) as count FROM stock_universe WHERE status = 'active'
UNION ALL SELECT 'saturday_watchlist', COUNT(*) FROM saturday_watchlist WHERE status = 'active'
UNION ALL SELECT 'stock_profiles', COUNT(*) FROM stock_profiles
UNION ALL SELECT 'watchlist', COUNT(*) FROM watchlist;
EOF

echo ""
echo "🚀 System ready for daily analysis!"
