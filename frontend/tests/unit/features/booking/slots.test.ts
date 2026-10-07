import { describe, expect, it } from 'vitest';
import { dayPart, dayRanges, groupSlots } from '@/features/booking/slots';
import { datesBetween } from '@/lib/time';

describe('time-slot grouping (05 §4.1)', () => {
  it('groups by part of day on the salon clock', () => {
    const tz = 'Asia/Kolkata';
    const at = (utc: string) => ({ startAt: `2026-10-12T${utc}:00.000Z`, staffIds: [] });
    // 11:00, 11:45 IST (morning), 12:00 IST (afternoon), 16:45 (afternoon), 17:00 (evening)
    const slots = [at('05:30'), at('06:15'), at('06:30'), at('11:15'), at('11:30')];
    expect(groupSlots(slots, tz).map((g) => [g.part, g.slots.length])).toEqual([
      ['Morning', 2],
      ['Afternoon', 2],
      ['Evening', 1],
    ]);
    expect(dayPart('2026-10-12T05:30:00.000Z', 'UTC')).toBe('Morning');
    expect(groupSlots([at('12:30')], tz).map((g) => g.part)).toEqual(['Evening']);
  });

  it('splits long windows into API-041 sized requests (max 31 days)', () => {
    const dates = datesBetween('2026-10-01', '2026-11-30'); // 61 days
    expect(dayRanges(dates)).toEqual([
      { from: '2026-10-01', to: '2026-10-31' },
      { from: '2026-11-01', to: '2026-11-30' },
    ]);
    expect(dayRanges([])).toEqual([]);
  });
});
