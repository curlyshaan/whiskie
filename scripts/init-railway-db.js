import * as db from '../src/db.js';

console.log('🚀 Initializing Railway database...\n');

try {
  await db.initDatabase();
  console.log('\n✅ Database initialized successfully!');
  process.exit(0);
} catch (error) {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
}
