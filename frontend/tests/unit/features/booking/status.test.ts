import { describe, expect, it } from 'vitest';
import { insideCutoff } from '@/features/booking/mutations';
import { firstName, nextStatuses } from '@/features/booking/status';

describe('BR-010 next status actions', () => {
  const now = new Date('2026-10-12T06:00:00.000Z');
  it('offers only the valid next step; no-show only after the start (decision 2026-10-07)', () => {
    expect(nextStatuses({ status: 'BOOKED', startAt: '2026-10-12T07:00:00.000Z' }, now)).toEqual([
      'CHECKED_IN',
    ]);
    expect(nextStatuses({ status: 'BOOKED', startAt: '2026-10-12T05:30:00.000Z' }, now)).toEqual([
      'CHECKED_IN',
      'NO_SHOW',
    ]);
    expect(nextStatuses({ status: 'CHECKED_IN', startAt: '' }, now)).toEqual(['IN_SERVICE']);
    expect(nextStatuses({ status: 'IN_SERVICE', startAt: '' }, now)).toEqual(['COMPLETED']);
    for (const status of ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
      expect(nextStatuses({ status, startAt: '' }, now)).toEqual([]);
    }
  });

  it('BR-006 cut-off window and first names', () => {
    expect(insideCutoff('2026-10-12T07:59:00.000Z', 120, now)).toBe(true);
    expect(insideCutoff('2026-10-12T08:00:00.000Z', 120, now)).toBe(false);
    expect(firstName('Ananya Rao')).toBe('Ananya');
  });
});
