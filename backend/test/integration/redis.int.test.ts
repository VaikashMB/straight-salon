import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCache } from '../../src/shared/cache/cache.js';
import { cacheKeys, cacheTags } from '../../src/shared/cache/keys.js';
import { createBullMqEventBus, QUEUE_PREFIX } from '../../src/shared/events/bullmqEventBus.js';
import type { DomainEvent } from '../../src/shared/events/envelope.js';
import { getRequestContext, type RequestContext } from '../../src/shared/http/requestContext.js';
import { createRedisLock } from '../../src/shared/locks/redisLock.js';
import { createMetrics } from '../../src/shared/metrics/index.js';
import { parseEnv } from '../../src/config/env.js';
import { createOutbox } from '../../src/shared/events/outbox.js';
import { outboxRepository } from '../../src/shared/events/outbox.repository.js';
import { withTransaction } from '../../src/shared/db/withTransaction.js';
import { startOutboxRelay } from '../../src/workers/outboxRelay.js';
import { buildBookingCreatedPayload, buildDomainEvent, encryptionKey } from '../factories/index.js';
import { connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { captureLogger } from '../helpers/logger.js';

// Needs a real Redis (BullMQ uses Lua and blocking commands that ioredis-mock does not support).
// Locally: `docker compose up -d redis`. CI provides a redis service (12 §3). DB 15 keeps test
// data away from the dev database.
const REDIS_URL = process.env.REDIS_TEST_URL ?? 'redis://127.0.0.1:6379/15';

let redis: Redis;

beforeAll(async () => {
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
  } catch {
    throw new Error(
      `Redis is required for this test at ${REDIS_URL}. Start it with: docker compose up -d redis`,
    );
  }
  await redis.flushdb();
});

afterAll(async () => {
  await redis.flushdb();
  await redis.quit();
});

describe('cache tag TTL on real Redis 7 (EXPIRE NX/GT)', () => {
  it('a tag set lives as long as its longest-lived member', async () => {
    const cache = createCache({
      redis,
      enabled: true,
      logger: captureLogger().logger,
      metrics: createMetrics({ defaultMetrics: false }),
    });
    await cache.cacheAside(cacheKeys.service('long'), 1800, () => Promise.resolve(1), {
      tags: [cacheTags.catalog],
    });
    await cache.cacheAside(cacheKeys.service('short'), 600, () => Promise.resolve(2), {
      tags: [cacheTags.catalog],
    });
    expect(await redis.ttl(cacheKeys.tag(cacheTags.catalog))).toBeGreaterThan(1790);
  });
});

describe('redis lock on real Redis', () => {
  it('second acquirer fails; release requires the token', async () => {
    const lock = createRedisLock({ redis });
    const key = cacheKeys.staffDayLock('st1', '2026-10-12');
    const token = await lock.acquire(key);
    expect(await lock.acquire(key, { retries: 1, retryDelayMs: 1 })).toBeNull();
    expect(await lock.release(key, 'wrong')).toBe(false);
    expect(await lock.release(key, token!)).toBe(true);
    expect(await lock.acquire(key)).not.toBeNull();
  });
});

describe('BullMQ EventBus (09 §5)', () => {
  const subscriptions = {
    'it-stats': ['booking.created'],
    'it-ratings': ['review.created'],
  } as const;

  it('fans out to the subscribed consumer queues, deduplicates by eventId, and runs handlers in the event context', async () => {
    const { logger } = captureLogger();
    const publisher = createBullMqEventBus({ redisUrl: REDIS_URL, logger, subscriptions });
    const consumer = createBullMqEventBus({ redisUrl: REDIS_URL, logger, subscriptions });

    const received: { event: DomainEvent; context: RequestContext | undefined }[] = [];
    const ratings = vi.fn(() => Promise.resolve());
    consumer.subscribe('it-stats', ['booking.created'], (event) => {
      received.push({ event, context: getRequestContext() });
      return Promise.resolve();
    });
    consumer.subscribe('it-ratings', ['review.created'], ratings);

    const event = buildDomainEvent();
    await publisher.publish(event);
    await publisher.publish(event); // duplicate publish (at-least-once relay)

    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 10_000 });
    expect(received[0]?.event).toEqual(event);
    expect(received[0]?.context).toMatchObject({
      requestId: event.correlationId,
      jobId: event.eventId,
      queue: 'it-stats',
      eventType: 'booking.created',
    });

    const statsQueue = new Queue('it-stats', { connection: redis, prefix: QUEUE_PREFIX });
    const ratingsQueue = new Queue('it-ratings', { connection: redis, prefix: QUEUE_PREFIX });
    expect(await statsQueue.getJob(event.eventId)).toBeDefined();
    const counts = await ratingsQueue.getJobCounts();
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(0);
    expect(ratings).not.toHaveBeenCalled();

    await statsQueue.close();
    await ratingsQueue.close();
    await consumer.close();
    await publisher.close();
  });

  it('retries a failing handler with the configured attempts, logging each failure', async () => {
    const { logger, lines } = captureLogger();
    const bus = createBullMqEventBus({
      redisUrl: REDIS_URL,
      logger,
      subscriptions: { 'it-retry': ['booking.created'] },
    });
    let calls = 0;
    bus.subscribe('it-retry', ['booking.created'], () => {
      calls++;
      return calls === 1 ? Promise.reject(new Error('transient')) : Promise.resolve();
    });
    await bus.publish(buildDomainEvent());

    await vi.waitFor(() => expect(calls).toBe(2), { timeout: 15_000 }); // first retry after ~2 s backoff
    expect(lines().some((l) => l.msg === 'Job failed; will retry' && l.level === 'warn')).toBe(
      true,
    );
    await bus.close();
  });
});

