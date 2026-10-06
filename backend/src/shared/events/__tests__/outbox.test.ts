import type { ClientSession } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import {
  buildBookingCreatedPayload,
  encryptionKey,
  objectId,
} from '../../../../test/factories/index.js';
import { runWithContext } from '../../http/requestContext.js';
import { createManualClock } from '../../time/clock.js';
import type { DomainEvent } from '../envelope.js';
import { createOutbox } from '../outbox.js';
import type { OutboxRepository } from '../outbox.repository.js';
import { InvalidEventPayloadError } from '../registry.js';
import { decryptSecret } from '../secret.js';

const session = {} as ClientSession;

function setup() {
  const stored: DomainEvent[] = [];
  const insert = vi.fn((event: DomainEvent) => {
    stored.push(event);
    return Promise.resolve();
  });
  const repository = { insert } as unknown as OutboxRepository;
  const key = encryptionKey();
  const outbox = createOutbox({
    repository,
    encryptionKey: key,
    clock: createManualClock('2026-10-06T09:12:44.000Z'),
    newId: () => '11111111-1111-4111-8111-111111111111',
  });
  return { outbox, stored, insert, key };
}

describe('outbox.add (09 §4)', () => {
  it("builds the full envelope from the request context, in the caller's session", async () => {
    const { outbox, stored, insert } = setup();
    const payload = buildBookingCreatedPayload();

    await runWithContext({ requestId: 'req-7', userId: 'u-1', role: 'CUSTOMER' }, () =>
      outbox.add(session, {
        type: 'booking.created',
        aggregateType: 'booking',
        aggregateId: payload.bookingId,
        payload,
      }),
    );

    expect(insert).toHaveBeenCalledWith(expect.any(Object), session);
    expect(stored[0]).toEqual({
      eventId: '11111111-1111-4111-8111-111111111111',
      type: 'booking.created',
      version: 1,
      occurredAt: '2026-10-06T09:12:44.000Z',
      aggregateType: 'booking',
      aggregateId: payload.bookingId,
      actor: { id: 'u-1', role: 'CUSTOMER' },
      correlationId: 'req-7',
      payload,
    });
  });

  it('rejects an invalid payload and stores nothing', async () => {
    const { outbox, insert } = setup();
    await expect(
      outbox.add(session, {
        type: 'booking.no_show',
        aggregateType: 'booking',
        aggregateId: 'x',
        payload: { bookingId: 'nope', staffId: objectId() },
      }),
    ).rejects.toBeInstanceOf(InvalidEventPayloadError);
    expect(insert).not.toHaveBeenCalled();
  });

  it('encrypts a secret and never stores it in plaintext', async () => {
    const { outbox, stored, key } = setup();
    const userId = objectId();
    await outbox.add(session, {
      type: 'user.password_reset_requested',
      aggregateType: 'user',
      aggregateId: userId,
      payload: { userId },
      secret: 'raw-reset-token',
      actor: { id: 'system', role: 'SYSTEM' },
    });
    const event = stored[0]!;
    expect(JSON.stringify(event)).not.toContain('raw-reset-token');
    expect(decryptSecret(event.secret!, key)).toBe('raw-reset-token');
    expect(event.actor).toEqual({ id: 'system', role: 'SYSTEM' });
    expect(event.correlationId).toBe('none');
  });
});
