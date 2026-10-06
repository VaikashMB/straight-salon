import { connectMongo, disconnectMongo } from './db/connect.js';
import { closeRedis, createRedisClient } from './shared/cache/redis.js';
import { createProcessLogger, loadEnvOrExit, registerShutdown } from './shared/lifecycle/index.js';

// Worker process (01-architecture §1). Phase 1 skeleton: connects to Mongo and Redis so the
// container topology is real. The outbox relay (Phase 2) and queue consumers and scheduled
// jobs (Phase 6) are registered here later.
const env = loadEnvOrExit('worker');
if (!env) process.exit(1);

const logger = createProcessLogger(env, 'worker');

await connectMongo(env.MONGO_URI, logger).catch((err: unknown) => {
  logger.fatal({ err }, 'Cannot connect to MongoDB at startup; exiting');
  process.exit(1);
});
const redis = createRedisClient(env.REDIS_URL, logger);

logger.info('Worker started (no consumers registered yet)');

registerShutdown(logger, [
  { name: 'redis', run: () => closeRedis(redis) },
  { name: 'mongo', run: disconnectMongo },
]);
