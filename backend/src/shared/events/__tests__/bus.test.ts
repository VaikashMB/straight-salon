import { describe, expect, it, vi } from 'vitest';
import { buildDomainEvent } from '../../../../test/factories/index.js';
import { createInMemoryEventBus } from '../inMemoryEventBus.js';
import { EVENT_TYPES } from '../registry.js';
import { CONSUMER_CONCURRENCY, CONSUMER_SUBSCRIPTIONS, consumersFor } from '../subscriptions.js';

describe('consumer subscriptions (09 §5)', () => {
  it('routes booking.created to every consumer that needs it', () => {
    expect(consumersFor('booking.created').sort()).toEqual(
      ['cache-invalidation', 'notifications', 'staff-notifications', 'stats'].sort(),
    );
    expect(consumersFor('review.created').sort()).toEqual(['cache-invalidation', 'ratings']);
    expect(consumersFor('user.registered')).toEqual(['notifications']);
  });

  it('only references known event types, and every consumer has a concurrency', () => {
    for (const [consumer, types] of Object.entries(CONSUMER_SUBSCRIPTIONS)) {
      for (const type of types) expect(EVENT_TYPES).toContain(type);
      expect(CONSUMER_CONCURRENCY[consumer as keyof typeof CONSUMER_CONCURRENCY]).toBeGreaterThan(
        0,
      );
    }
    expect(CONSUMER_CONCURRENCY.notifications).toBe(5);
  });

  it('accepts a custom routing table', () => {
    expect(
      consumersFor('booking.created', { a: ['booking.created'], b: ['holiday.changed'] }),
    ).toEqual(['a']);
  });
});

describe('in-memory EventBus', () => {
  it('delivers only matching events to each subscriber and records what was published', async () => {
    const bus = createInMemoryEventBus();
    const stats = vi.fn(() => Promise.resolve());
    const ratings = vi.fn(() => Promise.resolve());
    bus.subscribe('stats', ['booking.created'], stats);
    bus.subscribe('ratings', ['review.created'], ratings);

    const event = buildDomainEvent();
    await bus.publish(event);

    expect(stats).toHaveBeenCalledWith(event);
    expect(ratings).not.toHaveBeenCalled();
    expect(bus.published).toEqual([event]);

    await bus.close();
    await bus.publish(buildDomainEvent());
    expect(stats).toHaveBeenCalledTimes(1);
  });
});
