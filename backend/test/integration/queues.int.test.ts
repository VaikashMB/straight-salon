import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { scheduledJobs } from '../../src/jobs/definitions.js';
import { startJobScheduler, type JobScheduler } from '../../src/jobs/scheduler.js';
import { buildServices } from '../../src/modules/index.js';
import { AuditLogModel } from '../../src/shared/audit/auditLog.model.js';
import { createBullMqEventBus } from '../../src/shared/events/bullmqEventBus.js';
import type { DomainEvent } from '../../src/shared/events/envelope.js';
import { outboxRepository } from '../../src/shared/events/outbox.repository.js';
import { createQueueInspector, queuesBoardRouter } from '../../src/shared/events/queues.js';
import { basicAuth } from '../../src/shared/http/basicAuth.js';
import { getRequestContext } from '../../src/shared/http/requestContext.js';
import { createMetrics } from '../../src/shared/metrics/index.js';
import { systemClock } from '../../src/shared/time/clock.js';
import { registerConsumers } from '../../src/workers/registerConsumers.js';
import { retryFailedJobs } from '../../src/workers/retryFailed.js';
import { buildDomainEvent } from '../factories/index.js';
import { createUser, TEST_PASSWORD } from '../helpers/auth.js';
import { connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { captureLogger } from '../helpers/logger.js';
import { createMemoryStorage } from '../helpers/storage.js';
import { buildTestApp, testModulesConfig } from '../setup/testApp.js';

// The worker's BullMQ side against a real Redis (ioredis-mock lacks BullMQ's Lua and blocking
// commands): job schedulers (09 §7), consumers on queues (09 §5) and Bull Board (09 §5).
// DB 14, so it never races redis.int.test.ts (DB 15) when files run in parallel.
const base = new URL(process.env.REDIS_TEST_URL ?? 'redis://127.0.0.1:6379/15');
base.pathname = '/14';
const REDIS_URL = base.toString();

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
  await connectTestDb();
});

afterAll(async () => {
  await redis.flushdb();
  redis.disconnect();
  await disconnectTestDb();
});

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const fakeBookings = {
  queueReminders: () => Promise.resolve(0),
  markNoShows: () => Promise.resolve(0),
};

