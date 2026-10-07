import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { SCHEDULED_JOBS_QUEUE } from '../jobs/scheduler.js';
import { QUEUE_PREFIX } from '../shared/events/bullmqEventBus.js';
import { CONSUMER_SUBSCRIPTIONS } from '../shared/events/subscriptions.js';

// `npm run queues:retry-failed -- --queue=notifications` (09 §5): moves every job in a queue's
// failed set (the dead-letter queue) back to waiting, so the worker runs it again.

export const RETRYABLE_QUEUES = [...Object.keys(CONSUMER_SUBSCRIPTIONS), SCHEDULED_JOBS_QUEUE];

export class UnknownQueueError extends Error {
  constructor(readonly queue: string | undefined) {
    super(
      `Unknown queue "${queue ?? ''}". Use --queue=<name>, one of: ${RETRYABLE_QUEUES.join(', ')}`,
    );
    this.name = 'UnknownQueueError';
  }
}

export function parseQueueArg(argv: string[]): string {
  const value = argv
    .find((arg) => arg.startsWith('--queue='))
    ?.slice('--queue='.length)
    .trim();
  if (!value || !RETRYABLE_QUEUES.includes(value)) throw new UnknownQueueError(value);
  return value;
}

export async function retryFailedJobs(deps: {
  redisUrl: string;
  queue: string;
  prefix?: string;
}): Promise<{ retried: number }> {
  const connection = new Redis(deps.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(deps.queue, { connection, prefix: deps.prefix ?? QUEUE_PREFIX });
  try {
    const retried = await queue.getFailedCount();
    if (retried > 0) await queue.retryJobs({ state: 'failed' });
    return { retried };
  } finally {
    await queue.close();
    await connection.quit().catch(() => connection.disconnect());
  }
}
