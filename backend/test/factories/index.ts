import { randomBytes, randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import type { DomainEvent } from '../../src/shared/events/envelope.js';
import type { EventPayload } from '../../src/shared/events/registry.js';

// Hand-written test factories (10-testing §3). Business entities get theirs with their modules.

export const objectId = (): string => new Types.ObjectId().toHexString();

export const encryptionKey = (): string => randomBytes(32).toString('base64');

export function buildBookingCreatedPayload(
  overrides: Partial<EventPayload<'booking.created'>> = {},
): EventPayload<'booking.created'> {
  return {
    bookingId: objectId(),
    customerId: objectId(),
    staffId: objectId(),
    startAt: '2026-10-12T05:30:00.000Z',
    endAt: '2026-10-12T06:30:00.000Z',
    source: 'ONLINE',
    ...overrides,
  };
}

export function buildDomainEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  const payload = buildBookingCreatedPayload();
  return {
    eventId: randomUUID(),
    type: 'booking.created',
    version: 1,
    occurredAt: '2026-10-06T09:12:44.000Z',
    aggregateType: 'booking',
    aggregateId: payload.bookingId,
    actor: { id: objectId(), role: 'CUSTOMER' },
    correlationId: randomUUID(),
    payload,
    ...overrides,
  };
}
