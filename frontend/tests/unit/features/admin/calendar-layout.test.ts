import { describe, expect, it } from 'vitest';
import {
  blockedRanges,
  minutesOnDate,
  rowCount,
  rowSpan,
  salonWindow,
} from '@/features/admin-calendar/layout';
import { settings } from '../../helpers/api';

const tz = 'Asia/Kolkata';
const window = { open: 570, close: 1230 }; // 09:30–20:30

describe('admin calendar geometry (05 §4.4)', () => {
  it('uses salon hours for the date, or null when closed', () => {
    expect(salonWindow(settings, '2026-10-12')).toEqual(window);
    const closedMonday = {
      businessHours: settings.businessHours.map((h) =>
        h.dayOfWeek === 1 ? { ...h, isOpen: false } : h,
      ),
    };
    expect(salonWindow(closedMonday, '2026-10-12')).toBeNull();
    expect(rowCount(window, 15)).toBe(44);
  });

  it('maps minutes to grid rows (row 1 is the header), clamped to the window', () => {
    expect(rowSpan(570, 600, window, 15)).toEqual({ rowStart: 2, rowEnd: 4 });
    expect(rowSpan(660, 720, window, 15)).toEqual({ rowStart: 8, rowEnd: 12 });
    expect(rowSpan(500, 600, window, 15)).toEqual({ rowStart: 2, rowEnd: 4 });
    expect(rowSpan(1300, 1400, window, 15)).toBeNull();
  });

  it('clamps ranges that span days to the date shown', () => {
    // 11:00 IST on the 12th to 13:00 IST on the 13th.
    const start = '2026-10-12T05:30:00.000Z';
    const end = '2026-10-13T07:30:00.000Z';
    expect(minutesOnDate(start, end, '2026-10-12', tz)).toEqual({ start: 660, end: 1440 });
    expect(minutesOnDate(start, end, '2026-10-13', tz)).toEqual({ start: 0, end: 780 });
    expect(minutesOnDate(start, end, '2026-10-14', tz)).toBeNull();
  });

  it('blocks outside working hours, breaks, time-off and days off', () => {
    const day = {
      dayOfWeek: 1,
      isWorking: true,
      start: '10:00',
      end: '19:00',
      breaks: [{ start: '13:30', end: '14:15' }],
    };
    const off = [
      { startAt: '2026-10-12T10:30:00.000Z', endAt: '2026-10-12T11:30:00.000Z', reason: 'Dentist' },
    ];
    expect(blockedRanges(day, off, '2026-10-12', tz, window)).toEqual([
      { start: 570, end: 600, label: 'Not working' },
      { start: 1140, end: 1230, label: 'Not working' },
      { start: 810, end: 855, label: 'Break' },
      { start: 960, end: 1020, label: 'Time off: Dentist' },
    ]);
    expect(blockedRanges({ ...day, isWorking: false }, [], '2026-10-12', tz, window)).toEqual([
      { start: 570, end: 1230, label: 'Day off' },
    ]);
    expect(
      blockedRanges(undefined, [{ ...off[0]!, reason: undefined }], '2026-10-12', tz, window),
    ).toEqual([{ start: 960, end: 1020, label: 'Time off' }]);
  });
});
