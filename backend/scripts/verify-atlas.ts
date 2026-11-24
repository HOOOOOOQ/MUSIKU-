import { connectDatabase, disconnectDatabase, initIndexes, databaseHealth, supportsTransactions } from '../src/config/database';
import { env } from '../src/config/env';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
async function verify() {
  // With MONGODB_TEST_DB_NAME set (as in CI) the probe runs against an isolated
  // database instead of the configured one.
  await connectDatabase({ dbName: env.MONGODB_TEST_DB_NAME || env.MONGODB_DB_NAME, attempts: 2 });
  try {
    const indexes = await initIndexes();
    if (indexes.failures.length > 0) console.warn('Index failures:', indexes.failures);
    console.log('Transactions supported:', await supportsTransactions());
    if ((await databaseHealth()).status !== 'ok') throw new Error('Atlas ping failed');
    const db = mongoose.connection.db!;
    const collection = db.collection('_integration_probes');
    const id = randomUUID();
    try {
      await collection.insertOne({ probe: id, createdAt: new Date() });
      if (!(await collection.findOne({ probe: id }))) throw new Error('Read failed');
      await collection.updateOne({ probe: id }, { $set: { verified: true } });
      if (!(await collection.findOne({ probe: id, verified: true }))) throw new Error('Update failed');
    } finally { await collection.deleteMany({ probe: id }); }
    console.log('PASS Atlas ping, model index initialization, isolated CRUD probe and cleanup');
  } finally { await disconnectDatabase(); }
}
verify().catch(error => { console.error(error.message); process.exitCode = 1; });
