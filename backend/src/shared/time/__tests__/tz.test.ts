import { describe, expect, it } from 'vitest';
import {
  addDays,
  isValidTimeZone,
  startOfZonedDay,
  toZonedDate,
  zonedDatesBetween,
  zonedDateTime,
} from '../tz.js';

const IST = 'Asia/Kolkata'; // UTC+05:30, no DST
const NY = 'America/New_York'; // DST: 2026-03-08 and 2026-11-01

describe('timezone helpers (03 §1: all tz math in shared/time)', () => {
  it('validates IANA names', () => {
    expect(isValidTimeZone(IST)).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('gives the salon-local date of an instant', () => {
    // 20:00 UTC on the 11th is 01:30 on the 12th in India.
    expect(toZonedDate(new Date('2026-10-11T20:00:00Z'), IST)).toBe('2026-10-12');
    expect(toZonedDate(new Date('2026-10-11T18:29:59Z'), IST)).toBe('2026-10-11');
  });

  it('converts local midnight and wall-clock times to UTC', () => {
    expect(startOfZonedDay('2026-10-12', IST).toISOString()).toBe('2026-10-11T18:30:00.000Z');
    expect(zonedDateTime('2026-10-12', '11:00', IST).toISOString()).toBe(
      '2026-10-12T05:30:00.000Z',
    );
    // DST-aware even though IST has none (03 §5.2): EDT before, EST after 2026-11-01.
    expect(zonedDateTime('2026-10-31', '09:00', NY).toISOString()).toBe('2026-10-31T13:00:00.000Z');
    expect(zonedDateTime('2026-11-02', '09:00', NY).toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('lists the local dates a half-open interval touches', () => {
    const at = (date: string, time: string) => zonedDateTime(date, time, IST);
    expect(zonedDatesBetween(at('2026-10-12', '10:00'), at('2026-10-12', '12:00'), IST)).toEqual([
      '2026-10-12',
    ]);
    // Ending exactly at midnight does not touch the next day.
    expect(
      zonedDatesBetween(at('2026-10-12', '22:00'), startOfZonedDay('2026-10-13', IST), IST),
    ).toEqual(['2026-10-12']);
    expect(zonedDatesBetween(at('2026-10-12', '22:00'), at('2026-10-14', '01:00'), IST)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
    ]);
    expect(zonedDatesBetween(at('2026-10-12', '10:00'), at('2026-10-12', '10:00'), IST)).toEqual(
      [],
    );
  });

  it('rejects malformed dates and times', () => {
    expect(() => startOfZonedDay('12-10-2026', IST)).toThrow(/Invalid date/);
    expect(() => zonedDateTime('2026-10-12', '9:00', IST)).toThrow(/Invalid time/);
  });
});
