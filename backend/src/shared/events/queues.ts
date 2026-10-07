import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';
import { Router, type RequestHandler } from 'express';
import { Redis } from 'ioredis';
import type { Logger } from '../logger/index.js';
import { QUEUE_PREFIX } from './bullmqEventBus.js';
import { logConnectionErrors } from './connectionErrors.js';

// Read access to the BullMQ queues from the API process: job counts for /metrics (03 §6) and
// the Bull Board UI at /admin/queues (09 §5). The API never adds jobs here; publishing goes
// through the outbox relay.

export const QUEUES_BOARD_PATH = '/admin/queues';
export const QUEUE_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

export interface QueueInspector {
  readonly queues: Queue[];
  // Job counts per queue and state; empty if Redis does not answer within `timeoutMs`.
  counts(): Promise<{ labels: { queue: string; state: QueueState }; value: number }[]>;
  close(): Promise<void>;
}

export function createQueueInspector(deps: {
  redisUrl: string;
  queueNames: string[];
  logger: Logger;
  prefix?: string;
  timeoutMs?: number;
}): QueueInspector {
  const { prefix = QUEUE_PREFIX, timeoutMs = 1_000 } = deps;
  const connection = new Redis(deps.redisUrl, { maxRetriesPerRequest: null });
  const queues = deps.queueNames.map((name) => new Queue(name, { connection, prefix }));
  logConnectionErrors(deps.logger, 'queue-inspector', [connection, ...queues]);

  async function readCounts() {
    const perQueue = await Promise.all(
      queues.map(async (queue) => ({ queue, counts: await queue.getJobCounts(...QUEUE_STATES) })),
    );
    return perQueue.flatMap(({ queue, counts }) =>
      QUEUE_STATES.map((state) => ({
        labels: { queue: queue.name, state },
        value: counts[state] ?? 0,
      })),
    );
  }

  return {
    queues,
    async counts() {
      let timer: NodeJS.Timeout | undefined;
      // A metrics scrape must not hang while Redis is down (08 §1: the API keeps working).
      const timeout = new Promise<[]>((resolve) => {
        timer = setTimeout(() => resolve([]), timeoutMs);
      });
      try {
        return await Promise.race([readCounts().catch(() => [] as []), timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
    async close() {
      await Promise.all(queues.map((queue) => queue.close()));
      await connection.quit().catch(() => connection.disconnect());
    },
  };
}

// Bull Board behind `guard` (ADMIN-only, 09 §5). Failed jobs can be retried from the UI: the
// failed set is the dead-letter queue.
export function queuesBoardRouter(
  inspector: QueueInspector,
  guard: RequestHandler,
  basePath = QUEUES_BOARD_PATH,
): Router {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(basePath);
  createBullBoard({
    queues: inspector.queues.map((queue) => new BullMQAdapter(queue)),
    serverAdapter,
  });
  const router = Router();
  router.use(basePath, guard, serverAdapter.getRouter() as Router);
  return router;
}
