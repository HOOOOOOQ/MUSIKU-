import { connectDatabase, disconnectDatabase, initIndexes, databaseHealth, supportsTransactions } from './database';

/**
 * Database initialization: connect, create indexes, report health.
 * Run: npm run db:init
 */
async function initDb(): Promise<void> {
  await connectDatabase({ attempts: 2 });
  const indexes = await initIndexes();
  const health = await databaseHealth();
  const transactions = await supportsTransactions();
  // eslint-disable-next-line no-console
  console.log('[db:init] Health:', health);
  // eslint-disable-next-line no-console
  console.log(`[db:init] Indexes ready for ${indexes.created} models; transactions ${transactions ? 'supported' : 'NOT supported'}`);
  if (indexes.failures.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('[db:init] Index failures (inspect Atlas user privileges):', indexes.failures);
  }
  await disconnectDatabase();
  if (health.status !== 'ok' || indexes.failures.length > 0) process.exitCode = 1;
}

initDb().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[db:init] Failed:', err);
  process.exit(1);
});
