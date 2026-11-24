import mongoose from 'mongoose';
import { env } from './env';

/**
 * MongoDB Atlas connection management.
 * - Connection pooling via poolSize options.
 * - TLS is enforced by the Atlas connection string (mongodb+srv).
 * - Health monitoring via mongoose connection events + `ping`.
 * - The connection string NEVER leaves the backend.
 */
export async function connectDatabase(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;

  mongoose.set('strictQuery', true);

  await mongoose.connect(env.MONGODB_URI, {
    dbName: env.MONGODB_DB_NAME,
    maxPoolSize: 20,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    family: 4,
  });

  mongoose.connection.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[mongo] connection error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    // eslint-disable-next-line no-console
    console.warn('[mongo] disconnected');
  });

  return mongoose;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export async function databaseHealth(): Promise<{ status: string; latencyMs: number }> {
  const start = Date.now();
  try {
    if (!mongoose.connection.db) throw new Error('no db handle');
    await mongoose.connection.db.admin().ping();
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'error', latencyMs: Date.now() - start };
  }
}

/** Create all indexes declared on models. Called at startup (idempotent). */
export async function initIndexes(): Promise<void> {
  // Importing the models module registers every schema + index.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const models = require('../models');
  await Promise.all(Object.values(models).map((m: unknown) => {
    const model = m as { init?: () => Promise<unknown> };
    return typeof model.init === 'function' ? model.init() : Promise.resolve();
  }));
}
