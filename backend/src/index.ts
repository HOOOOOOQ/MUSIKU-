import { createApp } from './app';
import { connectDatabase, disconnectDatabase, initIndexes } from './config/database';
import { env } from './config/env';
import { auditService } from './services/auditService';

async function main(): Promise<void> {
  await connectDatabase();
  await initIndexes();
  // eslint-disable-next-line no-console
  console.log('[musiku+] MongoDB Atlas connected, indexes initialized');

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[musiku+] API listening on :${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`[musiku+] ${signal} received, shutting down...`);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => {
    void auditService.event('error', 'process', 'Unhandled rejection', { message: String(err) });
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[musiku+] Fatal startup error:', err);
  process.exit(1);
});
