import type { EncryptedSecret } from './secret.js';
import type { EventType } from './registry.js';

// Event envelope (09-events §2).
export interface EventActor {
  id: string; // "system" for jobs
  role: string;
}

export interface DomainEvent<T = unknown> {
  eventId: string; // UUID v4; consumer idempotency key
  type: EventType;
  version: 1; // payload schema version
  occurredAt: string; // ISO UTC
  aggregateType: string;
  aggregateId: string;
  actor: EventActor;
  correlationId: string; // originating requestId
  payload: T;
  // AES-256-GCM encrypted secret for the one consumer that needs it (09 §7). Optional.
  secret?: EncryptedSecret;
}
