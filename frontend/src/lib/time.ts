import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';

// Salon-calendar arithmetic (NFR-010): the API speaks UTC instants and salon-local dates
// ("2026-10-12", 04 §1). These helpers convert between the two in the salon timezone, whatever
// timezone the browser is in.

const pad = (n: number) => String(n).padStart(2, '0');

function parts(date: string): [number, number, number] {
  return date.split('-').map(Number) as [number, number, number];
}

// The salon-local date of an instant.
export function dateInZone(instant: Date | string | number, timeZone: string): string {
  return format(new TZDate(new Date(instant).getTime(), timeZone), 'yyyy-MM-dd');
}

export const todayInZone = (timeZone: string, now: Date = new Date()): string =>
  dateInZone(now, timeZone);

// "HH:mm" of an instant on the salon clock.
export function timeInZone(instant: Date | string | number, timeZone: string): string {
  return format(new TZDate(new Date(instant).getTime(), timeZone), 'HH:mm');
}

// Minutes since salon-local midnight.
export function minutesInZone(instant: Date | string | number, timeZone: string): number {
  const zoned = new TZDate(new Date(instant).getTime(), timeZone);
  return zoned.getHours() * 60 + zoned.getMinutes();
}

// Calendar arithmetic on "YYYY-MM-DD" strings (no timezone involved).
export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

// 0 = Sunday … 6 = Saturday, like the API's dayOfWeek.
export function weekdayOf(date: string): number {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Every date from `from` to `to`, inclusive.
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

// A salon-local date and wall-clock time as a UTC ISO instant.
export function zonedToUtc(date: string, time: string, timeZone: string): string {
  const [y, m, d] = parts(date);
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return new Date(new TZDate(y, m - 1, d, hh, mm, timeZone).getTime()).toISOString();
}

// "HH:mm" -> minutes since midnight.
export function hhmmToMinutes(time: string): number {
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return hh * 60 + mm;
}

export function minutesToHhmm(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

// 120 -> "2 hours", 90 -> "1 h 30 min", 45 -> "45 min".
export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return hours === 1 ? '1 hour' : `${hours} hours`;
  return `${hours} h ${minutes} min`;
}

// How far off an appointment is, for the customer's "next visit" card: "In 40 min",
// "In 2 h 15 min" (later today), "Tomorrow", "In 3 days", "In 2 weeks". Days are counted on the
// salon calendar, so 23:00 tonight to 10:00 tomorrow is "Tomorrow", not "In 11 hours".
export function countdown(startAt: string, timeZone: string, now: Date = new Date()): string {
  const minutes = Math.round((new Date(startAt).getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return 'Happening now';
  const today = todayInZone(timeZone, now);
  const day = dateInZone(startAt, timeZone);
  if (day === today) return `In ${formatMinutes(minutes)}`;
  const [y1, m1, d1] = parts(today);
  const [y2, m2, d2] = parts(day);
  const days = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
  if (days === 1) return 'Tomorrow';
  if (days < 14) return `In ${days} days`;
  return `In ${Math.round(days / 7)} weeks`;
}
