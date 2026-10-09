import { describe, expect, it } from 'vitest';
import { formatClock12, weekHours } from '@/features/catalog/hours';
import type { PublicSettings } from '@/features/catalog/api';

describe('opening hours in 12-hour time', () => {
  it.each([
    ['09:30', '9:30 AM'],
    ['00:00', '12:00 AM'],
    ['00:05', '12:05 AM'],
    ['11:59', '11:59 AM'],
    ['12:00', '12:00 PM'],
    ['13:15', '1:15 PM'],
    ['20:30', '8:30 PM'],
    ['23:45', '11:45 PM'],
  ])('%s -> %s', (hhmm, expected) => {
    expect(formatClock12(hhmm)).toBe(expected);
  });

  it('lists the week Monday first, with closed days', () => {
    const settings = {
      businessHours: [
        { dayOfWeek: 0, isOpen: false, open: '10:00', close: '18:00' },
        { dayOfWeek: 1, isOpen: true, open: '09:30', close: '20:30' },
      ],
    } as unknown as PublicSettings;
    const week = weekHours(settings);
    expect(week[0]).toEqual({ day: 'Monday', hours: '9:30 AM – 8:30 PM' });
    expect(week[1]).toEqual({ day: 'Tuesday', hours: 'Closed' });
    expect(week[6]).toEqual({ day: 'Sunday', hours: 'Closed' });
  });
});