describe('BullMQ EventBus edge cases', () => {
  it('logs an error when a job fails its final attempt (dead-letter, 09 §5)', async () => {
    const { logger, lines } = captureLogger();
    const bus = createBullMqEventBus({
      redisUrl: REDIS_URL,
      logger,
      subscriptions: { 'it-dlq': ['booking.created'] },
      jobOptions: { attempts: 1, removeOnFail: true },
    });
    bus.subscribe('it-dlq', ['booking.created'], () => Promise.reject(new Error('permanent')));
    await bus.publish(buildDomainEvent());

    await vi.waitFor(
      () =>
        expect(
          lines().some((l) => l.msg === 'Job failed after final attempt' && l.level === 'error'),
        ).toBe(true),
      {
        timeout: 10_000,
      },
    );
    await bus.close();
  });

  it('ignores events routed to a queue whose subscriber does not handle that type', async () => {
    const { logger } = captureLogger();
    const bus = createBullMqEventBus({
      redisUrl: REDIS_URL,
      logger,
      subscriptions: { 'it-mixed': ['booking.created', 'holiday.changed'] },
    });
    const handler = vi.fn(() => Promise.resolve());
    bus.subscribe('it-mixed', ['holiday.changed'], handler);
    const event = buildDomainEvent();
    await bus.publish(event);

    const queue = new Queue('it-mixed', { connection: redis, prefix: QUEUE_PREFIX });
    await vi.waitFor(async () => expect(await queue.getJobState(event.eventId)).toBe('completed'), {
      timeout: 10_000,
    });
    expect(handler).not.toHaveBeenCalled();
    await queue.close();
    await bus.close();
  });
});

describe('startOutboxRelay wiring: outbox -> relay -> BullMQ consumer queues (01 §1, 09 §4–5)', () => {
  beforeAll(async () => {
    await connectTestDb();
  });
  afterAll(disconnectTestDb);

  it('delivers a committed booking.created event into every subscribed consumer queue', async () => {
    const key = encryptionKey();
    const env = parseEnv({
      PORT: '4000',
      MONGO_URI: 'mongodb://unused',
      REDIS_URL,
      OUTBOX_ENCRYPTION_KEY: key,
      JWT_ACCESS_SECRET: 'x'.repeat(32),
      UPLOADS_PUBLIC_URL: 'http://localhost:4000/uploads',
      APP_BASE_URL: 'http://localhost:3000',
    });
    const { logger } = captureLogger();
    const { relay, bus } = startOutboxRelay(env, logger);

    const outbox = createOutbox({ repository: outboxRepository, encryptionKey: key });
    const payload = buildBookingCreatedPayload();
    const event = await withTransaction(mongoose.connection, (session) =>
      outbox.add(session, {
        type: 'booking.created',
        aggregateType: 'booking',
        aggregateId: payload.bookingId,
        payload,
      }),
    );

    const queues = ['notifications', 'staff-notifications', 'cache-invalidation', 'stats'].map(
      (name) => new Queue(name, { connection: redis, prefix: QUEUE_PREFIX }),
    );
    await vi.waitFor(
      async () => {
        for (const queue of queues) expect(await queue.getJob(event.eventId)).toBeDefined();
      },
      { timeout: 10_000 },
    );

    await relay.stop();
    await bus.close();
    await Promise.all(queues.map((q) => q.close()));
  });
});
