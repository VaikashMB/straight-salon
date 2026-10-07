import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { captureLogger } from '../../../test/helpers/logger.js';
import type { BookingDoc } from '../../modules/bookings/bookings.model.js';
import type { SettingsDto } from '../../modules/settings/settings.schemas.js';
import type { DomainEvent } from '../../shared/events/envelope.js';
import type { EventType } from '../../shared/events/registry.js';
import { createRatingsConsumer } from '../consumers/ratings.consumer.js';
import { createStatsConsumer, datesForEvent } from '../consumers/stats.consumer.js';

const id = () => new Types.ObjectId().toHexString();
const event = (type: EventType, payload: unknown): DomainEvent => ({
  eventId: randomUUID(),
  type,
  version: 1,
  occurredAt: '2026-10-12T05:00:00.000Z',
  aggregateType: 'booking',
  aggregateId: id(),
  actor: { id: 'u', role: 'CUSTOMER' },
  correlationId: 'req-1',
  payload,
});

// 20:00 UTC is 01:30 the next day in the salon (Asia/Kolkata, +05:30).
const LATE = '2026-10-12T20:00:00.000Z';

function deps(found: Partial<BookingDoc> | null = { startAt: new Date(LATE) }) {
  const { logger, lines } = captureLogger();
  return {
    logger,
    lines,
    settings: { get: () => Promise.resolve({ timezone: 'Asia/Kolkata' } as SettingsDto) },
    bookings: { findById: vi.fn(() => Promise.resolve(found as BookingDoc | null)) },
    reports: { recomputeDays: vi.fn(() => Promise.resolve()) },
  };
}

describe('stats consumer (09 §5): affected salon-local dates', () => {
  it('uses the payload start times, both days of a reschedule', async () => {
    const d = deps();
    const created = event('booking.created', {
      bookingId: id(),
      customerId: id(),
      staffId: id(),
      startAt: LATE,
      endAt: LATE,
      source: 'ONLINE',
    });
    expect(await datesForEvent(created, d)).toEqual(['2026-10-13']);
    const moved = event('booking.rescheduled', {
      bookingId: id(),
      from: { startAt: '2026-10-12T05:00:00.000Z', staffId: id() },
      to: { startAt: LATE, staffId: id() },
    });
    expect(await datesForEvent(moved, d)).toEqual(['2026-10-12', '2026-10-13']);
    const cancelled = event('booking.cancelled', {
      bookingId: id(),
      staffId: id(),
      startAt: '2026-10-12T05:00:00.000Z',
      cancelledBy: 'u',
    });
    expect(await datesForEvent(cancelled, d)).toEqual(['2026-10-12']);
    expect(d.bookings.findById).not.toHaveBeenCalled();
  });

  it('looks the booking up for completed, no-show and payment events', async () => {
    const d = deps();
    const bookingId = id();
    for (const e of [
      event('booking.completed', {
        bookingId,
        staffId: id(),
        serviceIds: [id()],
        totalPriceMinor: 100,
      }),
      event('booking.no_show', { bookingId, staffId: id() }),
      event('booking.payment_recorded', { bookingId, amountPaidMinor: 100, method: 'CASH' }),
    ]) {
      expect(await datesForEvent(e, d)).toEqual(['2026-10-13']);
    }
    expect(d.bookings.findById).toHaveBeenCalledTimes(3);
    expect(await datesForEvent(event('settings.changed', { changedKeys: ['name'] }), d)).toEqual(
      [],
    );
  });

  it('a missing booking is logged and skipped; the handler recomputes the dates once', async () => {
    const missing = deps(null);
    const handler = createStatsConsumer(missing);
    await handler(event('booking.no_show', { bookingId: id(), staffId: id() }));
    expect(missing.reports.recomputeDays).toHaveBeenCalledWith([]);
    expect(missing.lines().some((l) => l.msg === 'Booking not found; no stats update')).toBe(true);

    const d = deps();
    await createStatsConsumer(d)(
      event('booking.rescheduled', {
        bookingId: id(),
        from: { startAt: LATE, staffId: id() },
        to: { startAt: LATE, staffId: id() },
      }),
    );
    expect(d.reports.recomputeDays).toHaveBeenCalledWith(['2026-10-13']);
  });
});

describe('ratings consumer (09 §5)', () => {
  it('refreshes ratings for review events only; warns when the review is gone', async () => {
    const { logger, lines } = captureLogger();
    const reviews = { refreshRatings: vi.fn(() => Promise.resolve(true)) };
    const handler = createRatingsConsumer({ reviews, logger });
    const reviewId = id();
    await handler(event('review.created', { reviewId, staffId: id(), serviceIds: [], rating: 5 }));
    await handler(event('review.visibility_changed', { reviewId, isHidden: true }));
    await handler(event('booking.no_show', { bookingId: id(), staffId: id() }));
    expect(reviews.refreshRatings).toHaveBeenCalledTimes(2);
    expect(reviews.refreshRatings).toHaveBeenCalledWith(reviewId);

    reviews.refreshRatings.mockResolvedValueOnce(false);
    await handler(event('review.visibility_changed', { reviewId, isHidden: false }));
    expect(lines().some((l) => l.msg === 'Review not found; ratings left as they are')).toBe(true);
  });
});
