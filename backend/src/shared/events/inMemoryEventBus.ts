import type { DomainEvent } from './envelope.js';
import type { EventBus, EventHandler } from './EventBus.js';
import type { EventType } from './registry.js';

// Synchronous bus for tests (10 §2): publish awaits every matching handler in order, and keeps
// a log of what was published so tests can assert on it.
export interface InMemoryEventBus extends EventBus {
  readonly published: DomainEvent[];
}

export function createInMemoryEventBus(): InMemoryEventBus {
  const subscribers: { consumer: string; types: readonly EventType[]; handler: EventHandler }[] =
    [];
  const published: DomainEvent[] = [];

  return {
    published,
    async publish(event) {
      published.push(event);
      for (const subscriber of subscribers) {
        if (subscriber.types.includes(event.type)) await subscriber.handler(event);
      }
    },
    subscribe(consumer, types, handler) {
      subscribers.push({ consumer, types, handler });
    },
    close() {
      subscribers.length = 0;
      return Promise.resolve();
    },
  };
}
