import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import type { BookingStatus } from '../../../config/constants.js';
import type { BookingDoc, Payment } from '../../bookings/bookings.model.js';
import {
  allocateProportionally,
  computeDayStats,
  mergeServiceStats,
  noShowRate,
  revenueOf,
  utilisation,
  emptyCounts,
} from '../dailyStats.js';

const RAVI = new Types.ObjectId().toHexString();
const ARJUN = new Types.ObjectId().toHexString();
const HAIRCUT = new Types.ObjectId();
const BEARD = new Types.ObjectId();

function booking(
  staffId: string,
  status: BookingStatus,
  services: { id: Types.ObjectId; priceMinor: number; durationMin: number }[],
  payment: Payment = { status: 'UNPAID' },
): BookingDoc {
  const at = new Date('2026-10-12T05:00:00.000Z');
  return {
    _id: new Types.ObjectId(),
    bookingRef: 'SS-261012-AAAA',
    customerId: new Types.ObjectId(),
    staffId: new Types.ObjectId(staffId),
    services: services.map((s) => ({
      serviceId: s.id,
      name: 'x',
      durationMin: s.durationMin,
      priceMinor: s.priceMinor,
    })),
    startAt: at,
    endAt: at,
    blockedUntil: at,
    totalDurationMin: services.reduce((sum, s) => sum + s.durationMin, 0),
    totalPriceMinor: services.reduce((sum, s) => sum + s.priceMinor, 0),
    status,
    statusHistory: [],
    source: 'ONLINE',
    payment,
    createdBy: new Types.ObjectId(),
    __v: 0,
    createdAt: at,
    updatedAt: at,
  };
}

const haircut = { id: HAIRCUT, priceMinor: 40_000, durationMin: 45 };
const beard = { id: BEARD, priceMinor: 15_000, durationMin: 15 };
const paid = (amountPaidMinor: number): Payment => ({ status: 'PAID', amountPaidMinor });

describe('allocateProportionally (revenue by service, decision 2026-10-07)', () => {
  it('splits by weight and always sums to the total (largest remainder)', () => {
    expect(allocateProportionally(50_000, [40_000, 15_000])).toEqual([36_364, 13_636]);
    expect(allocateProportionally(100, [1, 1, 1])).toEqual([34, 33, 33]); // tie: earlier first
    expect(allocateProportionally(10, [0, 0])).toEqual([5, 5]); // all-zero weights: even split
    expect(allocateProportionally(0, [3, 7])).toEqual([0, 0]);
    expect(allocateProportionally(7, [])).toEqual([]);
    for (const total of [1, 99, 12_345, 1_000_001]) {
      const parts = allocateProportionally(total, [17, 5, 33, 1]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe('computeDayStats (02 §2.17)', () => {
  it('counts every status, revenue from paid completed bookings, minutes without no-shows', () => {
    const rows = computeDayStats(
      [
        booking(RAVI, 'COMPLETED', [haircut, beard], paid(50_000)),
        booking(RAVI, 'NO_SHOW', [haircut]),
        booking(RAVI, 'BOOKED', [haircut]),
        booking(ARJUN, 'COMPLETED', [haircut]), // not paid yet: no revenue
        booking(ARJUN, 'CANCELLED', [haircut], paid(40_000)), // impossible, but never revenue
        booking(ARJUN, 'IN_SERVICE', [beard]),
      ],
      new Map([
        [RAVI, 660],
        [ARJUN, 600],
      ]),
    );
    const [total, ...staff] = rows;
    expect(total).toMatchObject({
      staffId: null,
      bookings: 6,
      completed: 2,
      cancelled: 1,
      noShows: 1,
      revenueMinor: 50_000,
      bookedMinutes: 60 + 45 + 45 + 15,
      availableMinutes: 1_260,
    });
    expect(total!.byService).toEqual([
      { serviceId: HAIRCUT.toHexString(), count: 2, revenueMinor: 36_364 },
      { serviceId: BEARD.toHexString(), count: 1, revenueMinor: 13_636 },
    ]);
    const byId = new Map(staff.map((r) => [r.staffId, r]));
    expect(byId.get(RAVI)).toMatchObject({ bookings: 3, bookedMinutes: 105, revenueMinor: 50_000 });
    expect(byId.get(ARJUN)).toMatchObject({ bookings: 3, bookedMinutes: 60, cancelled: 1 });
    expect(byId.get(ARJUN)!.byService).toEqual([
      { serviceId: HAIRCUT.toHexString(), count: 1, revenueMinor: 0 },
    ]);
  });

  it('keeps stylists with working time or bookings; drops idle days off; always a salon row', () => {
    const OFF = new Types.ObjectId().toHexString();
    const INACTIVE = new Types.ObjectId().toHexString();
    const rows = computeDayStats(
      [booking(INACTIVE, 'COMPLETED', [beard], paid(15_000))],
      new Map([
        [RAVI, 660],
        [OFF, 0],
      ]),
    );
    expect(rows.map((r) => r.staffId).sort()).toEqual([null, INACTIVE, RAVI].sort());
    expect(rows.find((r) => r.staffId === INACTIVE)).toMatchObject({ availableMinutes: 0 });

    expect(computeDayStats([], new Map())).toEqual([
      { staffId: null, ...emptyCounts(), byService: [] },
    ]);
  });

  it('revenueOf only counts COMPLETED and PAID', () => {
    expect(revenueOf(booking(RAVI, 'COMPLETED', [haircut], paid(40_000)))).toBe(40_000);
    expect(revenueOf(booking(RAVI, 'COMPLETED', [haircut], { status: 'PAID' }))).toBe(0);
    expect(revenueOf(booking(RAVI, 'COMPLETED', [haircut]))).toBe(0);
    expect(revenueOf(booking(RAVI, 'NO_SHOW', [haircut], paid(40_000)))).toBe(0);
  });

  it('mergeServiceStats sums by service, highest revenue first, then by id', () => {
    const a = HAIRCUT.toHexString();
    const b = BEARD.toHexString();
    const [first, second] = [a, b].sort();
    expect(
      mergeServiceStats([
        [{ serviceId: first!, count: 1, revenueMinor: 10 }],
        [
          { serviceId: second!, count: 1, revenueMinor: 10 },
          { serviceId: first!, count: 2, revenueMinor: 0 },
        ],
      ]),
    ).toEqual([
      { serviceId: first, count: 3, revenueMinor: 10 },
      { serviceId: second, count: 1, revenueMinor: 10 },
    ]);
  });
});

describe('FR-071 rates', () => {
  it('no-show rate excludes cancellations; utilisation is booked / available; 0 when empty', () => {
    const c = { ...emptyCounts(), bookings: 5, cancelled: 1, noShows: 1 };
    expect(noShowRate(c)).toBe(0.25);
    expect(noShowRate({ ...emptyCounts(), bookings: 2, cancelled: 2 })).toBe(0);
    expect(utilisation({ ...emptyCounts(), bookedMinutes: 150, availableMinutes: 1_320 })).toBe(
      0.1136,
    );
    expect(utilisation({ ...emptyCounts(), bookedMinutes: 30 })).toBe(0);
  });
});
