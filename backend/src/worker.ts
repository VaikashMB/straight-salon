import { connectMongo, disconnectMongo } from './db/connect.js';
import { scheduledJobs } from './jobs/definitions.js';
import { startJobScheduler } from './jobs/scheduler.js';
import { buildServices, servicesConfigFromEnv } from './modules/index.js';
import { createNotificationSender } from './modules/notifications/notifications.sender.js';
import { notificationsRepository } from './modules/notifications/notifications.repository.js';
import { createProviders } from './modules/notifications/providers/index.js';
import { closeRedis, createRedisClient } from './shared/cache/redis.js';
import { createBullMqEventBus } from './shared/events/bullmqEventBus.js';
import { outboxRepository } from './shared/events/outbox.repository.js';
import {
  createProcessLogger,
  loadEnvOrExit,
  registerShutdown,
  type ShutdownStep,
} from './shared/lifecycle/index.js';
import { createMetrics } from './shared/metrics/index.js';
import { createLocalStorage } from './shared/storage/objectStorage.js';
import { systemClock } from './shared/time/clock.js';
import { buildConsumerHandlers } from './workers/consumers/index.js';
import { startOutboxRelay } from './workers/outboxRelay.js';
import { registerConsumers } from './workers/registerConsumers.js';

// Worker process (01-architecture §1): queue consumers (09 §5), scheduled jobs (09 §7) and,
// when RUN_RELAY_IN_WORKER=true, the outbox relay. No HTTP server.
const env = loadEnvOrExit('worker');
if (!env) process.exit(1);

const logger = createProcessLogger(env, 'worker');
const clock = systemClock;

const connection = await connectMongo(env.MONGO_URI, logger).catch((err: unknown) => {
  logger.fatal({ err }, 'Cannot connect to MongoDB at startup; exiting');
  process.exit(1);
});
// App-style client for the cache (consumers invalidate tags); BullMQ opens its own connections.
const redis = createRedisClient(env.REDIS_URL, logger);

const services = buildServices({
  connection,
  redis,
  clock,
  logger,
  metrics: createMetrics({ defaultMetrics: false }), // not exposed: the worker has no HTTP port
  storage: createLocalStorage({ dir: env.UPLOADS_DIR, publicUrl: env.UPLOADS_PUBLIC_URL }),
  config: servicesConfigFromEnv(env),
});

const providers = createProviders(
  {
    email: env.EMAIL_PROVIDER,
    sms: env.SMS_PROVIDER,
    ...(env.SMTP_HOST
      ? {
          smtp: {
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            user: env.SMTP_USER,
            pass: env.SMTP_PASS,
            from: env.EMAIL_FROM,
          },
        }
      : {}),
  },
  logger,
);
const sender = createNotificationSender({
  repository: notificationsRepository,
  ...providers,
  clock,
  logger,
});

const bus = createBullMqEventBus({ redisUrl: env.REDIS_URL, logger });
const consumers = registerConsumers(
  bus,
  buildConsumerHandlers({
    services,
    sender,
    appBaseUrl: env.APP_BASE_URL,
    encryptionKey: env.OUTBOX_ENCRYPTION_KEY,
    logger,
  }),
  { logger, clock },
);

// Cron patterns run in the salon timezone as configured at start (restart after changing it).
const { timezone } = await services.settings.get();
const scheduler = await startJobScheduler({
  redisUrl: env.REDIS_URL,
  jobs: scheduledJobs({
    bookings: services.bookings,
    outbox: outboxRepository,
    reports: services.reports,
    clock,
    logger,
  }),
  timeZone: timezone,
  logger,
}).catch((err: unknown) => {
  logger.fatal({ err }, 'Cannot register scheduled jobs; exiting');
  process.exit(1);
});

const steps: ShutdownStep[] = [];
if (env.RUN_RELAY_IN_WORKER) {
  const { relay } = startOutboxRelay(env, logger, bus);
  steps.push({ name: 'relay', run: () => relay.stop() });
}
// Workers finish their current job before closing (03 §7).
steps.push(
  { name: 'scheduler', run: () => scheduler.close() },
  { name: 'event-bus', run: () => bus.close() },
  { name: 'email-provider', run: () => providers.email.close() },
  { name: 'sms-provider', run: () => providers.sms.close() },
  { name: 'redis', run: () => closeRedis(redis) },
  { name: 'mongo', run: disconnectMongo },
);

logger.info(
  {
    consumers,
    relay: env.RUN_RELAY_IN_WORKER,
    emailProvider: providers.email.name,
    smsProvider: providers.sms.name,
  },
  'Worker started',
);
registerShutdown(logger, steps);
