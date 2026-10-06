import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { getRequestContext } from '../http/requestContext.js';
import { systemClock, type Clock } from '../time/clock.js';
import type { DomainEvent, EventActor } from './envelope.js';
import type { OutboxRepository } from './outbox.repository.js';
import { parseEventPayload, type EventPayload, type EventType } from './registry.js';
import { encryptSecret } from './secret.js';

// Write side of the transactional outbox (09 §4): called inside the service's transaction, so
// the event is stored atomically with the state change. The relay publishes it later.
//
//   await outbox.add(session, { type: 'booking.created', aggregateType: 'booking', aggregateId, payload });

export interface OutboxAddInput<T extends EventType> {
  type: T;
  aggregateType: string;
  aggregateId: string;
  payload: EventPayload<T>;
  secret?: string; // plaintext; encrypted before it is stored (09 §7)
  actor?: EventActor; // defaults to the current request's user; jobs pass the system actor
}

export interface Outbox {
  add<T extends EventType>(
    session: ClientSession,
    input: OutboxAddInput<T>,
  ): Promise<DomainEvent<EventPayload<T>>>;
}

export interface OutboxDeps {
  repository: OutboxRepository;
  encryptionKey: string;
  clock?: Clock;
  newId?: () => string;
}

export function createOutbox({
  repository,
  encryptionKey,
  clock = systemClock,
  newId = randomUUID,
}: OutboxDeps): Outbox {
  return {
    async add(session, input) {
      const ctx = getRequestContext();
      const payload = parseEventPayload(input.type, input.payload);
      const event: DomainEvent<EventPayload<typeof input.type>> = {
        eventId: newId(),
        type: input.type,
        version: 1,
        occurredAt: clock.now().toISOString(),
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        actor: input.actor ?? { id: ctx?.userId ?? 'anonymous', role: ctx?.role ?? 'ANONYMOUS' },
        correlationId: ctx?.requestId ?? 'none',
        payload,
      };
      if (input.secret !== undefined) {
        event.secret = encryptSecret(input.secret, encryptionKey);
      }
      await repository.insert(event, session);
      return event;
    },
  };
}
