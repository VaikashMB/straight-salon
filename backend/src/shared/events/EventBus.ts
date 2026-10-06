import type { DomainEvent } from './envelope.js';
import type { EventType } from './registry.js';

// Transport abstraction (09 §5). Modules never import BullMQ; swapping to RabbitMQ/Kafka means
// a new adapter, nothing else.
export type EventHandler = (event: DomainEvent) => Promise<void>;

export interface SubscribeOptions {
  concurrency?: number;
}

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(
    consumer: string,
    eventTypes: readonly EventType[],
    handler: EventHandler,
    options?: SubscribeOptions,
  ): void;
  close(): Promise<void>;
}
