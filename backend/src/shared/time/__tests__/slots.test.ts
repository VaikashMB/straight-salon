import { describe, expect, it } from 'vitest';
import {
  fitsWithin,
  floorToSlot,
  freeWindows,
  intersect,
  isAligned,
  mergeStaffSlots,
  overlaps,
  slotStarts,
  staffDaySlots,
  startsFrom,
  subtractIntervals,
  weekdayOf,
  workingWindows,
  type StaffDayRules,
} from '../slots.js';
import { startOfZonedDay, zonedDateTime } from '../tz.js';

const IST = 'Asia/Kolkata';
const DATE = '2026-10-12'; // a Monday
const at = (time: string, date = DATE, tz = IST) => zonedDateTime(date, time, tz).getTime();
const iv = (start: string, end: string) => ({ start: at(start), end: at(end) });
const hhmm = (instants: number[], tz = IST) =>
  instants.map((t) =>
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(
      t,
    ),
  );

function rules(overrides: Partial<StaffDayRules> = {}): StaffDayRules {
  return {
    date: DATE,
    timeZone: IST,
    isHoliday: false,
    salon: { isOpen: true, open: '09:30', close: '20:30' },
    staff: { isWorking: true, start: '10:00', end: '13:00', breaks: [] },
    timeOff: [],
    ...overrides,
  };
}

const grid = (spanMin: number, granularityMin = 15) => ({ spanMin, granularityMin });

describe('interval helpers', () => {
  it('intersect / overlaps treat intervals as half-open', () => {
    expect(intersect({ start: 0, end: 10 }, { start: 5, end: 20 })).toEqual({ start: 5, end: 10 });
    expect(intersect({ start: 0, end: 10 }, { start: 10, end: 20 })).toBeNull();
    expect(overlaps({ start: 0, end: 10 }, { start: 9, end: 11 })).toBe(true);
    expect(overlaps({ start: 0, end: 10 }, { start: 10, end: 11 })).toBe(false); // back to back
  });

  it('subtractIntervals handles cuts inside, across, covering, touching and unsorted', () => {
    expect(
      subtractIntervals(
        [{ start: 0, end: 100 }],
        [
          { start: 20, end: 30 },
          { start: 60, end: 70 },
        ],
      ),
    ).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 60 },
      { start: 70, end: 100 },
    ]);
    expect(
      subtractIntervals(
        [{ start: 0, end: 100 }],
        [
          { start: 90, end: 200 },
          { start: -50, end: 10 },
        ],
      ),
    ).toEqual([{ start: 10, end: 90 }]);
    expect(subtractIntervals([{ start: 0, end: 100 }], [{ start: 0, end: 100 }])).toEqual([]);
    expect(subtractIntervals([{ start: 0, end: 100 }], [{ start: 100, end: 120 }])).toEqual([
      { start: 0, end: 100 },
    ]);
    expect(
      subtractIntervals(
        [
          { start: 50, end: 60 },
          { start: 0, end: 10 },
        ],
        [{ start: 5, end: 55 }],
      ),
    ).toEqual([
      { start: 0, end: 5 },
      { start: 55, end: 60 },
    ]);
    expect(subtractIntervals([{ start: 0, end: 10 }], [{ start: 5, end: 5 }])).toEqual([
      { start: 0, end: 10 },
    ]);
  });

  it('weekdayOf uses the calendar date, 0 = Sunday', () => {
    expect(weekdayOf('2026-10-11')).toBe(0);
    expect(weekdayOf('2026-10-12')).toBe(1);
    expect(weekdayOf('2026-10-17')).toBe(6);
  });

  it('alignment is measured from salon-local midnight (BR-001)', () => {
    const dayStart = startOfZonedDay(DATE, IST).getTime();
    expect(isAligned(at('10:15'), dayStart, 15)).toBe(true);
    expect(isAligned(at('10:20'), dayStart, 15)).toBe(false);
    expect(hhmm([floorToSlot(at('10:29'), dayStart, 15)])).toEqual(['10:15']);
    expect(hhmm([floorToSlot(at('10:30'), dayStart, 15)])).toEqual(['10:30']);
  });
});

describe('workingWindows (BR-005)', () => {
  it('is salon hours ∩ stylist hours', () => {
    const windows = workingWindows(
      rules({ staff: { isWorking: true, start: '08:00', end: '21:00', breaks: [] } }),
    );
    expect(windows).toEqual([iv('09:30', '20:30')]);
  });

  it('is empty on holidays, salon-closed days, stylist days off, or with no overlap', () => {
    expect(workingWindows(rules({ isHoliday: true }))).toEqual([]);
    expect(
      workingWindows(rules({ salon: { isOpen: false, open: '09:30', close: '20:30' } })),
    ).toEqual([]);
    expect(
      workingWindows(
        rules({ staff: { isWorking: false, start: '10:00', end: '13:00', breaks: [] } }),
      ),
    ).toEqual([]);
    expect(
      workingWindows(rules({ salon: { isOpen: true, open: '14:00', close: '20:00' } })), // staff 10-13
    ).toEqual([]);
  });

  it('removes breaks and time-off, including time-off spanning several days', () => {
    const windows = workingWindows(
      rules({
        staff: {
          isWorking: true,
          start: '10:00',
          end: '18:00',
          breaks: [{ start: '13:30', end: '14:15' }],
        },
        timeOff: [
          { start: at('22:00', '2026-10-11'), end: at('10:30') }, // from the previous evening
          { start: at('17:00'), end: at('09:00', '2026-10-14') }, // into the next days
        ],
      }),
    );
    expect(windows).toEqual([iv('10:30', '13:30'), iv('14:15', '17:00')]);
  });
});

