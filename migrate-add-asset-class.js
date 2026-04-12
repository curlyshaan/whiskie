import * as db from './src/db.js';

async function migrate() {
  try {
    console.log('🔧 Adding asset_class column to stock_universe table...');
    await db.query(`ALTER TABLE stock_universe ADD COLUMN IF NOT EXISTS asset_class VARCHAR(50)`);
    console.log('✅ Migration complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
