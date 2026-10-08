import { describe, expect, it, vi } from 'vitest';
import { buildIcs, downloadFile } from '@/features/booking/ics';

describe('add to calendar (05 §4.1)', () => {
  it('builds an iCalendar event in UTC with escaped text', () => {
    const ics = buildIcs(
      {
        uid: 'b1@straightsalon',
        title: 'Haircut, Beard Trim at Straight Salon',
        description: 'Booking SS-1; bring a photo\nThanks',
        location: '12 MG Road, Bengaluru',
        startAt: '2026-10-12T05:30:00.000Z',
        endAt: '2026-10-12T06:30:00.000Z',
      },
      new Date('2026-10-06T09:12:44.000Z'),
    );
    const lines = ics.split('\r\n');
    expect(lines).toContain('DTSTART:20261012T053000Z');
    expect(lines).toContain('DTEND:20261012T063000Z');
    expect(lines).toContain('DTSTAMP:20261006T091244Z');
    expect(lines).toContain('SUMMARY:Haircut\\, Beard Trim at Straight Salon');
    expect(lines).toContain('DESCRIPTION:Booking SS-1\\; bring a photo\\nThanks');
    expect(lines).toContain('LOCATION:12 MG Road\\, Bengaluru');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('leaves out the location when the salon has no address', () => {
    const ics = buildIcs({
      uid: 'x',
      title: 't',
      description: 'd',
      startAt: '2026-10-12T05:30:00.000Z',
      endAt: '2026-10-12T06:30:00.000Z',
    });
    expect(ics).not.toContain('LOCATION');
  });

  it('downloads through a temporary object URL', () => {
    const create = vi.fn(() => 'blob:1');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadFile('SS-1.ics', new Blob(['x']));
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:1');
    expect(document.querySelector('a[download]')).toBeNull();
  });
});
