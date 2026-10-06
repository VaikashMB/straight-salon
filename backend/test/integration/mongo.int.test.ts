import mongoose from 'mongoose';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { connectMongo, disconnectMongo, pingMongo } from '../../src/db/connect.js';
import { captureLogger } from '../helpers/logger.js';

// Real MongoDB (single-node replica set, as in Docker) from test/setup/globalSetup.ts.
const uri = (): string => {
  const url = new URL(inject('mongoUri'));
  url.pathname = '/connect_probe';
  return url.toString();
};

afterAll(async () => {
  await mongoose.disconnect();
});

describe('connectMongo / pingMongo', () => {
  it('connects to a replica set, logs it, and answers ping', async () => {
    const { logger, lines } = captureLogger();
    const connection = await connectMongo(uri(), logger);

    await expect(pingMongo(connection)).resolves.toBeUndefined();
    expect(lines().some((l) => l.component === 'mongo' && l.msg === 'MongoDB connected')).toBe(
      true,
    );
    // The URI (which can contain credentials) never appears in the logs.
    expect(JSON.stringify(lines())).not.toContain(inject('mongoUri'));
  });

  it('enables sanitizeFilter, so injected operators become literal values (06 §4)', async () => {
    expect(mongoose.get('sanitizeFilter')).toBe(true);
    const Probe = mongoose.model<{ email: string }>(
      'Probe',
      new mongoose.Schema<{ email: string }>({ email: String }),
    );
    await Probe.create({ email: 'a@b.c' });
    // The injected operator is wrapped in $eq and then fails to cast: it never reaches MongoDB.
    await expect(Probe.findOne({ email: { $ne: 'nobody' } as unknown as string })).rejects.toThrow(
      /Cast to string/,
    );
    expect(await Probe.findOne({ email: mongoose.trusted({ $ne: 'nobody' }) })).not.toBeNull();
  });

  it('ping fails once disconnected', async () => {
    const { logger, lines } = captureLogger();
    const connection = await connectMongo(uri(), logger);
    await disconnectMongo();

    await expect(pingMongo(connection)).rejects.toThrow();
    expect(lines().some((l) => l.msg === 'MongoDB disconnected')).toBe(true);
  });

  it('ping rejects on a connection that was never opened', async () => {
    const neverOpened = { db: undefined } as unknown as Parameters<typeof pingMongo>[0];
    await expect(pingMongo(neverOpened)).rejects.toThrow('MongoDB is not connected');
  });

  it('rejects when no server is reachable', async () => {
    const { logger } = captureLogger();
    await expect(
      connectMongo('mongodb://127.0.0.1:1/straight_salon', logger, 300),
    ).rejects.toThrow();
  });
});
