import { describe, expect, it } from 'vitest';
import { nowOffset } from '@/features/admin-calendar/layout';
import { nowIndex } from '@/features/staff/components/my-day';

const tz = 'Asia/Kolkata';
const window = { open: 570, close: 1230 }; // 09:30–20:30

describe('timeline "now" line (05 §4.3, §4.4)', () => {
  it('is minutes since opening, only on today and inside the window', () => {
    // 11:15 IST on the 12th.
    const now = new Date('2026-10-12T05:45:00.000Z');
    expect(nowOffset(window, '2026-10-12', tz, now)).toBe(105);
    expect(nowOffset(window, '2026-10-13', tz, now)).toBeNull();
    // 08:00 IST: before opening; 21:00 IST: after closing.
    expect(nowOffset(window, '2026-10-12', tz, new Date('2026-10-12T02:30:00.000Z'))).toBeNull();
    expect(nowOffset(window, '2026-10-12', tz, new Date('2026-10-12T15:30:00.000Z'))).toBeNull();
    // The edges count.
    expect(nowOffset(window, '2026-10-12', tz, new Date('2026-10-12T04:00:00.000Z'))).toBe(0);
  });

  it('My day puts the marker before the first booking not yet started', () => {
    const list = [{ startAt: '2026-10-12T04:00:00.000Z' }, { startAt: '2026-10-12T06:00:00.000Z' }];
    expect(nowIndex(list, new Date('2026-10-12T03:00:00.000Z'))).toBe(0);
    expect(nowIndex(list, new Date('2026-10-12T05:00:00.000Z'))).toBe(1);
    expect(nowIndex(list, new Date('2026-10-12T07:00:00.000Z'))).toBe(2);
  });
});
