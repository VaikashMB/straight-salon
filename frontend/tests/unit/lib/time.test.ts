import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateInZone,
  datesBetween,
  formatMinutes,
  hhmmToMinutes,
  minutesInZone,
  minutesToHhmm,
  timeInZone,
  todayInZone,
  weekdayOf,
  zonedToUtc,
} from '@/lib/time';

describe('salon-calendar helpers (NFR-010)', () => {
  it('reads dates and clock times in the salon timezone, not the browser’s', () => {
    // 20:00 UTC on the 11th is already the 12th in India (UTC+5:30).
    expect(dateInZone('2026-10-11T20:00:00.000Z', 'Asia/Kolkata')).toBe('2026-10-12');
    expect(dateInZone('2026-10-11T20:00:00.000Z', 'UTC')).toBe('2026-10-11');
    expect(timeInZone('2026-10-12T05:30:00.000Z', 'Asia/Kolkata')).toBe('11:00');
    expect(minutesInZone('2026-10-12T05:30:00.000Z', 'Asia/Kolkata')).toBe(660);
    expect(todayInZone('Asia/Kolkata', new Date('2026-10-11T19:00:00.000Z'))).toBe('2026-10-12');
  });

  it('converts a salon wall-clock time to a UTC instant', () => {
    expect(zonedToUtc('2026-10-12', '11:00', 'Asia/Kolkata')).toBe('2026-10-12T05:30:00.000Z');
    // DST-aware: London is UTC+1 in summer, UTC+0 in winter.
    expect(zonedToUtc('2026-07-01', '09:00', 'Europe/London')).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToUtc('2026-12-01', '09:00', 'Europe/London')).toBe('2026-12-01T09:00:00.000Z');
  });

  it('does calendar arithmetic on YYYY-MM-DD strings', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekdayOf('2026-10-12')).toBe(1); // Monday
    expect(datesBetween('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(datesBetween('2026-10-02', '2026-10-01')).toEqual([]);
  });

  it('formats minutes and HH:mm', () => {
    expect(hhmmToMinutes('09:30')).toBe(570);
    expect(minutesToHhmm(570)).toBe('09:30');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 hour');
    expect(formatMinutes(120)).toBe('2 hours');
    expect(formatMinutes(90)).toBe('1 h 30 min');
  });
});
