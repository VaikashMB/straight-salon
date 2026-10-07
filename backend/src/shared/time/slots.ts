import { startOfZonedDay, zonedDateTime } from './tz.js';

// Slot engine (03 §5.2) as pure functions over epoch-millisecond intervals. All wall-clock
// inputs ("HH:mm") are salon-local and converted with tz-aware helpers, so DST days work.
// Intervals are half-open: [start, end).

const MINUTE = 60_000;

export interface Interval {
  start: number;
  end: number;
}

export interface LocalRange {
  start: string; // "HH:mm"
  end: string;
}

export interface StaffDayRules {
  date: string; // YYYY-MM-DD, salon timezone
  timeZone: string;
  isHoliday: boolean;
  salon: { isOpen: boolean; open: string; close: string };
  staff: { isWorking: boolean; start: string; end: string; breaks: LocalRange[] };
  timeOff: Interval[]; // may extend beyond the day
}

export interface SlotGrid {
  granularityMin: number;
  spanMin: number; // total service duration + buffer
}

// 0 = Sunday, for a calendar date (timezone-independent).
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function intersect(a: Interval, b: Interval): Interval | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return start < end ? { start, end } : null;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

// base minus every cut; result sorted, non-overlapping.
export function subtractIntervals(base: Interval[], cuts: Interval[]): Interval[] {
  const sortedCuts = [...cuts].filter((c) => c.start < c.end).sort((a, b) => a.start - b.start);
  const result: Interval[] = [];
  for (const piece of [...base].sort((a, b) => a.start - b.start)) {
    let cursor = piece.start;
    for (const cut of sortedCuts) {
      if (cut.end <= cursor || cut.start >= piece.end) continue;
      if (cut.start > cursor) result.push({ start: cursor, end: cut.start });
      cursor = Math.max(cursor, cut.end);
      if (cursor >= piece.end) break;
    }
    if (cursor < piece.end) result.push({ start: cursor, end: piece.end });
  }
  return result;
}

const local = (rules: StaffDayRules, time: string) =>
  zonedDateTime(rules.date, time, rules.timeZone).getTime();

// BR-005 without bookings: salon hours ∩ stylist hours − breaks − time-off; none on a holiday.
export function workingWindows(rules: StaffDayRules): Interval[] {
  if (rules.isHoliday || !rules.salon.isOpen || !rules.staff.isWorking) return [];
  const window = intersect(
    { start: local(rules, rules.salon.open), end: local(rules, rules.salon.close) },
    { start: local(rules, rules.staff.start), end: local(rules, rules.staff.end) },
  );
  if (!window) return [];
  const breaks = rules.staff.breaks.map((b) => ({
    start: local(rules, b.start),
    end: local(rules, b.end),
  }));
  return subtractIntervals([window], [...breaks, ...rules.timeOff]);
}

// Free time: working windows minus active bookings [startAt, blockedUntil).
export function freeWindows(working: Interval[], bookings: Interval[]): Interval[] {
  return subtractIntervals(working, bookings);
}

// BR-001: aligned to the granularity from salon-local midnight.
export function isAligned(instant: number, dayStart: number, granularityMin: number): boolean {
  return (instant - dayStart) % (granularityMin * MINUTE) === 0;
}

export function floorToSlot(instant: number, dayStart: number, granularityMin: number): number {
  const step = granularityMin * MINUTE;
  return dayStart + Math.floor((instant - dayStart) / step) * step;
}

function ceilToSlot(instant: number, dayStart: number, granularityMin: number): number {
  const step = granularityMin * MINUTE;
  return dayStart + Math.ceil((instant - dayStart) / step) * step;
}

// Every aligned t where [t, t + span) lies inside one free window.
export function slotStarts(free: Interval[], dayStart: number, grid: SlotGrid): number[] {
  const step = grid.granularityMin * MINUTE;
  const span = grid.spanMin * MINUTE;
  const starts: number[] = [];
  for (const window of free) {
    for (
      let t = ceilToSlot(window.start, dayStart, grid.granularityMin);
      t + span <= window.end;
      t += step
    ) {
      starts.push(t);
    }
  }
  return starts;
}

// One stylist's bookable start times for a day (03 §5.2 step 4). Independent of the caller
// and the clock, so it is what gets cached (08 §2).
export function staffDaySlots(
  rules: StaffDayRules,
  bookings: Interval[],
  grid: SlotGrid,
): number[] {
  const dayStart = startOfZonedDay(rules.date, rules.timeZone).getTime();
  return slotStarts(freeWindows(workingWindows(rules), bookings), dayStart, grid);
}

export function fitsWithin(windows: Interval[], candidate: Interval): boolean {
  return windows.some((w) => w.start <= candidate.start && candidate.end <= w.end);
}

// Step 5: drop starts before `notBefore` (now, or now + lead time for customers).
export function startsFrom(slots: number[], notBefore: number): number[] {
  return slots.filter((t) => t >= notBefore);
}

// Step 6: union across stylists, with who is free at each start.
export function mergeStaffSlots(
  perStaff: { staffId: string; slots: number[] }[],
): { startAt: number; staffIds: string[] }[] {
  const byStart = new Map<number, string[]>();
  for (const { staffId, slots } of perStaff) {
    for (const t of slots) byStart.set(t, [...(byStart.get(t) ?? []), staffId]);
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([startAt, staffIds]) => ({ startAt, staffIds }));
}
