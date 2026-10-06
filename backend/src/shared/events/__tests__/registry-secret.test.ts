import { describe, expect, it } from 'vitest';
import {
  buildBookingCreatedPayload,
  encryptionKey,
  objectId,
} from '../../../../test/factories/index.js';
import {
  EVENT_TYPES,
  InvalidEventPayloadError,
  isEventType,
  parseEventPayload,
} from '../registry.js';
import { decryptSecret, encryptSecret } from '../secret.js';

describe('event registry (09 §2–3)', () => {
  it('covers the whole catalogue', () => {
    expect(EVENT_TYPES).toHaveLength(18);
    expect(isEventType('booking.created')).toBe(true);
    expect(isEventType('booking.exploded')).toBe(false);
  });

  it('accepts a valid payload', () => {
    const payload = buildBookingCreatedPayload();
    expect(parseEventPayload('booking.created', payload)).toEqual(payload);
  });

  it('rejects bad payloads with every issue listed', () => {
    const bad = {
      ...buildBookingCreatedPayload(),
      staffId: 'not-an-id',
      startAt: 'yesterday',
      source: 'FAX',
    };
    try {
      parseEventPayload('booking.created', bad);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidEventPayloadError);
      const e = err as InvalidEventPayloadError;
      expect(e.eventType).toBe('booking.created');
      expect(e.issues.map((i) => i.path).sort()).toEqual(['source', 'staffId', 'startAt']);
      expect(e.message).toContain('booking.created');
    }
  });

  it('validates nested and enum payloads', () => {
    expect(() =>
      parseEventPayload('booking.rescheduled', {
        bookingId: objectId(),
        from: { startAt: '2026-10-12T05:30:00Z', staffId: objectId() },
        to: { startAt: '2026-10-13T05:30:00Z', staffId: objectId() },
      }),
    ).not.toThrow();
    expect(() =>
      parseEventPayload('booking.status_changed', {
        bookingId: objectId(),
        from: 'BOOKED',
        to: 'LOST',
      }),
    ).toThrow(InvalidEventPayloadError);
    expect(() => parseEventPayload('settings.changed', { changedKeys: [] })).toThrow(
      InvalidEventPayloadError,
    );
  });
});

describe('outbox secrets (09 §7)', () => {
  it('round-trips with AES-256-GCM and a random IV each time', () => {
    const key = encryptionKey();
    const a = encryptSecret('raw-reset-token', key);
    const b = encryptSecret('raw-reset-token', key);
    expect(a.data).not.toBe(b.data);
    expect(JSON.stringify(a)).not.toContain('raw-reset-token');
    expect(decryptSecret(a, key)).toBe('raw-reset-token');
  });

  it('rejects tampered ciphertext and wrong keys', () => {
    const key = encryptionKey();
    const secret = encryptSecret('raw-reset-token', key);
    const tampered = { ...secret, data: Buffer.from('forged').toString('base64') };
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => decryptSecret(secret, encryptionKey())).toThrow();
  });

  it('requires a 32-byte key', () => {
    expect(() => encryptSecret('x', Buffer.alloc(16).toString('base64'))).toThrow('32 bytes');
  });
});
