#!/bin/bash

echo "🔄 Rebuilding empty stock profiles..."
echo ""

node -e "
import('./src/stock-profiles.js').then(async (module) => {
  const db = await import('./src/db.js');

  // Get all symbols with empty profiles
  const result = await db.query(
    'SELECT symbol FROM stock_profiles WHERE business_model IS NULL OR business_model = \\'\\'',
    []
  );

  const symbols = result.rows.map(r => r.symbol);
  console.log(\`Found \${symbols.length} empty profiles to rebuild\n\`);

  let completed = 0;
  let failed = 0;

  for (const symbol of symbols) {
    try {
      console.log(\`[\${completed + failed + 1}/\${symbols.length}] Rebuilding \${symbol}...\`);

      // Delete the empty profile first
      await db.query('DELETE FROM stock_profiles WHERE symbol = \$1', [symbol]);

      // Rebuild it
      await module.buildStockProfile(symbol);
      completed++;

      // 3-second delay between profiles to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (error) {
      console.error(\`Failed \${symbol}: \${error.message}\`);
      failed++;
    }
  }

  console.log(\`\n✅ Rebuild complete: \${completed} succeeded, \${failed} failed\`);
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
"
