import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { connectMongo, disconnectMongo, pingMongo } from '../../src/db/connect.js';
import { createReadinessService } from '../../src/modules/health/health.service.js';
import { captureLogger } from '../helpers/logger.js';

// Real MongoDB (single-node replica set, as in Docker) via mongodb-memory-server.
let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replSet.stop();
});

describe('connectMongo / pingMongo', () => {
  it('connects to a replica set, logs it, and answers ping', async () => {
    const { logger, lines } = captureLogger();
    const connection = await connectMongo(replSet.getUri('straight_salon'), logger);

    await expect(pingMongo(connection)).resolves.toBeUndefined();
    expect(lines().some((l) => l.component === 'mongo' && l.msg === 'MongoDB connected')).toBe(
      true,
    );
    // The URI (which can contain credentials) never appears in the logs.
    expect(JSON.stringify(lines())).not.toContain(replSet.getUri());
  });

  it('GET /health/ready is 200 against a live MongoDB even when Redis is down (degraded)', async () => {
    const { logger } = captureLogger();
    const connection = await connectMongo(replSet.getUri('straight_salon'), logger);
    const readiness = createReadinessService(
      {
        mongo: { critical: true, check: () => pingMongo(connection) },
        redis: { critical: false, check: () => Promise.reject(new Error('ECONNREFUSED')) },
      },
      logger,
    );

    const res = await request(createApp({ readiness })).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'degraded',
      checks: { mongo: { status: 'up' }, redis: { status: 'down' } },
    });
  });

  it('ping fails once disconnected', async () => {
    const { logger, lines } = captureLogger();
    const connection = await connectMongo(replSet.getUri('straight_salon'), logger);
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
