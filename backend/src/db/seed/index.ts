import { buildServices, servicesConfigFromEnv } from '../../modules/index.js';
import { closeRedis, createRedisClient } from '../../shared/cache/redis.js';
import { createProcessLogger, loadEnvOrExit } from '../../shared/lifecycle/index.js';
import { createMetrics } from '../../shared/metrics/index.js';
import { createObjectStorage } from '../../shared/storage/objectStorage.js';
import { systemClock } from '../../shared/time/clock.js';
import { connectMongo, disconnectMongo } from '../connect.js';
import { runMigrations } from '../migrate.js';
import { seedDatabase, seedDerivedData } from './seed.js';

// `npm run db:seed` (02 §3). Idempotent: existing records are left alone. Writes directly (no
// audit rows): seed data is not a business action. Refuses to run in production.

const env = loadEnvOrExit('api');
if (!env) process.exit(1);
const logger = createProcessLogger(env, 'api');

if (env.NODE_ENV === 'production') {
  logger.fatal('Refusing to seed: NODE_ENV=production');
  process.exit(1);
}

try {
  await runMigrations(env.MONGO_URI, logger);
  const connection = await connectMongo(env.MONGO_URI, logger);
  // Demo photos ship with the frontend (public/demo), so every way of running the seed (host,
  // container, CI) points at the same files.
  await seedDatabase({
    logger,
    bcryptCost: env.BCRYPT_COST,
    photoBaseUrl: `${env.APP_BASE_URL}/demo`,
  });
  // Redis only for clearing caches the recompute touches; a Redis outage does not stop it.
  const redis = createRedisClient(env.REDIS_URL, logger);
  const services = buildServices({
    connection,
    redis,
    clock: systemClock,
    logger,
    metrics: createMetrics({ defaultMetrics: false }),
    storage: createObjectStorage(env),
    config: servicesConfigFromEnv(env),
  });
  await seedDerivedData(services, logger);
  await closeRedis(redis);
  await disconnectMongo();
  process.exit(0);
} catch (err) {
  logger.fatal({ err }, 'Seed failed');
  process.exit(1);
}
