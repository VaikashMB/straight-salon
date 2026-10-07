import { describe, expect, it, vi } from 'vitest';
import { buildDomainEvent } from '../../../test/factories/index.js';
import { captureLogger } from '../../../test/helpers/logger.js';
import type { ProcessedEventsRepository } from '../../shared/events/idempotent.js';
import { createInMemoryEventBus } from '../../shared/events/inMemoryEventBus.js';
import { createManualClock } from '../../shared/time/clock.js';
import { logged, registerConsumers } from '../registerConsumers.js';

function memoryProcessedEvents(): ProcessedEventsRepository {
  const seen = new Set<string>();
  return {
    tryInsert: (consumer, eventId) => {
      const key = `${consumer}:${eventId}`;
      if (seen.has(key)) return Promise.resolve(false);
      seen.add(key);
      return Promise.resolve(true);
    },
    remove: (consumer, eventId) => {
      seen.delete(`${consumer}:${eventId}`);
      return Promise.resolve();
    },
  };
}

describe('consumer registration (09 §5, §6)', () => {
  it('subscribes each consumer to its event types, idempotently', async () => {
    const bus = createInMemoryEventBus();
    const notifications = vi.fn(() => Promise.resolve());
    const cache = vi.fn(() => Promise.resolve());
    const { logger } = captureLogger();
    const registered = registerConsumers(
      bus,
      { notifications, 'cache-invalidation': cache },
      { logger, clock: createManualClock(new Date(0)), processedEvents: memoryProcessedEvents() },
    );
    expect(registered).toEqual(['notifications', 'cache-invalidation']);

    const created = buildDomainEvent();
    await bus.publish(created);
    await bus.publish(created); // at-least-once: a duplicate delivery
    expect(notifications).toHaveBeenCalledTimes(1);
    expect(cache).toHaveBeenCalledTimes(1);

    // holiday.changed goes to cache-invalidation only (static routing table).
    await bus.publish(
      buildDomainEvent({ type: 'holiday.changed', payload: { date: '2026-10-20' } }),
    );
    expect(notifications).toHaveBeenCalledTimes(1);
    expect(cache).toHaveBeenCalledTimes(2);
  });

  it('a failed handler can run again on retry', async () => {
    const bus = createInMemoryEventBus();
    const handler = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('SMTP down'))
      .mockResolvedValue();
    registerConsumers(
      bus,
      { notifications: handler },
      {
        logger: captureLogger().logger,
        clock: createManualClock(new Date(0)),
        processedEvents: memoryProcessedEvents(),
      },
    );
    const event = buildDomainEvent();
    await expect(bus.publish(event)).rejects.toThrow('SMTP down');
    await bus.publish(event);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('logs job start at debug and success at info with the duration (07 §1.5)', async () => {
    const { logger, lines } = captureLogger();
    const event = buildDomainEvent();
    await logged('notifications', () => Promise.resolve(), logger)(event);
    const [start, done] = lines();
    expect(start).toMatchObject({ level: 'debug', msg: 'Job started', consumer: 'notifications' });
    expect(done).toMatchObject({
      level: 'info',
      msg: 'Job done',
      consumer: 'notifications',
      eventType: 'booking.created',
      eventId: event.eventId,
    });
    expect(typeof done!.durationMs).toBe('number');
  });
});
