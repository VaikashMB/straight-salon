import { createProcessLogger, loadEnvOrExit } from '../shared/lifecycle/index.js';
import { parseQueueArg, retryFailedJobs } from './retryFailed.js';

// `npm run queues:retry-failed -- --queue=notifications` (dev, tsx) or
// `node dist/workers/runRetryFailed.js --queue=notifications` (image).
const env = loadEnvOrExit('worker');
if (!env) process.exit(1);
const logger = createProcessLogger(env, 'worker');

try {
  const queue = parseQueueArg(process.argv.slice(2));
  const { retried } = await retryFailedJobs({ redisUrl: env.REDIS_URL, queue });
  logger.info({ queue, retried }, 'Failed jobs moved back to waiting');
  process.exit(0);
} catch (err) {
  logger.fatal({ err }, 'Retrying failed jobs did not complete');
  process.exit(1);
}
