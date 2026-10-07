import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import RedisMock from 'ioredis-mock';
import mongoose from 'mongoose';
import { createApp, type AppConfig } from '../../src/app.js';
import { buildApiRouter, type ModulesConfig } from '../../src/modules/index.js';
import type { ActiveBookingsGate } from '../../src/modules/bookings/bookings.gate.js';
import type { ReadinessReport, ReadinessService } from '../../src/modules/health/health.service.js';
import { createMetrics, type Metrics } from '../../src/shared/metrics/index.js';
import type { RedisLock } from '../../src/shared/locks/redisLock.js';
import type { ObjectStorage } from '../../src/shared/storage/objectStorage.js';
import { systemClock, type Clock } from '../../src/shared/time/clock.js';
import { encryptionKey } from '../factories/index.js';
import { captureLogger } from '../helpers/logger.js';
import { createMemoryStorage } from '../helpers/storage.js';

// Builds the real app with test dependencies (10-testing §3).

export const TEST_ACCESS_TOKEN = {
  secret: 'test-secret-that-is-at-least-32-characters-long',
  ttl: '15m',
  issuer: 'straight-salon-api',
  audience: 'straight-salon-web',
};

export function testModulesConfig(overrides: Partial<ModulesConfig> = {}): ModulesConfig {
  return {
    accessToken: TEST_ACCESS_TOKEN,
    refreshTokenTtlDays: 7,
    bcryptCost: 4, // fast hashes; only allowed with NODE_ENV=test in real config
    cookies: { secure: false },
    outboxEncryptionKey: encryptionKey(),
    rateLimit: { windowMs: 60_000, max: 10_000 },
    cacheEnabled: true,
    ...overrides,
  };
}

export function buildTestApp(
  overrides: {
    config?: Partial<AppConfig>;
    readiness?: ReadinessService;
    apiRouter?: Router;
    metrics?: Metrics;
  } = {},
) {
  const { logger, lines } = captureLogger();
  const metrics = overrides.metrics ?? createMetrics({ defaultMetrics: false });
  const readiness: ReadinessService = overrides.readiness ?? {
    check: () =>
      Promise.resolve<ReadinessReport>({
        status: 'ok',
        checks: { mongo: { status: 'up' }, redis: { status: 'up' } },
      }),
    markShuttingDown: () => undefined,
  };
  const app = createApp({
    logger,
    readiness,
    metrics,
    config: {
      version: '0.0.0-test',
      corsOrigins: ['http://localhost:3000'],
      swaggerEnabled: true,
      metricsEnabled: true,
      ...overrides.config,
    },
    apiRouter: overrides.apiRouter ?? Router(),
  });
  return { app, logs: lines, metrics };
}

// Full API on the test database (call connectTestDb first). Redis is in-memory and per app.
export function buildApiTestApp(
  options: {
    clock?: Clock;
    modules?: Partial<ModulesConfig>;
    redis?: InstanceType<typeof RedisMock>;
    storage?: ObjectStorage;
    bookingsGate?: ActiveBookingsGate;
    lock?: RedisLock;
    config?: Partial<AppConfig>;
  } = {},
) {
  // ioredis-mock instances share data per host; a unique host isolates each test app.
  const redis = options.redis ?? new RedisMock({ host: `test-${randomUUID()}` });
  const { logger, lines } = captureLogger();
  const metrics = createMetrics({ defaultMetrics: false });
  const storage = options.storage ?? createMemoryStorage();
  const apiRouter = buildApiRouter({
    connection: mongoose.connection,
    redis,
    clock: options.clock ?? systemClock,
    logger,
    metrics,
    storage,
    config: testModulesConfig(options.modules),
    ...(options.bookingsGate ? { bookingsGate: options.bookingsGate } : {}),
    ...(options.lock ? { lock: options.lock } : {}),
  });
  const built = buildTestApp({
    apiRouter,
    metrics,
    ...(options.config ? { config: options.config } : {}),
  });
  return { ...built, redis, storage, moduleLogs: lines };
}
