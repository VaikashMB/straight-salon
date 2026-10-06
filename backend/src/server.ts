import type { Server } from 'node:http';
import { createApp } from './app.js';
import { connectMongo, disconnectMongo, pingMongo } from './db/connect.js';
import { createReadinessService } from './modules/health/health.service.js';
import { closeRedis, createRedisClient, pingRedis } from './shared/cache/redis.js';
import { createProcessLogger, loadEnvOrExit, registerShutdown } from './shared/lifecycle/index.js';

const env = loadEnvOrExit('api');
if (!env) process.exit(1);

const logger = createProcessLogger(env, 'api');

const mongoConnection = await connectMongo(env.MONGO_URI, logger).catch((err: unknown) => {
  logger.fatal({ err }, 'Cannot connect to MongoDB at startup; exiting');
  process.exit(1);
});
const redis = createRedisClient(env.REDIS_URL, logger);

const readiness = createReadinessService(
  {
    mongo: { critical: true, check: () => pingMongo(mongoConnection) },
    redis: { critical: false, check: () => pingRedis(redis) },
  },
  logger,
);

const server: Server = createApp({ readiness }).listen(env.PORT, (err?: Error) => {
  if (err) {
    logger.fatal({ err }, 'API failed to start');
    process.exit(1);
  }
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'API listening');
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
