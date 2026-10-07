import { describe, expect, it } from 'vitest';
import {
  browserTimeZone,
  formatCalendarDate,
  formatDate,
  formatDateTime,
  formatMoney,
  formatTime,
  timeZoneAbbreviation,
} from '@/lib/format';

const AT = '2026-10-12T05:30:00.000Z'; // 11:00 in the salon (Asia/Kolkata)
const IST = 'Asia/Kolkata';

describe('money (04 §1 minor units, Intl)', () => {
  it('formats minor units by the currency’s decimals', () => {
    expect(formatMoney(55_000, 'INR')).toBe('₹550.00');
    expect(formatMoney(1_234_567, 'INR')).toBe('₹12,345.67');
    expect(formatMoney(1500, 'JPY')).toBe('JP¥1,500');
    expect(formatMoney(999, 'USD', 'en-US')).toBe('$9.99');
  });
});

describe('dates and times in the salon timezone (05 §7)', () => {
  it('no zone suffix when the viewer is in the salon timezone', () => {
    expect(formatDateTime(AT, IST, { viewerTimeZone: IST })).toBe('Mon 12 Oct 2026, 11:00');
    expect(formatTime(AT, IST, { viewerTimeZone: IST })).toBe('11:00');
  });

  it('adds the salon zone abbreviation for viewers elsewhere', () => {
    expect(formatDateTime(AT, IST, { viewerTimeZone: 'Europe/London' })).toBe(
      'Mon 12 Oct 2026, 11:00 IST',
    );
    expect(formatTime(new Date(AT), IST, { viewerTimeZone: 'UTC' })).toBe('11:00 IST');
    expect(timeZoneAbbreviation(AT, 'UTC')).toBe('UTC');
  });

  it('defaults the viewer to the browser timezone', () => {
    const viewer = browserTimeZone();
    expect(typeof viewer).toBe('string');
    expect(formatTime(AT, viewer)).not.toContain(' ');
  });

  it('dates: instants in the salon timezone; calendar dates as they are', () => {
    expect(formatDate('2026-10-12T20:00:00.000Z', IST)).toBe('Tue 13 Oct 2026');
    expect(formatCalendarDate('2026-10-12')).toBe('Mon 12 Oct 2026');
  });
});
