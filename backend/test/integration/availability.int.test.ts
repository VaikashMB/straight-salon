import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HolidayModel } from '../../src/modules/holidays/holidays.model.js';
import { ServiceModel } from '../../src/modules/catalog/catalog.model.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { newId } from '../helpers/fixtures.js';
import {
  bookAs,
  frozenClock,
  local,
  salonScenario,
  TODAY,
  type Scenario,
} from '../helpers/booking.js';
import { buildApiTestApp } from '../setup/testApp.js';

let app: Express;
let redis: ReturnType<typeof buildApiTestApp>['redis'];
let s: Scenario;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearCollections();
  ({ app, redis } = buildApiTestApp({ clock: frozenClock() }));
  s = await salonScenario();
});

interface Slots {
  date: string;
  timezone: string;
  slots: { startAt: string; staffIds: string[] }[];
}
const slots = async (query: string, header?: string) => {
  const req = request(app).get(`/api/v1/availability?${query}`);
  const res = await (header ? req.set('Authorization', header) : req);
  return res;
};
const starts = (body: unknown) => (body as Slots).slots.map((x) => x.startAt);

describe('GET /availability (API-040, 03 §5.2)', () => {
  it('public: one stylist, today, from now + lead time to closing, aligned to 15 min', async () => {
    const res = await slots(`serviceIds=${s.haircut}&staffId=${s.ravi.staffId}&date=${TODAY}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ date: TODAY, timezone: 'Asia/Kolkata' });
    const list = starts(res.body);
    expect(list[0]).toBe(local('10:00')); // now 09:00 + 60-minute lead time (BR-002)
    expect(list.at(-1)).toBe(local('19:45')); // 45 minutes before 20:30
    expect(list).toHaveLength(40);
  });

  it('BR-002: staff roles see slots inside the lead time, but never in the past', async () => {
    const res = await slots(
      `serviceIds=${s.haircut}&staffId=${s.ravi.staffId}&date=${TODAY}`,
      s.receptionist.header,
    );
    expect(starts(res.body)[0]).toBe(local('09:30')); // salon opens at 09:30, after now (09:00)
    const customer = await slots(
      `serviceIds=${s.haircut}&staffId=${s.ravi.staffId}&date=${TODAY}`,
      s.customer.header,
    );
    expect(starts(customer.body)[0]).toBe(local('10:00'));
  });

  it('"any" unions qualified stylists and lists who is free at each start', async () => {
    await bookAs(app, s.receptionist.header, {
      serviceIds: [s.haircut],
      staffId: s.ravi.staffId,
      startAt: local('11:00'),
      customerId: s.customer.user._id.toHexString(),
    }).expect(201);
    const res = await slots(`serviceIds=${s.haircut}&staffId=any&date=${TODAY}`);
    const at11 = (res.body as Slots).slots.find((x) => x.startAt === local('11:00'));
    expect(at11?.staffIds).toEqual([s.arjun.staffId]);
    const at10 = (res.body as Slots).slots.find((x) => x.startAt === local('10:00'));
    expect(at10?.staffIds.sort()).toEqual([s.arjun.staffId, s.ravi.staffId].sort());
    // Only Ravi does beards: "any" for a beard trim is Ravi alone.
    const beard = await slots(`serviceIds=${s.beard}&date=${TODAY}`);
    expect(new Set((beard.body as Slots).slots.flatMap((x) => x.staffIds))).toEqual(
      new Set([s.ravi.staffId]),
    );
  });

  it('bookings remove their time (back-to-back allowed); the cache entry is cleared by the booking (08 §7)', async () => {
    const query = `serviceIds=${s.haircut}&staffId=${s.ravi.staffId}&date=${TODAY}`;
    await slots(query);
    const key = `ss:v1:avail:${s.ravi.staffId}:${TODAY}:45`;
    expect(await redis.get(key)).not.toBeNull();

    await bookAs(app, s.receptionist.header, {
      serviceIds: [s.haircut],
      staffId: s.ravi.staffId,
      startAt: local('11:00'),
      customerId: s.customer.user._id.toHexString(),
    }).expect(201);
    expect(await redis.get(key)).toBeNull();

    const list = starts((await slots(query)).body);
    expect(list).toContain(local('10:15')); // ends 11:00, back to back
    expect(list).not.toContain(local('10:30'));
    expect(list).not.toContain(local('11:30'));
    expect(list).toContain(local('11:45'));
  });

  it('holidays, a stylist day off, breaks and time-off are respected', async () => {
    await HolidayModel.create({ date: '2026-10-13', name: 'Closed' });
    const holiday = await slots(`serviceIds=${s.haircut}&staffId=any&date=2026-10-13`);
    expect((holiday.body as Slots).slots).toEqual([]);

    const week = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      isWorking: dayOfWeek !== 3,
      start: '10:00',
      end: '14:00',
      breaks: [{ start: '12:00', end: '12:30' }],
    }));
    await request(app)
      .put(`/api/v1/staff/${s.ravi.staffId}/schedule`)
      .set('Authorization', s.admin.header)
      .send({ weekly: week })
      .expect(200);
    await request(app)
      .post(`/api/v1/staff/${s.ravi.staffId}/time-off`)
      .set('Authorization', s.admin.header)
      .send({ startAt: local('13:00'), endAt: local('14:00') })
      .expect(201);
    const list = starts(
      (await slots(`serviceIds=${s.haircut}&staffId=${s.ravi.staffId}&date=${TODAY}`)).body,
    );
    expect(list).toEqual([
      local('10:00'),
      local('10:15'),
      local('10:30'),
      local('10:45'),
      local('11:00'),
      local('11:15'),
      // 12:30-13:00 (between the break and the time-off) is too short for 45 minutes.
    ]);
    // A shorter service fits that gap.
    const beardSlots = starts(
      (await slots(`serviceIds=${s.beard}&staffId=${s.ravi.staffId}&date=${TODAY}`)).body,
    );
    expect(beardSlots).toContain(local('12:45'));
    expect(beardSlots).not.toContain(local('13:00'));
    const wednesday = await slots(
      `serviceIds=${s.haircut}&staffId=${s.ravi.staffId}&date=2026-10-14`,
    );
    expect((wednesday.body as Slots).slots).toEqual([]);
  });

  it('dates in the past or beyond the advance window (BR-003) have no slots', async () => {
    for (const date of ['2026-10-11', '2026-11-12']) {
      const res = await slots(`serviceIds=${s.haircut}&date=${date}`);
      expect(res.status).toBe(200);
      expect((res.body as Slots).slots).toEqual([]);
    }
    expect(
      starts((await slots(`serviceIds=${s.haircut}&date=2026-11-11`)).body).length,
    ).toBeGreaterThan(0);
  });

  it('multiple services need the summed duration (US-01: 45 + 15 = 60 minutes)', async () => {
    const res = await slots(`serviceIds=${s.haircut},${s.beard}&staffId=any&date=${TODAY}`);
    const list = starts(res.body);
    expect(list.at(-1)).toBe(local('19:30'));
    expect(new Set((res.body as Slots).slots.flatMap((x) => x.staffIds))).toEqual(
      new Set([s.ravi.staffId]),
    );
  });

  it('422 for a stylist who cannot do the services; 400 for unknown/inactive services or bad input', async () => {
    const res = await slots(`serviceIds=${s.beard}&staffId=${s.arjun.staffId}&date=${TODAY}`);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'STAFF_CANNOT_PERFORM_SERVICE' });
    expect((await slots(`serviceIds=${s.haircut}&staffId=${newId()}&date=${TODAY}`)).status).toBe(
      422,
    );
    expect((await slots(`serviceIds=${newId()}&date=${TODAY}`)).status).toBe(400);
    await ServiceModel.updateOne({ name: 'Hair Colour' }, { isActive: false });
    expect((await slots(`serviceIds=${s.colour}&date=${TODAY}`)).status).toBe(400);
    expect((await slots(`serviceIds=${s.haircut},${s.haircut}&date=${TODAY}`)).status).toBe(400);
    expect((await slots(`serviceIds=${s.haircut}&date=12-10-2026`)).status).toBe(400);
    expect((await slots(`date=${TODAY}`)).status).toBe(400);
  });
});

describe('GET /availability/days (API-041)', () => {
  it('lists dates with at least one slot, skipping holidays and days off; at most 31 days', async () => {
    await HolidayModel.create({ date: '2026-10-14', name: 'Closed' });
    const res = await request(app).get(
      `/api/v1/availability/days?serviceIds=${s.haircut}&staffId=any&from=2026-10-11&to=2026-10-16`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      from: '2026-10-11',
      to: '2026-10-16',
      timezone: 'Asia/Kolkata',
      availableDates: ['2026-10-12', '2026-10-13', '2026-10-15', '2026-10-16'],
    });
    expect(
      (
        await request(app).get(
          `/api/v1/availability/days?serviceIds=${s.haircut}&from=2026-10-12&to=2026-11-12`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app).get(
          `/api/v1/availability/days?serviceIds=${s.haircut}&from=2026-10-16&to=2026-10-12`,
        )
      ).status,
    ).toBe(400);
  });

  it('today drops out for customers once the lead time leaves no slot, but not for staff', async () => {
    const late = buildApiTestApp({ clock: frozenClock(local('19:30')) }).app; // 19:30 IST
    const query = `/api/v1/availability/days?serviceIds=${s.haircut}&staffId=${s.ravi.staffId}&from=${TODAY}&to=2026-10-13`;
    const publicView = await request(late).get(query);
    expect((publicView.body as { availableDates: string[] }).availableDates).toEqual([
      '2026-10-13',
    ]);
    const staffView = await request(late).get(query).set('Authorization', s.receptionist.header);
    expect((staffView.body as { availableDates: string[] }).availableDates).toEqual([
      TODAY,
      '2026-10-13',
    ]);
  });
});
