import { Queue, Worker, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { runWithContext } from '../http/requestContext.js';
import { logConnectionErrors } from './connectionErrors.js';
import type { Logger } from '../logger/index.js';
import type { DomainEvent } from './envelope.js';
import type { EventBus } from './EventBus.js';
import type { EventType } from './registry.js';
import { CONSUMER_SUBSCRIPTIONS, consumersFor } from './subscriptions.js';

// BullMQ adapter (09 §5): one queue per consumer; publish fans the event out to every queue
// whose consumer subscribes to its type. Job ID = eventId, so BullMQ itself drops duplicate
// publishes into the same queue (BullMQ forbids ":" in custom job IDs, so the consumer name is
// not part of the ID; the queue already scopes it).

export const QUEUE_PREFIX = 'ss';

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 }, // 2, 4, 8, 16, 32 s
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  // Failed jobs stay 7 days in the failed set: the dead-letter queue (09 §5).
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

export interface BullMqEventBusDeps {
  redisUrl: string;
  logger: Logger;
  subscriptions?: Record<string, readonly EventType[]>;
  prefix?: string;
  jobOptions?: JobsOptions;
}

export function createBullMqEventBus({
  redisUrl,
  logger,
  subscriptions = CONSUMER_SUBSCRIPTIONS,
  prefix = QUEUE_PREFIX,
  jobOptions = DEFAULT_JOB_OPTIONS,
}: BullMqEventBusDeps): EventBus {
  // BullMQ requires maxRetriesPerRequest: null on its connections (workers block on Redis).
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queues = new Map<string, Queue>();
  const workers: Worker[] = [];
  const log = logger.child({ component: 'event-bus' });
  logConnectionErrors(log, 'event-bus', [connection]);

  function queueFor(consumer: string): Queue {
    let queue = queues.get(consumer);
    if (!queue) {
      queue = new Queue(consumer, { connection, prefix, defaultJobOptions: jobOptions });
      logConnectionErrors(log, `queue:${consumer}`, [queue]);
      queues.set(consumer, queue);
    }
    return queue;
  }

  return {
    async publish(event: DomainEvent) {
      const consumers = consumersFor(event.type, subscriptions);
      await Promise.all(
        consumers.map((consumer) =>
          queueFor(consumer).add(event.type, event, { jobId: event.eventId }),
        ),
      );
      log.debug({ eventType: event.type, consumers }, 'Event published');
    },

    subscribe(consumer, eventTypes, handler, options = {}) {
      const worker = new Worker<DomainEvent>(
        consumer,
        async (job) => {
          const event = job.data;
          if (!eventTypes.includes(event.type)) return; // routed here but not handled by this subscriber
          // Link logs of this job to the request that caused the event (07 §1.1).
          await runWithContext(
            {
              requestId: event.correlationId,
              ...(job.id ? { jobId: job.id } : {}),
              queue: consumer,
              eventType: event.type,
            },
            () => handler(event),
          );
        },
        { connection, prefix, concurrency: options.concurrency ?? 10 },
      );
      logConnectionErrors(log, `worker:${consumer}`, [worker]);
      worker.on('failed', (job, err) => {
        const final = job ? job.attemptsMade >= (job.opts.attempts ?? 1) : true;
        log[final ? 'error' : 'warn'](
          { err, consumer, jobId: job?.id, attempt: job?.attemptsMade },
          final ? 'Job failed after final attempt' : 'Job failed; will retry',
        );
      });
      workers.push(worker);
    },

    async close() {
      await Promise.all(workers.map((worker) => worker.close()));
      await Promise.all([...queues.values()].map((queue) => queue.close()));
      await connection.quit().catch(() => connection.disconnect());
    },
  };
}
