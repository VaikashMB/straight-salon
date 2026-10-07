import type { Schemas } from '@/lib/api/client';
import { dateInZone, hhmmToMinutes, minutesInZone, weekdayOf } from '@/lib/time';

// Geometry of the admin day calendar (05 §4.4): rows are slot-granularity steps across the
// salon's opening hours; bookings, breaks and time-off become row spans per stylist column.

export interface DayWindow {
  open: number; // minutes since salon-local midnight
  close: number;
}

export interface Range {
  start: number;
  end: number;
  label: string;
}

type Settings = Pick<Schemas['PublicSettings'], 'businessHours'>;
type ScheduleDay = Schemas['StaffSchedule']['weekly'][number];
type TimeOff = Pick<Schemas['TimeOff'], 'startAt' | 'endAt' | 'reason'>;

const DAY = 24 * 60;

// Salon hours on that date, or null when closed.
export function salonWindow(settings: Settings, date: string): DayWindow | null {
  const hours = settings.businessHours.find((h) => h.dayOfWeek === weekdayOf(date));
  if (!hours?.isOpen) return null;
  return { open: hhmmToMinutes(hours.open), close: hhmmToMinutes(hours.close) };
}

export const rowCount = (window: DayWindow, step: number): number =>
  Math.ceil((window.close - window.open) / step);

// CSS grid lines for [start, end) minutes; row 1 is the header. Null when outside the window.
export function rowSpan(
  start: number,
  end: number,
  window: DayWindow,
  step: number,
): { rowStart: number; rowEnd: number } | null {
  const from = Math.max(start, window.open);
  const to = Math.min(end, window.close);
  if (to <= from) return null;
  return {
    rowStart: Math.floor((from - window.open) / step) + 2,
    rowEnd: Math.ceil((to - window.open) / step) + 2,
  };
}

// An instant range on one salon-local date, as minutes clamped to that day.
export function minutesOnDate(
  startAt: string,
  endAt: string,
  date: string,
  timeZone: string,
): { start: number; end: number } | null {
  const startDate = dateInZone(startAt, timeZone);
  const endDate = dateInZone(endAt, timeZone);
  if (startDate > date || endDate < date) return null;
  const start = startDate === date ? minutesInZone(startAt, timeZone) : 0;
  const end = endDate === date ? minutesInZone(endAt, timeZone) : DAY;
  return end > start ? { start, end } : null;
}

// When a stylist can't be booked inside the salon window: outside their hours, breaks, time-off.
export function blockedRanges(
  day: ScheduleDay | undefined,
  timeOff: TimeOff[],
  date: string,
  timeZone: string,
  window: DayWindow,
): Range[] {
  const ranges: Range[] = [];
  if (day && !day.isWorking) {
    ranges.push({ start: window.open, end: window.close, label: 'Day off' });
  } else if (day) {
    const start = hhmmToMinutes(day.start);
    const end = hhmmToMinutes(day.end);
    if (start > window.open) ranges.push({ start: window.open, end: start, label: 'Not working' });
    if (end < window.close) ranges.push({ start: end, end: window.close, label: 'Not working' });
    for (const b of day.breaks) {
      ranges.push({ start: hhmmToMinutes(b.start), end: hhmmToMinutes(b.end), label: 'Break' });
    }
  }
  for (const block of timeOff) {
    const span = minutesOnDate(block.startAt, block.endAt, date, timeZone);
    if (span)
      ranges.push({ ...span, label: block.reason ? `Time off: ${block.reason}` : 'Time off' });
  }
  return ranges;
}
