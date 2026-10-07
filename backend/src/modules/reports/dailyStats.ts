import { ACTIVE_BOOKING_STATUSES, type BookingStatus } from '../../config/constants.js';
import type { BookingDoc } from '../bookings/bookings.model.js';

// daily_stats read model (02 §2.17) as pure functions. Definitions (decision 2026-10-07):
// - a booking belongs to the salon-local date of its startAt (FR-071), any status;
// - revenue = amount paid on COMPLETED + PAID bookings (US-05);
// - per-service revenue splits a booking's payment across its services in proportion to their
//   price snapshots (largest remainder), so it always sums to the booking's revenue; `count`
//   is the number of completed bookings that included the service;
// - booked minutes (utilisation) = COMPLETED + still-active bookings; cancelled and no-show
//   time is not utilised;
// - available minutes = the stylist's working time that day (salon hours ∩ schedule − breaks
//   − time-off; 0 on a holiday).

export interface ServiceStat {
  serviceId: string;
  count: number;
  revenueMinor: number;
}

export interface StatCounts {
  bookings: number;
  completed: number;
  cancelled: number;
  noShows: number;
  revenueMinor: number;
  bookedMinutes: number;
  availableMinutes: number;
}

export interface DayStatsRow extends StatCounts {
  staffId: string | null; // null = salon total
  byService: ServiceStat[];
}

const UTILISED: ReadonlySet<BookingStatus> = new Set([...ACTIVE_BOOKING_STATUSES, 'COMPLETED']);

export const emptyCounts = (): StatCounts => ({
  bookings: 0,
  completed: 0,
  cancelled: 0,
  noShows: 0,
  revenueMinor: 0,
  bookedMinutes: 0,
  availableMinutes: 0,
});

export function addCounts(into: StatCounts, add: StatCounts): StatCounts {
  for (const key of Object.keys(into) as (keyof StatCounts)[]) into[key] += add[key];
  return into;
}

// Splits `total` in proportion to `weights` with integer parts that sum exactly to `total`
// (largest remainder; ties go to the earlier entry). All-zero weights split evenly.
export function allocateProportionally(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const effective = sum > 0 ? weights : weights.map(() => 1);
  const effectiveSum = sum > 0 ? sum : weights.length;
  const exact = effective.map((w) => (total * w) / effectiveSum);
  const parts = exact.map(Math.floor);
  let rest = total - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (rest <= 0) break;
    parts[index]! += 1;
    rest--;
  }
  return parts;
}

export function revenueOf(booking: BookingDoc): number {
  if (booking.status !== 'COMPLETED' || booking.payment.status !== 'PAID') return 0;
  return booking.payment.amountPaidMinor ?? 0;
}

export function mergeServiceStats(lists: ServiceStat[][]): ServiceStat[] {
  const merged = new Map<string, ServiceStat>();
  for (const stat of lists.flat()) {
    const current = merged.get(stat.serviceId) ?? {
      serviceId: stat.serviceId,
      count: 0,
      revenueMinor: 0,
    };
    current.count += stat.count;
    current.revenueMinor += stat.revenueMinor;
    merged.set(stat.serviceId, current);
  }
  return [...merged.values()].sort(
    (a, b) => b.revenueMinor - a.revenueMinor || a.serviceId.localeCompare(b.serviceId),
  );
}

function serviceStatsOf(booking: BookingDoc): ServiceStat[] {
  if (booking.status !== 'COMPLETED') return [];
  const shares = allocateProportionally(
    revenueOf(booking),
    booking.services.map((s) => s.priceMinor),
  );
  return booking.services.map((s, i) => ({
    serviceId: s.serviceId.toHexString(),
    count: 1,
    revenueMinor: shares[i]!,
  }));
}

// One date's rows: one per stylist who had bookings or working time, plus the salon total.
// `availableMinutes` holds each stylist to report on (e.g. every active stylist).
export function computeDayStats(
  bookings: BookingDoc[],
  availableMinutes: Map<string, number>,
): DayStatsRow[] {
  const byStaff = new Map<string, { counts: StatCounts; services: ServiceStat[][] }>();
  const rowFor = (staffId: string) => {
    let row = byStaff.get(staffId);
    if (!row) {
      row = { counts: emptyCounts(), services: [] };
      row.counts.availableMinutes = availableMinutes.get(staffId) ?? 0;
      byStaff.set(staffId, row);
    }
    return row;
  };
  for (const staffId of availableMinutes.keys()) rowFor(staffId);

  for (const booking of bookings) {
    const row = rowFor(booking.staffId.toHexString());
    row.counts.bookings++;
    if (booking.status === 'COMPLETED') row.counts.completed++;
    if (booking.status === 'CANCELLED') row.counts.cancelled++;
    if (booking.status === 'NO_SHOW') row.counts.noShows++;
    row.counts.revenueMinor += revenueOf(booking);
    if (UTILISED.has(booking.status)) row.counts.bookedMinutes += booking.totalDurationMin;
    row.services.push(serviceStatsOf(booking));
  }

  const rows: DayStatsRow[] = [...byStaff.entries()]
    .filter(([, row]) => row.counts.bookings > 0 || row.counts.availableMinutes > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([staffId, row]) => ({
      staffId,
      ...row.counts,
      byService: mergeServiceStats(row.services),
    }));
  const total: DayStatsRow = {
    staffId: null,
    ...rows.reduce((sum, row) => addCounts(sum, row), emptyCounts()),
    byService: mergeServiceStats(rows.map((row) => row.byService)),
  };
  return [total, ...rows];
}

const ratio = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : 0;

// FR-071: no-shows among bookings that were not cancelled.
export const noShowRate = (c: StatCounts) => ratio(c.noShows, c.bookings - c.cancelled);
export const utilisation = (c: StatCounts) => ratio(c.bookedMinutes, c.availableMinutes);
