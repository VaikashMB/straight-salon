import { describe, expect, it, vi } from 'vitest';
import { bookingCalendarFile, buildIcs, downloadFile } from '@/features/booking/ics';
import { makeBooking } from '../../helpers/fixtures';

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

  it('names the file after the booking and describes services, stylist and address', async () => {
    const file = bookingCalendarFile(makeBooking(), {
      name: 'Straight Salon',
      address: '12 MG Road, Bengaluru',
    });
    expect(file.filename).toBe('SS-261012-7KQ2.ics');
    expect(file.content.type).toBe('text/calendar');
    const text = await file.content.text();
    expect(text).toContain('SUMMARY:Haircut\\, Beard Trim at Straight Salon');
    expect(text).toContain('DESCRIPTION:Booking SS-261012-7KQ2 with Ravi.');
    expect(text).toContain('LOCATION:12 MG Road\\, Bengaluru');
  });
});
