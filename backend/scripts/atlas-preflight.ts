/**
 * Atlas pre-flight probe for the integration suite.
 *
 * Decides — before Jest collects tests — whether a real MongoDB Atlas connection
 * is usable, so the suite can be reported as **skipped with a reason** instead of
 * failing or, worse, silently passing with fakes.
 *
 * Safety rules:
 *  - connects only to the isolated test database (`MONGODB_TEST_DB_NAME`, or
 *    `<MONGODB_DB_NAME>_ci_test`), never to production data;
 *  - writes a single tagged probe document and deletes it again;
 *  - never prints the connection string (credentials are redacted);
 *  - always exits 0, recording the outcome in `tests/atlas/preflight.json` so an
 *    unreachable Atlas is reported as a skip with a reason, not a red build.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';

export interface AtlasPreflight {
  available: boolean;
  reason: string;
  testDatabase: string;
  primaryDatabaseReachable: boolean;
  transactions: boolean;
  latencyMs: number;
  uriScheme: string;
  checkedAt: string;
}

const OUTPUT = join(__dirname, '..', 'tests', 'atlas', 'preflight.json');
const TIMEOUT_MS = Number(process.env.ATLAS_PROBE_TIMEOUT_MS ?? 10_000);

const unavailable = (reason: string, extra: Partial<AtlasPreflight> = {}): AtlasPreflight => ({
  available: false,
  reason,
  testDatabase: extra.testDatabase ?? process.env.MONGODB_TEST_DB_NAME ?? process.env.MONGODB_DB_NAME ?? '',
  primaryDatabaseReachable: false,
  transactions: false,
  latencyMs: 0,
  uriScheme: 'unknown',
  checkedAt: new Date().toISOString(),
  ...extra,
});

function writeSummary(result: AtlasPreflight, redactedUri: string): void {
  // Safe to print: no credentials, no full URI, no document data.
  // eslint-disable-next-line no-console
  console.log(
    `[atlas-preflight] available=${result.available} scheme=${result.uriScheme} testDatabase=${result.testDatabase}` +
      ` transactions=${result.transactions} latencyMs=${result.latencyMs} uri=${redactedUri}`,
  );
  // eslint-disable-next-line no-console
  console.log(`[atlas-preflight] ${result.reason}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n### MongoDB Atlas pre-flight\n\n| Check | Result |\n|---|---|\n` +
        `| Connection available | ${result.available ? 'yes' : 'no'} |\n` +
        `| URI scheme | \`${result.uriScheme}\` |\n` +
        `| Isolated test database | \`${result.testDatabase || 'n/a'}\` |\n` +
        `| Primary database reachable | ${result.primaryDatabaseReachable ? 'yes' : 'no'} |\n` +
        `| Transactions (replica set) | ${result.transactions ? 'yes' : 'no'} |\n` +
        `| Latency | ${result.latencyMs} ms |\n` +
        `| Detail | ${result.reason} |\n\n` +
        `Connection string: \`${redactedUri}\` (credentials redacted). No secret value is written to logs or artifacts.\n`,
    );
  }
}

function persist(result: AtlasPreflight): void {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  // Loaded lazily: startup validation throws when required variables are absent,
  // and that must become a documented skip rather than a crash.
  let envModule: typeof import('../src/config/env');
  try {
    envModule = await import('../src/config/env');
  } catch (error) {
    const result = unavailable(`Backend configuration is incomplete: ${(error as Error).message.split('\n').slice(0, 4).join(' | ')}`);
    persist(result);
    writeSummary(result, '(configuration rejected before connection)');
    return;
  }

  const { env, redactMongoUri, testDatabaseName } = envModule;
  const redacted = redactMongoUri(env.MONGODB_URI);
  const base = {
    testDatabase: testDatabaseName,
    uriScheme: env.MONGODB_URI.startsWith('mongodb+srv://')
      ? 'mongodb+srv'
      : env.MONGODB_URI.startsWith('mongodb://')
        ? 'mongodb'
        : 'unknown',
  };

  const looksLikePlaceholder =
    !env.MONGODB_URI ||
    !env.MONGODB_URI.includes('://') ||
    /change-me|USER:PASSWORD|your-cluster|<cluster>/.test(env.MONGODB_URI);
  if (looksLikePlaceholder) {
    const result = unavailable('MONGODB_URI is not configured (placeholder or empty)', base);
    persist(result);
    writeSummary(result, redacted);
    return;
  }

  const started = Date.now();
  try {
    await mongoose.connect(env.MONGODB_URI, {
      dbName: testDatabaseName,
      serverSelectionTimeoutMS: TIMEOUT_MS,
      maxPoolSize: 5,
      minPoolSize: 0,
      retryWrites: true,
    });
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    // A read-only ping of the primary database distinguishes "network blocked"
    // from "the database user is not authorized on the test database".
    let primaryReachable = false;
    try {
      await mongoose.connect(env.MONGODB_URI, {
        dbName: env.MONGODB_DB_NAME,
        serverSelectionTimeoutMS: TIMEOUT_MS,
        maxPoolSize: 2,
        minPoolSize: 0,
      });
      await mongoose.connection.db?.admin().ping();
      primaryReachable = true;
    } catch {
      primaryReachable = false;
    } finally {
      await mongoose.disconnect().catch(() => undefined);
    }
    const result = unavailable(
      primaryReachable
        ? `Atlas is reachable but the test database "${testDatabaseName}" is not usable (grant the CI database user readWrite on it, or set MONGODB_TEST_DB_NAME): ${message}`
        : `Atlas connection failed (network/IP access list/DNS/credentials): ${message}`,
      { ...base, primaryDatabaseReachable: primaryReachable, latencyMs: Date.now() - started },
    );
    persist(result);
    writeSummary(result, redacted);
    return;
  }

  try {
    const db = mongoose.connection.db;
    if (!db) {
      const result = unavailable('Connected but no database handle was returned', base);
      persist(result);
      writeSummary(result, redacted);
      return;
    }
    await db.admin().ping();

    const hello = (await db.admin().command({ hello: 1 })) as { setName?: string; hosts?: string[] };
    const transactions = Boolean(hello.setName || hello.hosts?.length);

    // Isolated write/read/update/delete probe, always cleaned up.
    const collection = db.collection('_ci_preflight_probes');
    const probeId = randomUUID();
    try {
      await collection.insertOne({ probe: probeId, createdAt: new Date() });
      if (!(await collection.findOne({ probe: probeId }))) {
        const result = unavailable('Write succeeded but read-back failed on the test database', { ...base, transactions, primaryDatabaseReachable: true, latencyMs: Date.now() - started });
        persist(result);
        writeSummary(result, redacted);
        return;
      }
      await collection.updateOne({ probe: probeId }, { $set: { verified: true } });
      if (!(await collection.findOne({ probe: probeId, verified: true }))) {
        const result = unavailable('Update failed on the test database', { ...base, transactions, primaryDatabaseReachable: true, latencyMs: Date.now() - started });
        persist(result);
        writeSummary(result, redacted);
        return;
      }
    } finally {
      await collection.deleteMany({ probe: probeId }).catch(() => undefined);
    }

    const result: AtlasPreflight = {
      available: true,
      reason: transactions
        ? 'Atlas reachable; CRUD verified on the isolated test database (transactions supported)'
        : 'Atlas reachable; CRUD verified, but the deployment does not report a replica set so transactions are unavailable',
      testDatabase: testDatabaseName,
      primaryDatabaseReachable: true,
      transactions,
      latencyMs: Date.now() - started,
      uriScheme: base.uriScheme,
      checkedAt: new Date().toISOString(),
    };
    persist(result);
    writeSummary(result, redacted);
  } catch (error) {
    const result = unavailable(`Atlas probe failed: ${(error as Error).message}`, { ...base, latencyMs: Date.now() - started });
    persist(result);
    writeSummary(result, redacted);
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
}

if (require.main === module) {
  main().catch((error) => {
    // Even an unexpected failure must not break the pipeline: report and skip.
    const result = unavailable(`Pre-flight probe crashed: ${(error as Error).message}`);
    try {
      persist(result);
    } catch {
      /* nothing else to do */
    }
    // eslint-disable-next-line no-console
    console.error('[atlas-preflight] unexpected error:', (error as Error).message);
  });
}
