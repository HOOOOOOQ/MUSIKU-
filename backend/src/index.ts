import { createApp } from './app';
import { connectDatabase, disconnectDatabase, initIndexes, supportsTransactions } from './config/database';
import { env } from './config/env';
import { auditService } from './services/auditService';

/**
 * Process bootstrap.
 *
 * Startup order: validate environment (module load) → connect Atlas with a
 * bounded retry loop → create declared indexes → listen. Shutdown is graceful:
 * stop accepting connections, drain in-flight requests, close the Mongo pool,
 * and exit. A hard timer guarantees the process still exits if a connection
 * refuses to drain, so an orchestrator never waits forever.
 */
const SHUTDOWN_TIMEOUT_MS = 15_000;

async function main(): Promise<void> {
  await connectDatabase();
  const indexes = await initIndexes();
  const transactions = await supportsTransactions();
  // eslint-disable-next-line no-console
  console.log(
    `[musiku+] MongoDB Atlas connected; indexes ready for ${indexes.created} models` +
      (indexes.failures.length ? ` (${indexes.failures.length} index failures)` : '') +
      `; transactions ${transactions ? 'supported' : 'NOT supported (single-node deployment)'}`,
  );
  if (indexes.failures.length > 0) {
    await auditService.event('warn', 'startup', 'Index initialization reported failures', { failures: indexes.failures });
  }
  if (!transactions) {
    await auditService.event('warn', 'startup', 'Multi-document transactions unavailable', {
      hint: 'Atlas replica set required for payment activation atomicity',
    });
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[musiku+] API listening on :${env.PORT} (${env.NODE_ENV})`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[musiku+] ${signal} received, shutting down...`);

    const forceExit = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error('[musiku+] graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref?.();

    server.close(async () => {
      try {
        await disconnectDatabase();
        // eslint-disable-next-line no-console
        console.log('[musiku+] shutdown complete');
        process.exit(0);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[musiku+] error while closing database:', (error as Error).message);
        process.exit(1);
      }
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => {
    // eslint-disable-next-line no-console
    console.error('[musiku+] unhandled rejection:', (err as Error)?.message ?? err);
    void auditService.event('error', 'process', 'Unhandled rejection', { message: String((err as Error)?.message ?? err) });
  });
  process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    console.error('[musiku+] uncaught exception:', err.message);
    void auditService.event('error', 'process', 'Uncaught exception', { message: err.message }).finally(() => {
      void shutdown('uncaughtException');
    });
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[musiku+] Fatal startup error:', (err as Error).message);
  process.exit(1);
});
