import type { Server } from 'node:http';
import { createApp } from './app.js';
import { connectMongo, disconnectMongo, pingMongo } from './db/connect.js';
import { runMigrations } from './db/migrate.js';
import { buildApiRouter } from './modules/index.js';
import { createReadinessService } from './modules/health/health.service.js';
import { closeRedis, createRedisClient, pingRedis } from './shared/cache/redis.js';
import { outboxRepository } from './shared/events/outbox.repository.js';
import { createProcessLogger, loadEnvOrExit, registerShutdown } from './shared/lifecycle/index.js';
import { createMetrics } from './shared/metrics/index.js';
import { createLocalStorage } from './shared/storage/objectStorage.js';
import { systemClock } from './shared/time/clock.js';

const env = loadEnvOrExit('api');
if (!env) process.exit(1);

const logger = createProcessLogger(env, 'api');
// Config summary without secrets (07 §1.5).
logger.info(
  {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    corsOrigins: env.CORS_ORIGINS,
    cacheEnabled: env.CACHE_ENABLED,
    swaggerEnabled: env.SWAGGER_ENABLED,
    metricsEnabled: env.METRICS_ENABLED,
    migrateOnStart: env.MIGRATE_ON_START,
    cookieSecure: env.COOKIE_SECURE,
    uploadsDir: env.UPLOADS_DIR,
  },
  'Starting API',
);

if (env.MIGRATE_ON_START) {
  await runMigrations(env.MONGO_URI, logger).catch((err: unknown) => {
    logger.fatal({ err }, 'Migrations failed at startup; exiting');
    process.exit(1);
  });
}

const mongoConnection = await connectMongo(env.MONGO_URI, logger).catch((err: unknown) => {
  logger.fatal({ err }, 'Cannot connect to MongoDB at startup; exiting');
  process.exit(1);
});
const redis = createRedisClient(env.REDIS_URL, logger);

const metrics = createMetrics();
metrics.registerGauge('outbox_pending_events', 'Outbox events not yet published', () =>
  outboxRepository.countPending(),
);

const readiness = createReadinessService(
  {
    mongo: { critical: true, check: () => pingMongo(mongoConnection) },
    redis: { critical: false, check: () => pingRedis(redis) },
  },
  logger,
);

const app = createApp({
  logger,
  readiness,
  metrics,
  config: {
    version: env.APP_VERSION,
    corsOrigins: env.CORS_ORIGINS,
    swaggerEnabled: env.SWAGGER_ENABLED,
    metricsEnabled: env.METRICS_ENABLED,
    uploadsDir: env.UPLOADS_DIR,
  },
  apiRouter: buildApiRouter({
    connection: mongoConnection,
    redis,
    clock: systemClock,
    logger,
    metrics,
    storage: createLocalStorage({ dir: env.UPLOADS_DIR, publicUrl: env.UPLOADS_PUBLIC_URL }),
    config: {
      accessToken: {
        secret: env.JWT_ACCESS_SECRET,
        ttl: env.JWT_ACCESS_TTL,
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
      },
      refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      bcryptCost: env.BCRYPT_COST,
      cookies: { secure: env.COOKIE_SECURE, domain: env.COOKIE_DOMAIN },
      outboxEncryptionKey: env.OUTBOX_ENCRYPTION_KEY,
      rateLimit: { windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX },
      cacheEnabled: env.CACHE_ENABLED,
    },
  }),
});

const server: Server = app.listen(env.PORT, (err?: Error) => {
  if (err) {
    logger.fatal({ err }, 'API failed to start');
    process.exit(1);
  }
  logger.info({ port: env.PORT }, 'API listening');
});

registerShutdown(logger, [
  { name: 'readiness', run: () => readiness.markShuttingDown() },
  {
    name: 'http',
    run: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  },
  { name: 'redis', run: () => closeRedis(redis) },
  { name: 'mongo', run: disconnectMongo },
]);
