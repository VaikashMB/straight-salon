import type { EventBus, EventHandler } from '../shared/events/EventBus.js';
import { idempotent, type ProcessedEventsRepository } from '../shared/events/idempotent.js';
import {
  CONSUMER_CONCURRENCY,
  CONSUMER_SUBSCRIPTIONS,
  type ConsumerName,
} from '../shared/events/subscriptions.js';
import type { Logger } from '../shared/logger/index.js';
import type { Clock } from '../shared/time/clock.js';

// Wires consumers onto the bus (09 §5): each is idempotent (09 §6) and logs its jobs (07 §1.5:
// start at debug, success at info with duration; failures are logged by the bus adapter).
// `ratings` and `stats` arrive in Phase 7 with their collections; until then their queues keep
// receiving events, which they process when they start.

export type ConsumerHandlers = Partial<Record<ConsumerName, EventHandler>>;

export function logged(consumer: string, handler: EventHandler, logger: Logger): EventHandler {
  return async (event) => {
    const started = performance.now();
    logger.debug({ consumer, eventType: event.type, eventId: event.eventId }, 'Job started');
    await handler(event);
    logger.info(
      {
        consumer,
        eventType: event.type,
        eventId: event.eventId,
        durationMs: Math.round(performance.now() - started),
      },
      'Job done',
    );
  };
}

export function registerConsumers(
  bus: EventBus,
  handlers: ConsumerHandlers,
  deps: { logger: Logger; clock: Clock; processedEvents?: ProcessedEventsRepository },
): ConsumerName[] {
  const registered: ConsumerName[] = [];
  for (const [name, handler] of Object.entries(handlers) as [ConsumerName, EventHandler][]) {
    bus.subscribe(
      name,
      CONSUMER_SUBSCRIPTIONS[name],
      idempotent(name, logged(name, handler, deps.logger), {
        logger: deps.logger,
        now: () => deps.clock.now(),
        ...(deps.processedEvents ? { repository: deps.processedEvents } : {}),
      }),
      { concurrency: CONSUMER_CONCURRENCY[name] },
    );
    registered.push(name);
  }
  return registered;
}
