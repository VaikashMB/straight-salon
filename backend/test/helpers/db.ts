import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { inject } from 'vitest';
import { connectMongo } from '../../src/db/connect.js';
import { captureLogger } from './logger.js';

// Connects the shared mongoose connection to a fresh database on the run's replica set, so test
// files running in parallel never see each other's data.
export async function connectTestDb(): Promise<mongoose.Connection> {
  const uri = new URL(inject('mongoUri'));
  uri.pathname = `/test_${randomUUID().slice(0, 8)}`;
  const connection = await connectMongo(uri.toString(), captureLogger('info').logger);
  // Build indexes up front: transactions cannot create them and unique constraints matter.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  return connection;
}

export async function disconnectTestDb(): Promise<void> {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

// Deletes every document but keeps collections and indexes.
export async function clearCollections(): Promise<void> {
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
}
