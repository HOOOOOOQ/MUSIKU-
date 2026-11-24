import mongoose from 'mongoose';
import { env, redactMongoUri } from './env';

/**
 * MongoDB Atlas connection management.
 *
 * - Atlas is the only primary database; the connection string never leaves the
 *   backend process (it is redacted before any log line).
 * - TLS is enforced by the `mongodb+srv://` scheme (validated at startup for
 *   production) and by Atlas itself.
 * - Connection pooling is explicit (`maxPoolSize`/`minPoolSize`).
 * - Startup retries with capped exponential backoff so a transient Atlas or
 *   network problem does not produce an uncontrolled crash loop, while a
 *   permanently bad configuration still fails loudly.
 * - `mongoose` auto-reconnects after a drop; lifecycle events are logged and
 *   surfaced through `databaseHealth()`.
 */

export interface ConnectOptions {
  /** Skip the startup retry loop (used by scripts and tests). */
  attempts?: number;
  /** Override the database name (used by the isolated CI test database). */
  dbName?: string;
  /** Connection timeout override in ms. */
  serverSelectionTimeoutMS?: number;
  onRetry?: (attempt: number, delayMs: number, message: string) => void;
}

const MONGOOSE_POOL_OPTIONS = {
  maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
  minPoolSize: env.MONGODB_MIN_POOL_SIZE,
  serverSelectionTimeoutMS: env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
  socketTimeoutMS: 45_000,
  heartbeatFrequencyMS: 10_000,
  retryWrites: true,
  retryReads: true,
  family: 4 as const,
};

let listenersAttached = false;

function attachLifecycleListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  mongoose.connection.on('error', (err) => {
    // Message only: never the connection string.
    // eslint-disable-next-line no-console
    console.error('[mongo] connection error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    // eslint-disable-next-line no-console
    console.warn('[mongo] disconnected (driver will keep retrying)');
  });
  mongoose.connection.on('reconnected', () => {
    // eslint-disable-next-line no-console
    console.log('[mongo] reconnected');
  });
}

export async function connectDatabase(options: ConnectOptions = {}): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  attachLifecycleListeners();
  mongoose.set('strictQuery', true);

  const dbName = options.dbName ?? env.MONGODB_DB_NAME;
  const connectOptions = {
    ...MONGOOSE_POOL_OPTIONS,
    dbName,
    serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? MONGOOSE_POOL_OPTIONS.serverSelectionTimeoutMS,
  };

  const attempts = Math.max(1, options.attempts ?? 5);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await mongoose.connect(env.MONGODB_URI, connectOptions);
      // eslint-disable-next-line no-console
      console.log(`[mongo] connected to database "${dbName}" via ${redactMongoUri(env.MONGODB_URI)}`);
      return mongoose;
    } catch (error) {
      lastError = error;
      const message = (error as Error).message ?? String(error);
      if (attempt === attempts) break;
      // Capped exponential backoff: 1s, 2s, 4s, 8s (max 8s).
      const delayMs = Math.min(8_000, 1_000 * 2 ** (attempt - 1));
      options.onRetry?.(attempt, delayMs, message);
      // eslint-disable-next-line no-console
      console.warn(`[mongo] connection attempt ${attempt}/${attempts} failed (${message}); retrying in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('MongoDB connection failed');
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
}

export interface DatabaseHealth {
  status: 'ok' | 'error';
  latencyMs: number;
  readyState: number;
  database: string;
  message?: string;
}

export async function databaseHealth(): Promise<DatabaseHealth> {
  const start = Date.now();
  const readyState = mongoose.connection.readyState;
  const database = mongoose.connection.name || env.MONGODB_DB_NAME;
  try {
    if (!mongoose.connection.db) throw new Error('no database handle');
    await mongoose.connection.db.admin().ping();
    return { status: 'ok', latencyMs: Date.now() - start, readyState, database };
  } catch (err) {
    return { status: 'error', latencyMs: Date.now() - start, readyState, database, message: (err as Error).message };
  }
}

/**
 * Create all indexes declared on models. Idempotent and safe to run repeatedly.
 * A failure on one model does not abort the others; the collected problems are
 * returned so startup can report them without hiding a partial initialization.
 */
export async function initIndexes(): Promise<{ created: number; failures: string[] }> {
  // Importing the models module registers every schema + index.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const models = require('../models') as Record<string, { init?: () => Promise<unknown>; modelName?: string }>;
  let created = 0;
  const failures: string[] = [];
  await Promise.all(
    Object.values(models).map(async (model) => {
      if (typeof model?.init !== 'function') return;
      try {
        await model.init();
        created += 1;
      } catch (error) {
        failures.push(`${model.modelName ?? 'model'}: ${(error as Error).message}`);
      }
    }),
  );
  return { created, failures };
}

/** True when the deployment supports multi-document transactions (replica set). */
export async function supportsTransactions(): Promise<boolean> {
  try {
    const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
    return Boolean(hello?.setName || hello?.hosts?.length);
  } catch {
    return false;
  }
}
