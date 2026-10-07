import { buildServices, servicesConfigFromEnv } from '../modules/index.js';
import { closeRedis, createRedisClient } from '../shared/cache/redis.js';
import { createProcessLogger, loadEnvOrExit } from '../shared/lifecycle/index.js';
import { createMetrics } from '../shared/metrics/index.js';
import { createLocalStorage } from '../shared/storage/objectStorage.js';
import { systemClock } from '../shared/time/clock.js';
import { connectMongo, disconnectMongo } from './connect.js';
import { parseRebuildArgs, rebuildStats } from './statsRebuild.js';

// `npm run stats:rebuild [-- --from=YYYY-MM-DD --to=YYYY-MM-DD]` (dev, tsx) or
// `node dist/db/runStatsRebuild.js [...]` (image). Redis is only used to clear report caches;
// if it is down the rebuild still completes (08 §1).
const env = loadEnvOrExit('worker');
if (!env) process.exit(1);
const logger = createProcessLogger(env, 'worker');

try {
  const range = parseRebuildArgs(process.argv.slice(2));
  const connection = await connectMongo(env.MONGO_URI, logger);
  const redis = createRedisClient(env.REDIS_URL, logger);
  const services = buildServices({
    connection,
    redis,
    clock: systemClock,
    logger,
    metrics: createMetrics({ defaultMetrics: false }),
    storage: createLocalStorage({ dir: env.UPLOADS_DIR, publicUrl: env.UPLOADS_PUBLIC_URL }),
    config: servicesConfigFromEnv(env),
  });
  const result = await rebuildStats(services.reports, range);
  if (result) logger.info(result, 'daily_stats rebuilt');
  else logger.info('No bookings yet; nothing to rebuild');
  await closeRedis(redis);
  await disconnectMongo();
  process.exit(0);
} catch (err) {
  logger.fatal({ err }, 'Rebuilding daily_stats did not complete');
  process.exit(1);
}
