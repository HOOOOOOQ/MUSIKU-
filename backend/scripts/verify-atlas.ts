import { connectDatabase, disconnectDatabase, initIndexes, databaseHealth } from '../src/config/database';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
async function verify() {
  await connectDatabase();
  try {
    await initIndexes();
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
