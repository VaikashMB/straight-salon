import type { Env } from '../config/env.js';
import { createBullMqEventBus } from '../shared/events/bullmqEventBus.js';
import type { EventBus } from '../shared/events/EventBus.js';
import { outboxRepository } from '../shared/events/outbox.repository.js';
import { createOutboxRelay, type OutboxRelay } from '../shared/events/relay.js';
import { watchOutboxInserts } from '../shared/events/watchOutbox.js';
import type { Logger } from '../shared/logger/index.js';

// Wiring shared by relay.ts and worker.ts (when RUN_RELAY_IN_WORKER=true), 01 §1.
export function startOutboxRelay(env: Env, logger: Logger): { relay: OutboxRelay; bus: EventBus } {
  const bus = createBullMqEventBus({ redisUrl: env.REDIS_URL, logger });
  const relay = createOutboxRelay({
    repository: outboxRepository,
    bus,
    logger,
    watchInserts: watchOutboxInserts(logger),
  });
  relay.start();
  return { relay, bus };
}
