import { initDatabase } from '../src/db.js';

console.log('🚀 Initializing Railway database schema...\n');

try {
  await initDatabase();
  console.log('\n✅ Railway database initialized successfully');
  process.exit(0);
} catch (error) {
  console.error('\n❌ Database initialization failed:', error);
  process.exit(1);
}