describe('job scheduler (09 §7, BullMQ Job Schedulers)', () => {
  it('registers each job under a fixed id; restarting never duplicates; obsolete ones go', async () => {
    const { logger } = captureLogger();
    const queueName = `jobs-${randomUUID()}`;
    const jobs = scheduledJobs({
      bookings: fakeBookings,
      outbox: outboxRepository,
      clock: systemClock,
      logger,
    });
    const queue = new Queue(queueName, { connection: redis.duplicate(), prefix: 'ss' });
    await queue.upsertJobScheduler('stats-reconcile-old', { every: 60_000 }, { name: 'gone' });

    const start = () =>
      startJobScheduler({ redisUrl: REDIS_URL, jobs, timeZone: 'Asia/Kolkata', logger, queueName });
    await (await start()).close();
    const scheduler = await start(); // a restart, or a second replica
    try {
      const schedulers = await queue.getJobSchedulers();
      expect(schedulers.map((s) => s.key).sort()).toEqual(
        ['auto-no-show', 'outbox-cleanup', 'reminders-24h', 'reminders-2h'].sort(),
      );
      expect(schedulers.find((s) => s.key === 'outbox-cleanup')).toMatchObject({
        pattern: '0 3 * * *',
        tz: 'Asia/Kolkata',
      });
      expect(schedulers.find((s) => s.key === 'auto-no-show')).toMatchObject({ every: 300_000 });
    } finally {
      await scheduler.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });

  it('runs a due job in the worker, in its own context', async () => {
    const { logger, lines } = captureLogger();
    const queueName = `jobs-${randomUUID()}`;
    let context: ReturnType<typeof getRequestContext>;
    const run = vi.fn(() => {
      context = getRequestContext();
      return Promise.resolve({ marked: 2 });
    });
    let scheduler: JobScheduler | undefined;
    try {
      scheduler = await startJobScheduler({
        redisUrl: REDIS_URL,
        jobs: [{ id: 'tick', schedule: { every: 100 }, run }],
        timeZone: 'UTC',
        logger,
        queueName,
      });
      await waitFor(() => run.mock.calls.length > 0);
      expect(context!.requestId).toMatch(/^job-tick-/);
      await waitFor(() => lines().some((l) => l.msg === 'Scheduled job done'));
      expect(lines().find((l) => l.msg === 'Scheduled job done')).toMatchObject({
        job: 'tick',
        marked: 2,
      });
    } finally {
      await scheduler?.close();
      const queue = new Queue(queueName, { connection: redis.duplicate(), prefix: 'ss' });
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });
});

describe('consumers on BullMQ queues (09 §5, §6)', () => {
  it('a consumer handles an event once, even if the relay publishes it twice; failures retry', async () => {
    const { logger } = captureLogger();
    const prefix = `ss-${randomUUID().slice(0, 8)}`;
    const bus = createBullMqEventBus({
      redisUrl: REDIS_URL,
      logger,
      prefix,
      jobOptions: { attempts: 3, backoff: { type: 'fixed', delay: 20 } },
    });
    const seen: DomainEvent[] = [];
    const handler = vi
      .fn((event: DomainEvent) => {
        seen.push(event);
        return Promise.resolve();
      })
      .mockRejectedValueOnce(new Error('SMTP down'));
    registerConsumers(bus, { 'staff-notifications': handler }, { logger, clock: systemClock });
    try {
      const event = buildDomainEvent();
      await bus.publish(event);
      await bus.publish(event); // duplicate publish: same job id, dropped by BullMQ
      await waitFor(() => seen.length > 0);
      expect(handler).toHaveBeenCalledTimes(2); // one failure, one retry
      expect(seen.map((e) => e.eventId)).toEqual([event.eventId]);
    } finally {
      await bus.close();
    }
  });
});

describe('queues:retry-failed (09 §5 dead-letter queue)', () => {
  it('moves every failed job of a queue back to waiting', async () => {
    const prefix = `ss-${randomUUID().slice(0, 8)}`;
    const queue = new Queue('notifications', { connection: redis.duplicate(), prefix });
    try {
      await queue.add('a', {});
      await queue.add('b', {});
      // Fail both, as a worker would after the final attempt.
      const failing = new Worker('notifications', () => Promise.reject(new Error('SMTP down')), {
        connection: redis.duplicate({ maxRetriesPerRequest: null }),
        prefix,
      });
      await waitFor(async () => (await queue.getFailedCount()) === 2);
      await failing.close();

      expect(
        await retryFailedJobs({ redisUrl: REDIS_URL, queue: 'notifications', prefix }),
      ).toEqual({ retried: 2 });
      expect(await queue.getFailedCount()).toBe(0);
      expect(await queue.getWaitingCount()).toBe(2);
      expect(
        await retryFailedJobs({ redisUrl: REDIS_URL, queue: 'notifications', prefix }),
      ).toEqual({ retried: 0 });
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });
});

describe('queue inspector and Bull Board (03 §6, 09 §5)', () => {
  it('counts jobs per queue and state for /metrics', async () => {
    const name = `count-${randomUUID()}`;
    const queue = new Queue(name, { connection: redis.duplicate(), prefix: 'ss' });
    await queue.add('x', {});
    await queue.add('y', {}, { delay: 60_000 });
    const inspector = createQueueInspector({
      redisUrl: REDIS_URL,
      queueNames: [name],
      logger: captureLogger().logger,
    });
    try {
      expect(await inspector.counts()).toEqual([
        { labels: { queue: name, state: 'waiting' }, value: 1 },
        { labels: { queue: name, state: 'active' }, value: 0 },
        { labels: { queue: name, state: 'delayed' }, value: 1 },
        { labels: { queue: name, state: 'failed' }, value: 0 },
      ]);
    } finally {
      await inspector.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });

  it('gives up quickly when Redis does not answer, so /metrics never hangs', async () => {
    const { logger, lines } = captureLogger();
    const inspector = createQueueInspector({
      redisUrl: 'redis://127.0.0.1:1/0', // nothing listens there
      queueNames: ['notifications'],
      logger,
      timeoutMs: 50,
    });
    try {
      expect(await inspector.counts()).toEqual([]);
      // Connection errors go to the logger (once a minute), not raw to stderr.
      await waitFor(() =>
        lines().some((l) => l.msg?.toString().startsWith('Queue connection error')),
      );
      expect(
        lines().filter((l) => l.msg === 'Queue connection error; retrying in the background'),
      ).toHaveLength(1);
    } finally {
      await inspector.close().catch(() => undefined);
    }
  });

  it('is ADMIN-only via HTTP Basic: the email and password of an active admin', async () => {
    const { logger } = captureLogger();
    const services = buildServices({
      connection: mongoose.connection,
      redis,
      clock: systemClock,
      logger,
      metrics: createMetrics({ defaultMetrics: false }),
      storage: createMemoryStorage(),
      config: testModulesConfig(),
    });
    const inspector = createQueueInspector({
      redisUrl: REDIS_URL,
      queueNames: ['notifications', 'scheduled-jobs'],
      logger,
    });
    const { app } = buildTestApp({
      queuesBoard: queuesBoardRouter(
        inspector,
        basicAuth({
          realm: 'Straight Salon queues',
          verify: (email, password) => services.auth.verifyAdmin(email, password),
        }),
      ),
    });
    const admin = await createUser({ role: 'ADMIN', email: `admin-${randomUUID()}@example.com` });
    const customer = await createUser({ email: `cust-${randomUUID()}@example.com` });
    try {
      const anonymous = await request(app).get('/admin/queues');
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers['www-authenticate']).toContain(
        'Basic realm="Straight Salon queues"',
      );

      const page = await request(app).get('/admin/queues').auth(admin.email!, TEST_PASSWORD);
      expect(page.status).toBe(200);
      expect(page.text).toContain('__UI_CONFIG__');
      const api = await request(app)
        .get('/admin/queues/api/queues')
        .auth(admin.email!, TEST_PASSWORD);
      expect(api.status).toBe(200);
      expect(JSON.stringify(api.body)).toContain('scheduled-jobs');

      // A customer's own valid password is not enough; the attempt is audited.
      expect(
        (await request(app).get('/admin/queues').auth(customer.email!, TEST_PASSWORD)).status,
      ).toBe(401);
      expect(
        await AuditLogModel.findOne({ entityId: customer._id.toHexString() }).lean(),
      ).toMatchObject({
        action: 'auth.login_failed',
        metadata: { channel: 'queues-board', reason: 'not_admin' },
      });

      // 06 §2 lockout applies: after 5 failures the account is locked for 15 minutes.
      for (let i = 0; i < 4; i++) {
        await request(app).get('/admin/queues').auth(customer.email!, 'wrong').expect(401);
      }
      expect(
        (await request(app).get('/admin/queues').auth(customer.email!, TEST_PASSWORD)).status,
      ).toBe(429);
    } finally {
      await inspector.close();
    }
  });
});
