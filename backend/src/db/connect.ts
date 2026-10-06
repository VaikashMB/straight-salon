import mongoose, { type Connection } from 'mongoose';
import type { Logger } from '../shared/logger/index.js';

const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 10_000;

// NoSQL-injection defence in depth (06 §4): query filters treat user-supplied objects such as
// { $gt: "" } as literal values, and unknown filter paths are rejected.
mongoose.set('sanitizeFilter', true);
mongoose.set('strictQuery', true);

// Connects the shared Mongoose connection and logs each state change (07-logging §1.5).
// The URI is never logged: it can carry credentials.
export async function connectMongo(
  uri: string,
  logger: Logger,
  serverSelectionTimeoutMS = DEFAULT_SERVER_SELECTION_TIMEOUT_MS,
): Promise<Connection> {
  const log = logger.child({ component: 'mongo' });
  const connection = mongoose.connection;
  connection.on('connected', () => log.info('MongoDB connected'));
  connection.on('disconnected', () => log.warn('MongoDB disconnected'));
  connection.on('reconnected', () => log.info('MongoDB reconnected'));
  connection.on('error', (err: unknown) => log.error({ err }, 'MongoDB connection error'));

  await mongoose.connect(uri, { serverSelectionTimeoutMS });
  return connection;
}

export async function pingMongo(connection: Connection): Promise<void> {
  const db = connection.db;
  if (!db) {
    throw new Error('MongoDB is not connected');
  }
  await db.admin().ping();
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
