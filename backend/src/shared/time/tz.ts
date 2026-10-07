import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';

// Salon-timezone helpers (03 §1: all tz math lives in shared/time). Instants are stored in UTC;
// calendar dates ("YYYY-MM-DD") and wall-clock times ("HH:mm") are in the salon timezone.

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

// The salon-local calendar date of an instant.
export function toZonedDate(instant: Date, timeZone: string): string {
  return format(new TZDate(instant.getTime(), timeZone), 'yyyy-MM-dd');
}

function parseDate(date: string): [number, number, number] {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error(`Invalid date "${date}" (expected YYYY-MM-DD)`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// UTC instant of local midnight at the start of `date`.
export function startOfZonedDay(date: string, timeZone: string): Date {
  const [year, month, day] = parseDate(date);
  return new Date(new TZDate(year, month - 1, day, timeZone).getTime());
}

// UTC instant of a salon-local wall-clock time ("HH:mm") on `date`.
export function zonedDateTime(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = parseDate(date);
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) throw new Error(`Invalid time "${time}" (expected HH:mm)`);
  return new Date(
    new TZDate(year, month - 1, day, Number(match[1]), Number(match[2]), timeZone).getTime(),
  );
}

// Human-readable salon-local time for messages, e.g. "Mon 12 Oct 2026, 11:00" (date-fns pattern).
export function formatZoned(
  instant: Date,
  timeZone: string,
  pattern = 'EEE d MMM yyyy, HH:mm',
): string {
  return format(new TZDate(instant.getTime(), timeZone), pattern);
}

// Calendar arithmetic on date strings; independent of any timezone.
export function addDays(date: string, days: number): string {
  const [year, month, day] = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

// Salon-local dates touched by the half-open interval [startAt, endAt).
export function zonedDatesBetween(startAt: Date, endAt: Date, timeZone: string): string[] {
  if (endAt.getTime() <= startAt.getTime()) return [];
  const last = toZonedDate(new Date(endAt.getTime() - 1), timeZone);
  const dates: string[] = [];
  for (let date = toZonedDate(startAt, timeZone); date <= last; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}
