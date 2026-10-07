import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';

// Display formatting (05 §7): money with Intl in the salon currency; dates and times in the salon
// timezone, with the zone's abbreviation when the browser is in a different timezone.

export const DEFAULT_LOCALE = 'en-IN';

// Money is stored in minor units (paise, cents); the currency decides how many decimals.
export function formatMoney(
  amountMinor: number,
  currency: string,
  locale = DEFAULT_LOCALE,
): string {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amountMinor / 10 ** digits);
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// "IST", "GMT+5:30" or similar for the instant (abbreviations can change with DST).
export function timeZoneAbbreviation(
  instant: Date | string,
  timeZone: string,
  locale = DEFAULT_LOCALE,
): string {
  const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' }).formatToParts(
    new Date(instant),
  );
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
}

export interface ZoneOptions {
  viewerTimeZone?: string; // defaults to the browser's
}

function inZone(instant: Date | string, timeZone: string, pattern: string, opts: ZoneOptions) {
  const text = format(new TZDate(new Date(instant).getTime(), timeZone), pattern);
  const viewer = opts.viewerTimeZone ?? browserTimeZone();
  return viewer === timeZone ? text : `${text} ${timeZoneAbbreviation(instant, timeZone)}`;
}

// "Mon 12 Oct 2026, 11:00" (+ " IST" for viewers elsewhere)
export const formatDateTime = (instant: Date | string, timeZone: string, opts: ZoneOptions = {}) =>
  inZone(instant, timeZone, 'EEE d MMM yyyy, HH:mm', opts);

// "11:00" (+ zone)
export const formatTime = (instant: Date | string, timeZone: string, opts: ZoneOptions = {}) =>
  inZone(instant, timeZone, 'HH:mm', opts);

// "Mon 12 Oct 2026" for an instant, in the salon timezone (no zone suffix: a date has no clock).
export const formatDate = (instant: Date | string, timeZone: string) =>
  format(new TZDate(new Date(instant).getTime(), timeZone), 'EEE d MMM yyyy');

// A salon-local calendar date ("2026-10-12", 04 §1) for display, independent of any timezone.
export function formatCalendarDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return format(new Date(y, m - 1, d), 'EEE d MMM yyyy');
}
