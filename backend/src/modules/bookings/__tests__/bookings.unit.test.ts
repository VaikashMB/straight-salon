import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { BOOKING_STATUSES, type BookingStatus } from '../../../config/constants.js';
import {
  canChange,
  canReview,
  completedAt,
  makeBookingRef,
  reviewWindowOpen,
  toBookingDto,
} from '../bookings.mapper.js';
import type { BookingDoc } from '../bookings.model.js';
import { CreateBookingBodySchema, RescheduleBodySchema } from '../bookings.schemas.js';
import { canTransition } from '../bookings.service.js';

const now = new Date('2026-10-12T03:30:00.000Z');
const booking = (overrides: Partial<BookingDoc> = {}): BookingDoc => ({
  _id: new Types.ObjectId(),
  bookingRef: 'SS-261012-7KQ2',
  customerId: new Types.ObjectId(),
  staffId: new Types.ObjectId(),
  services: [
    { serviceId: new Types.ObjectId(), name: 'Haircut', durationMin: 45, priceMinor: 40_000 },
  ],
  startAt: new Date('2026-10-12T09:30:00.000Z'), // 6 h after now
  endAt: new Date('2026-10-12T10:15:00.000Z'),
  blockedUntil: new Date('2026-10-12T10:15:00.000Z'),
  totalDurationMin: 45,
  totalPriceMinor: 40_000,
  status: 'BOOKED',
  statusHistory: [],
  source: 'ONLINE',
  payment: { status: 'UNPAID' },
  reminders: {},
  createdBy: new Types.ObjectId(),
  __v: 0,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

describe('BR-010 status graph (FR-040)', () => {
  const allowed: [BookingStatus, BookingStatus][] = [
    ['BOOKED', 'CHECKED_IN'],
    ['BOOKED', 'NO_SHOW'],
    ['BOOKED', 'CANCELLED'],
    ['CHECKED_IN', 'IN_SERVICE'],
    ['IN_SERVICE', 'COMPLETED'],
  ];
  it.each(BOOKING_STATUSES.flatMap((from) => BOOKING_STATUSES.map((to) => [from, to] as const)))(
    '%s -> %s',
    (from, to) => {
      expect(canTransition(from, to)).toBe(allowed.some(([a, b]) => a === from && b === to));
    },
  );
});

describe('BR-006 canCancel / canReschedule for the viewer', () => {
  const customer = { userId: 'u', role: 'CUSTOMER' as const };
  it('customers until the cut-off, never after; only BOOKED', () => {
    expect(canChange(booking(), customer, now, 120)).toBe(true);
    expect(
      canChange(booking({ startAt: new Date(now.getTime() + 119 * 60_000) }), customer, now, 120),
    ).toBe(false);
    expect(
      canChange(booking({ startAt: new Date(now.getTime() + 120 * 60_000) }), customer, now, 120),
    ).toBe(true);
    expect(canChange(booking({ status: 'CHECKED_IN' }), customer, now, 120)).toBe(false);
  });
  it('reception/admin always (override available); stylists never', () => {
    const soon = booking({ startAt: new Date(now.getTime() + 10 * 60_000) });
    expect(canChange(soon, { userId: 'r', role: 'RECEPTIONIST' }, now, 120)).toBe(true);
    expect(canChange(soon, { userId: 'a', role: 'ADMIN' }, now, 120)).toBe(true);
    expect(canChange(booking(), { userId: 's', role: 'STAFF' }, now, 120)).toBe(false);
  });
});

describe('booking DTO', () => {
  const ctx = (role: 'STAFF' | 'ADMIN', b: BookingDoc) => ({
    viewer: { userId: 'x', role },
    now,
    currency: 'INR',
    cancellationCutoffMin: 120,
    reviewWindowDays: 14,
    reviewed: new Set<string>(),
    customers: new Map([
      [b.customerId.toHexString(), { name: 'Ananya Rao Iyer', phone: '+919876543212' }],
    ]),
    staffNames: new Map<string, string>(),
  });

  it('masks the customer for stylists and falls back for missing people', () => {
    const b = booking();
    expect(toBookingDto(b, ctx('STAFF', b)).customer).toMatchObject({
      name: 'Ananya',
      phone: '+9198******12',
    });
    expect(toBookingDto(b, ctx('ADMIN', b)).customer).toMatchObject({ name: 'Ananya Rao Iyer' });
    expect(toBookingDto(b, ctx('ADMIN', b)).staff.displayName).toBe('Unknown stylist');
    const orphan = booking({ customerId: new Types.ObjectId() });
    expect(toBookingDto(orphan, ctx('STAFF', b)).customer).toMatchObject({
      name: 'Unknown',
      phone: '',
    });
  });

  it('includes payment and cancellation details when present', () => {
    const b = booking({
      status: 'CANCELLED',
      cancellation: { at: now, by: 'u', overridden: true },
      payment: {
        status: 'PAID',
        method: 'UPI',
        amountPaidMinor: 35_000,
        discountMinor: 5_000,
        discountReason: 'Promo',
        recordedAt: now,
      },
      notes: 'Window seat',
    });
    const dto = toBookingDto(b, ctx('ADMIN', b));
    expect(dto.cancellation).toEqual({ at: now.toISOString(), overridden: true });
    expect(dto.payment).toMatchObject({
      method: 'UPI',
      amountPaid: { amountMinor: 35_000 },
      discountReason: 'Promo',
    });
    expect(dto.notes).toBe('Window seat');
  });
});

describe('BR-012 review eligibility (canReview)', () => {
  const DAY = 86_400_000;
  const done = new Date('2026-10-01T06:00:00.000Z');
  const completed = (overrides: Partial<BookingDoc> = {}) =>
    booking({
      status: 'COMPLETED',
      endAt: new Date('2026-10-01T05:00:00.000Z'),
      statusHistory: [
        { status: 'BOOKED', at: new Date('2026-09-28T00:00:00.000Z'), by: 'u' },
        { status: 'COMPLETED', at: done, by: 'r' },
      ],
      ...overrides,
    });

  it('the window counts from the COMPLETED entry, falling back to endAt', () => {
    expect(completedAt(completed())).toEqual(done);
    expect(completedAt(completed({ statusHistory: [] })).toISOString()).toBe(
      '2026-10-01T05:00:00.000Z',
    );
  });

  it('BR-012 open up to reviewWindowDays after completion, closed after; only COMPLETED', () => {
    expect(reviewWindowOpen(completed(), new Date(done.getTime() + 14 * DAY), 14)).toBe(true);
    expect(reviewWindowOpen(completed(), new Date(done.getTime() + 14 * DAY + 1), 14)).toBe(false);
    expect(reviewWindowOpen(booking(), now, 14)).toBe(false);
  });

  it('BR-012 only the booking customer, once, inside the window', () => {
    const b = completed();
    const owner = { userId: b.customerId.toHexString(), role: 'CUSTOMER' as const };
    const at = new Date(done.getTime() + DAY);
    expect(canReview(b, owner, at, 14, false)).toBe(true);
    expect(canReview(b, owner, at, 14, true)).toBe(false);
    expect(canReview(b, { userId: 'other', role: 'CUSTOMER' }, at, 14, false)).toBe(false);
    expect(canReview(b, { userId: owner.userId, role: 'ADMIN' }, at, 14, false)).toBe(false);
    expect(canReview(b, owner, new Date(done.getTime() + 15 * DAY), 14, false)).toBe(false);
  });

  it('the DTO carries canReview for the viewer', () => {
    const b = completed();
    const viewer = { userId: b.customerId.toHexString(), role: 'CUSTOMER' as const };
    const base = {
      viewer,
      now: new Date(done.getTime() + DAY),
      currency: 'INR',
      cancellationCutoffMin: 120,
      reviewWindowDays: 14,
      customers: new Map<string, { name: string; phone: string }>(),
      staffNames: new Map<string, string>(),
    };
    expect(toBookingDto(b, { ...base, reviewed: new Set() }).canReview).toBe(true);
    expect(toBookingDto(b, { ...base, reviewed: new Set([b._id.toHexString()]) }).canReview).toBe(
      false,
    );
  });
});

describe('booking references (02 §2.11)', () => {
  it('SS-YYMMDD-XXXX from the appointment date with unambiguous characters', () => {
    expect(makeBookingRef('2026-10-12', () => 0)).toBe('SS-261012-AAAA');
    expect(makeBookingRef('2026-01-05', () => 0.999)).toBe('SS-260105-9999');
    for (let i = 0; i < 50; i++)
      expect(makeBookingRef('2026-10-12')).toMatch(/^SS-261012-[A-HJ-NP-Z2-9]{4}$/);
  });
});

describe('booking request schemas', () => {
  const id = '6712c0f9a1b2c3d4e5f60501';
  it('startAt is required unless checkInNow, and not allowed with it', () => {
    expect(CreateBookingBodySchema.safeParse({ serviceIds: [id], staffId: 'any' }).success).toBe(
      false,
    );
    expect(
      CreateBookingBodySchema.safeParse({ serviceIds: [id], staffId: 'any', checkInNow: true })
        .success,
    ).toBe(true);
    expect(
      CreateBookingBodySchema.safeParse({
        serviceIds: [id],
        staffId: 'any',
        checkInNow: true,
        startAt: now.toISOString(),
      }).success,
    ).toBe(false);
    expect(
      CreateBookingBodySchema.safeParse({
        serviceIds: [id],
        staffId: 'someone',
        startAt: now.toISOString(),
      }).success,
    ).toBe(false);
  });
  it('override needs a reason', () => {
    expect(
      RescheduleBodySchema.safeParse({ startAt: now.toISOString(), override: true }).success,
    ).toBe(false);
    expect(
      RescheduleBodySchema.safeParse({ startAt: now.toISOString(), override: true, reason: 'ok' })
        .success,
    ).toBe(true);
  });
});
