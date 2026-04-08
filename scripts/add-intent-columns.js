import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

/**
 * Add original_intent and current_intent columns to position_lots table
 * This allows Opus to track how positions evolve over time
 */

async function addIntentColumns() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('📊 Adding intent columns to position_lots table...\n');

    // Add original_intent and current_intent columns
    await pool.query(`
      ALTER TABLE position_lots
      ADD COLUMN IF NOT EXISTS original_intent VARCHAR(50),
      ADD COLUMN IF NOT EXISTS current_intent VARCHAR(50);
    `);

    console.log('✅ Added original_intent column');
    console.log('✅ Added current_intent column');

    // Migrate existing data: copy lot_type to both intent columns
    const result = await pool.query(`
      UPDATE position_lots
      SET original_intent = lot_type,
          current_intent = lot_type
      WHERE original_intent IS NULL;
    `);

    console.log(`✅ Migrated ${result.rowCount} existing lots\n`);

    console.log('📝 Intent columns added successfully!');
    console.log('   - original_intent: Set at purchase, never changes');
    console.log('   - current_intent: Opus can update based on evolving thesis');
    console.log('   - Examples: swing → long-term, opportunistic → core-holding\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

addIntentColumns();