describe('staffDaySlots (03 §5.2 step 4)', () => {
  it('start and end of day: the last slot ends exactly at closing', () => {
    const slots = staffDaySlots(rules(), [], grid(60));
    expect(hhmm(slots)[0]).toBe('10:00');
    expect(hhmm(slots).at(-1)).toBe('12:00'); // 12:00-13:00 fits, 12:15 does not
    expect(slots).toHaveLength(9);
  });

  it('break boundaries: a slot may end at the break start and start at the break end', () => {
    const slots = staffDaySlots(
      rules({
        staff: {
          isWorking: true,
          start: '10:00',
          end: '13:00',
          breaks: [{ start: '11:00', end: '11:30' }],
        },
      }),
      [],
      grid(30),
    );
    expect(hhmm(slots)).toEqual([
      '10:00',
      '10:15',
      '10:30',
      '11:30',
      '11:45',
      '12:00',
      '12:15',
      '12:30',
    ]);
  });

  it('back-to-back bookings leave no gap; a booking frees its slot again when it ends', () => {
    const slots = staffDaySlots(rules(), [iv('10:30', '11:00'), iv('11:00', '11:30')], grid(30));
    expect(hhmm(slots)).toEqual(['10:00', '11:30', '11:45', '12:00', '12:15', '12:30']);
  });

  it('buffer: the span includes it and existing bookings block until blockedUntil', () => {
    // 45-minute service + 15-minute buffer = 60-minute span; existing booking 11:00-11:45 + 15 buffer.
    const slots = staffDaySlots(rules(), [iv('11:00', '12:00')], grid(60));
    expect(hhmm(slots)).toEqual(['10:00', '12:00']);
  });

  it('aligns to the granularity even when a window starts off-grid', () => {
    const slots = staffDaySlots(rules({ timeOff: [iv('09:00', '10:10')] }), [], grid(30, 15));
    expect(hhmm(slots)[0]).toBe('10:15');
    const coarse = staffDaySlots(rules(), [], grid(60, 30));
    expect(hhmm(coarse)).toEqual(['10:00', '10:30', '11:00', '11:30', '12:00']);
  });

  it('returns nothing when the span is longer than any free window', () => {
    expect(staffDaySlots(rules(), [], grid(240))).toEqual([]);
  });

  it('is DST-aware: wall-clock hours hold on a fall-back day (America/New_York, 2026-11-01)', () => {
    const ny = rules({
      date: '2026-11-01',
      timeZone: 'America/New_York',
      salon: { isOpen: true, open: '00:00', close: '23:00' },
      staff: { isWorking: true, start: '00:30', end: '03:00', breaks: [] },
    });
    const slots = staffDaySlots(ny, [], grid(60, 30));
    // 01:00-02:00 repeats at the change; local times stay on the half-hour grid.
    expect(slots.length).toBeGreaterThanOrEqual(4);
    for (const t of slots) {
      const minutes = new Date(t).getUTCMinutes();
      expect([0, 30]).toContain(minutes);
    }
    expect(new Date(slots[0]!).toISOString()).toBe('2026-11-01T04:30:00.000Z'); // 00:30 EDT
  });
});

describe('free windows, fit checks and filters', () => {
  it('freeWindows subtracts bookings from working windows; fitsWithin checks a whole span', () => {
    const free = freeWindows([iv('10:00', '13:00')], [iv('11:00', '11:30')]);
    expect(free).toEqual([iv('10:00', '11:00'), iv('11:30', '13:00')]);
    expect(fitsWithin(free, iv('10:00', '11:00'))).toBe(true);
    expect(fitsWithin(free, iv('10:30', '11:15'))).toBe(false);
    expect(fitsWithin([], iv('10:00', '10:15'))).toBe(false);
  });

  it('slotStarts walks each window separately', () => {
    const dayStart = startOfZonedDay(DATE, IST).getTime();
    expect(
      hhmm(slotStarts([iv('10:00', '10:30'), iv('12:00', '12:45')], dayStart, grid(30))),
    ).toEqual(['10:00', '12:00', '12:15']);
  });

  it('step 5 drops starts before a cut-off (now or now + lead time)', () => {
    const slots = [at('10:00'), at('10:15'), at('10:30')];
    expect(startsFrom(slots, at('10:15'))).toEqual([at('10:15'), at('10:30')]);
    expect(startsFrom(slots, at('11:00'))).toEqual([]);
  });

  it('step 6 merges stylists: union of starts, with who is free at each', () => {
    expect(
      mergeStaffSlots([
        { staffId: 'a', slots: [at('10:30'), at('10:00')] },
        { staffId: 'b', slots: [at('10:30'), at('11:00')] },
        { staffId: 'c', slots: [] },
      ]),
    ).toEqual([
      { startAt: at('10:00'), staffIds: ['a'] },
      { startAt: at('10:30'), staffIds: ['a', 'b'] },
      { startAt: at('11:00'), staffIds: ['b'] },
    ]);
  });
});
