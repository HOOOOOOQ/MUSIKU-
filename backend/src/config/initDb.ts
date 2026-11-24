import { connectDatabase, disconnectDatabase, initIndexes, databaseHealth } from './database';

/**
 * Database initialization: connect, create indexes, report health.
 * Run: npm run db:init
 */
async function initDb(): Promise<void> {
  await connectDatabase();
  await initIndexes();
  const health = await databaseHealth();
  // eslint-disable-next-line no-console
  console.log('[db:init] Health:', health);
  // eslint-disable-next-line no-console
  console.log('[db:init] Indexes initialized for all collections.');
  await disconnectDatabase();
}

initDb().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[db:init] Failed:', err);
  process.exit(1);
});
