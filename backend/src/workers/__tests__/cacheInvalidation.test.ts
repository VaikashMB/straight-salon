import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { buildDomainEvent, objectId } from '../../../test/factories/index.js';
import { captureLogger } from '../../../test/helpers/logger.js';
import type { BookingDoc } from '../../modules/bookings/bookings.model.js';
import type { SettingsDto } from '../../modules/settings/settings.schemas.js';
import type { DomainEvent } from '../../shared/events/envelope.js';
import type { EventType } from '../../shared/events/registry.js';
import {
  createCacheInvalidationConsumer,
  tagsForEvent,
} from '../consumers/cacheInvalidation.consumer.js';

const staffId = objectId();
const other = objectId();
const bookingId = objectId();
// 2026-10-11T20:00Z is already the 12th in India.
const START = '2026-10-11T20:00:00.000Z';

const deps = {
  settings: { get: () => Promise.resolve({ timezone: 'Asia/Kolkata' } as SettingsDto) },
  bookings: {
    findById: vi.fn((id: string) =>
      Promise.resolve(
        id === bookingId
          ? ({ staffId: new Types.ObjectId(staffId), startAt: new Date(START) } as BookingDoc)
          : null,
      ),
    ),
  },
};

const event = (type: EventType, payload: unknown): DomainEvent =>
  buildDomainEvent({ eventId: randomUUID(), type, payload });

const slotTags = (id: string, date: string) => [
  `avail:${id}:${date}`,
  `availdays:${id}`,
  'availdays:any',
];

describe('cache-invalidation consumer (08 §4)', () => {
  it('booking events clear the stylist/day availability and reports', async () => {
    const created = event('booking.created', {
      bookingId,
      customerId: objectId(),
      staffId,
      startAt: START,
      endAt: '2026-10-11T21:00:00.000Z',
      source: 'ONLINE',
    });
    expect(await tagsForEvent(created, deps)).toEqual([
      ...slotTags(staffId, '2026-10-12'),
      'reports',
    ]);

    const cancelled = event('booking.cancelled', {
      bookingId,
      staffId,
      startAt: START,
      cancelledBy: objectId(),
    });
    expect(await tagsForEvent(cancelled, deps)).toEqual([
      ...slotTags(staffId, '2026-10-12'),
      'reports',
    ]);
  });

  it('a reschedule clears both the old and the new stylist/day', async () => {
    const moved = event('booking.rescheduled', {
      bookingId,
      from: { startAt: START, staffId },
      to: { startAt: '2026-10-13T05:30:00.000Z', staffId: other },
    });
    expect(await tagsForEvent(moved, deps)).toEqual([
      ...slotTags(staffId, '2026-10-12'),
      ...slotTags(other, '2026-10-13'),
      'reports',
    ]);
  });

  it('status changes free the slot only for CANCELLED and NO_SHOW', async () => {
    const noShow = event('booking.status_changed', { bookingId, from: 'BOOKED', to: 'NO_SHOW' });
    expect(await tagsForEvent(noShow, deps)).toEqual([
      ...slotTags(staffId, '2026-10-12'),
      'reports',
    ]);
    const checkIn = event('booking.status_changed', {
      bookingId,
      from: 'BOOKED',
      to: 'CHECKED_IN',
    });
    expect(await tagsForEvent(checkIn, deps)).toEqual(['reports']);
    const gone = event('booking.status_changed', {
      bookingId: objectId(),
      from: 'BOOKED',
      to: 'CANCELLED',
    });
    expect(await tagsForEvent(gone, deps)).toEqual(['reports']);
  });

  it('outcome and payment events only touch reports', async () => {
    const id = { bookingId, staffId };
    expect(await tagsForEvent(event('booking.no_show', id), deps)).toEqual(['reports']);
    expect(
      await tagsForEvent(
        event('booking.completed', { ...id, serviceIds: [objectId()], totalPriceMinor: 100 }),
        deps,
      ),
    ).toEqual(['reports']);
    expect(
      await tagsForEvent(
        event('booking.payment_recorded', { bookingId, amountPaidMinor: 100, method: 'CASH' }),
        deps,
      ),
    ).toEqual(['reports']);
  });

  it('staff, catalog, settings, holiday and review events match the services', async () => {
    expect(
      await tagsForEvent(event('staff.updated', { staffId, affectedDates: [] }), deps),
    ).toEqual(['staff', `avail:${staffId}`, `availdays:${staffId}`, 'availdays:any']);
    expect(
      await tagsForEvent(event('staff.schedule_changed', { staffId, affectedDates: [] }), deps),
    ).toEqual([`avail:${staffId}`, `availdays:${staffId}`, 'availdays:any']);
    expect(
      await tagsForEvent(
        event('staff.timeoff_changed', { staffId, affectedDates: ['2026-10-12', '2026-10-13'] }),
        deps,
      ),
    ).toEqual([
      `avail:${staffId}:2026-10-12`,
      `avail:${staffId}:2026-10-13`,
      `availdays:${staffId}`,
      'availdays:any',
    ]);
    expect(
      await tagsForEvent(
        event('catalog.changed', { entityType: 'service', entityId: objectId() }),
        deps,
      ),
    ).toEqual(['catalog', 'staff', 'avail']);
    expect(
      await tagsForEvent(event('settings.changed', { changedKeys: ['timezone'] }), deps),
    ).toEqual(['settings', 'catalog', 'avail']);
    expect(await tagsForEvent(event('holiday.changed', { date: '2026-10-20' }), deps)).toEqual([
      'avail',
    ]);
    expect(
      await tagsForEvent(
        event('review.created', { reviewId: objectId(), staffId, serviceIds: [], rating: 5 }),
        deps,
      ),
    ).toEqual(['staff', 'catalog']);
    expect(
      await tagsForEvent(
        event('review.visibility_changed', { reviewId: objectId(), isHidden: true }),
        deps,
      ),
    ).toEqual(['staff', 'catalog']);
    expect(await tagsForEvent(event('user.registered', { userId: objectId() }), deps)).toEqual([]);
  });

  it('invalidates each tag once', async () => {
    const cache = { invalidateTag: vi.fn<(tag: string) => Promise<void>>(() => Promise.resolve()) };
    const consumer = createCacheInvalidationConsumer({
      ...deps,
      cache,
      logger: captureLogger().logger,
    });
    await consumer(
      event('booking.rescheduled', {
        bookingId,
        from: { startAt: START, staffId },
        to: { startAt: START, staffId },
      }),
    );
    expect(cache.invalidateTag.mock.calls.map(([tag]) => tag)).toEqual([
      ...slotTags(staffId, '2026-10-12'),
      'reports',
    ]);
  });
});
