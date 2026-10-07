import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { holidaysRepository } from '../../src/modules/holidays/holidays.repository.js';
import { DailyStatsModel } from '../../src/modules/reports/reports.model.js';
import type { ManualClock } from '../../src/shared/time/clock.js';
import { encryptionKey } from '../factories/index.js';
import {
  bookAs,
  frozenClock,
  local,
  salonScenario,
  TODAY,
  type BookingBody,
  type Scenario,
} from '../helpers/booking.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { buildWorkerHarness } from '../helpers/worker.js';
import { buildApiTestApp } from '../setup/testApp.js';

// Reports: daily_stats via the stats consumer (09 §5), API-070..072, FR-070..072, US-05.
// Fixture stylists have no stored schedule, so each works the salon hours: 09:30-20:30 = 660 min.

let app: Express;
let clock: ManualClock;
let s: Scenario;
let worker: ReturnType<typeof buildWorkerHarness>;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearCollections();
  clock = frozenClock();
  const key = encryptionKey();
  const api = buildApiTestApp({ clock, modules: { outboxEncryptionKey: key } });
  app = api.app;
  worker = buildWorkerHarness({ clock, redis: api.redis, key });
  s = await salonScenario();
});

const post = (path: string, header: string, payload: object = {}) =>
  request(app).post(`/api/v1${path}`).set('Authorization', header).send(payload);
const get = (path: string, header?: string) => {
  const req = request(app).get(`/api/v1${path}`);
  return header ? req.set('Authorization', header) : req;
};

async function deskBooking(staffId: string, serviceIds: string[], time: string, date = TODAY) {
  const res = await bookAs(app, s.receptionist.header, {
    serviceIds,
    staffId,
    startAt: local(time, date),
    customerId: s.customer.user._id.toHexString(),
  });
  expect(res.status).toBe(201);
  return (res.body as BookingBody).id;
}

const complete = async (id: string) => {
  for (const status of ['CHECKED_IN', 'IN_SERVICE', 'COMPLETED']) {
    await post(`/bookings/${id}/status`, s.receptionist.header, { status }).expect(200);
  }
};

// One day at the salon (TODAY):
//   Ravi:  09:30 haircut + beard (60 min, 55,000) completed, paid 50,000 + 5,000 discount
//          10:30 haircut no-show; 12:00 haircut still BOOKED
//   Arjun: 10:00 haircut (45 min, 40,000) completed, paid in full; 13:00 haircut cancelled
async function aDay() {
  const b1 = await deskBooking(s.ravi.staffId, [s.haircut, s.beard], '09:30');
  const b2 = await deskBooking(s.arjun.staffId, [s.haircut], '10:00');
  const b3 = await deskBooking(s.ravi.staffId, [s.haircut], '12:00');
  const b4 = await deskBooking(s.arjun.staffId, [s.haircut], '13:00');
  const b5 = await deskBooking(s.ravi.staffId, [s.haircut], '10:30');
  await complete(b1);
  await post(`/bookings/${b1}/payment`, s.receptionist.header, {
    method: 'CASH',
    amountPaidMinor: 50_000,
    discountMinor: 5_000,
    discountReason: 'Loyalty',
  }).expect(200);
  await complete(b2);
  await post(`/bookings/${b2}/payment`, s.receptionist.header, {
    method: 'UPI',
    amountPaidMinor: 40_000,
  }).expect(200);
  await post(`/bookings/${b4}/cancel`, s.receptionist.header, { reason: 'Called' }).expect(200);
  clock.set(local('11:00'));
  await post(`/bookings/${b5}/status`, s.receptionist.header, { status: 'NO_SHOW' }).expect(200);
  expect(await worker.drain()).toMatchObject({ failed: 0 });
  return { b1, b2, b3, b4, b5 };
}

const statsRow = (date: string, staffId: string | null) =>
  DailyStatsModel.findOne({ date, staffId }).lean();

describe('stats consumer: daily_stats (02 §2.17, 09 §5)', () => {
  it('recomputes the day from bookings: counts, revenue, proportional service split, minutes', async () => {
    await aDay();
    expect(await statsRow(TODAY, null)).toMatchObject({
      bookings: 5,
      completed: 2,
      cancelled: 1,
      noShows: 1,
      revenueMinor: 90_000,
      bookedMinutes: 150, // 60 + 45 + the still-booked 45; not the no-show or the cancellation
      availableMinutes: 1_320,
    });
    // 50,000 split 40:15 -> 36,364 / 13,636 (largest remainder), plus Arjun's 40,000.
    const total = await statsRow(TODAY, null);
    expect(
      total!.byService.map((x) => [x.serviceId.toHexString(), x.count, x.revenueMinor]),
    ).toEqual([
      [s.haircut, 2, 76_364],
      [s.beard, 1, 13_636],
    ]);
    expect(await statsRow(TODAY, s.ravi.staffId)).toMatchObject({
      bookings: 3,
      completed: 1,
      noShows: 1,
      revenueMinor: 50_000,
      bookedMinutes: 105,
      availableMinutes: 660,
    });
    expect(await statsRow(TODAY, s.arjun.staffId)).toMatchObject({
      bookings: 2,
      cancelled: 1,
      revenueMinor: 40_000,
      bookedMinutes: 45,
    });
  });

  it('EVT-011 a reschedule to another day updates both days', async () => {
    const { b3 } = await aDay();
    await post(`/bookings/${b3}/reschedule`, s.receptionist.header, {
      startAt: local('12:00', '2026-10-13'),
      override: true, // inside the 2-hour cut-off at 11:00 (BR-006)
      reason: 'Customer asked',
    }).expect(200);
    await worker.drain();
    expect(await statsRow(TODAY, null)).toMatchObject({ bookings: 4, bookedMinutes: 105 });
    expect(await statsRow('2026-10-13', null)).toMatchObject({ bookings: 1, bookedMinutes: 45 });
  });

  it('a repeated delivery recomputes to the same figures (idempotent)', async () => {
    await aDay();
    const before = await DailyStatsModel.find({}, { _id: 0, createdAt: 0, updatedAt: 0 })
      .sort({ date: 1, staffId: 1 })
      .lean();
    for (const event of worker.bus.published.filter((e) => e.type.startsWith('booking.'))) {
      await worker.bus.publish({ ...event, eventId: randomUUID() });
    }
    const after = await DailyStatsModel.find({}, { _id: 0, createdAt: 0, updatedAt: 0 })
      .sort({ date: 1, staffId: 1 })
      .lean();
    expect(after).toEqual(before);
  });

  it('stats-reconcile recomputes yesterday; rebuildAll covers every booking date', async () => {
    await aDay();
    await DailyStatsModel.deleteMany({});
    clock.set(local('03:00', '2026-10-13'));
    expect(await worker.services.reports.reconcileYesterday()).toBe(TODAY);
    expect(await statsRow(TODAY, null)).toMatchObject({ bookings: 5, revenueMinor: 90_000 });

    await DailyStatsModel.deleteMany({});
    expect(await worker.services.reports.rebuildAll()).toEqual({
      from: TODAY,
      to: TODAY,
      days: 1,
    });
    expect(await DailyStatsModel.countDocuments()).toBe(3); // salon + Ravi + Arjun
  });

  it('a holiday has no working time; days without bookings still get a salon row', async () => {
    await holidaysRepository.create({ date: '2026-10-14', name: 'Diwali' });
    expect(await worker.services.reports.rebuild('2026-10-14', '2026-10-15')).toBe(2);
    expect(await DailyStatsModel.find({ date: '2026-10-14' }).lean()).toMatchObject([
      { staffId: null, bookings: 0, availableMinutes: 0 },
    ]);
    expect(await statsRow('2026-10-15', null)).toMatchObject({ availableMinutes: 1_320 });
  });
});

describe('GET /reports/summary (API-071) and summary.csv (API-072)', () => {
  it('US-05 totals and breakdowns match the recorded payments for the range', async () => {
    await aDay();
    const res = await get(`/reports/summary?from=2026-10-11&to=2026-10-13`, s.admin.header);
    expect(res.status).toBe(200);
    const money = (amountMinor: number) => ({ amountMinor, currency: 'INR' });
    expect(res.body).toMatchObject({
      from: '2026-10-11',
      to: '2026-10-13',
      timezone: 'Asia/Kolkata',
      totals: {
        bookings: 5,
        completed: 2,
        cancelled: 1,
        noShows: 1,
        noShowRate: 0.25, // 1 of the 4 bookings that were not cancelled
        revenue: money(90_000),
        bookedMinutes: 150,
        availableMinutes: 1_320,
        utilisation: 0.1136,
      },
      byService: [
        { serviceId: s.haircut, name: 'Haircut', count: 2, revenue: money(76_364) },
        { serviceId: s.beard, name: 'Beard Trim', count: 1, revenue: money(13_636) },
      ],
      byStaff: [
        { staffId: s.arjun.staffId, displayName: 'Arjun', revenue: money(40_000), bookings: 2 },
        {
          staffId: s.ravi.staffId,
          displayName: 'Ravi',
          revenue: money(50_000),
          utilisation: 0.1591,
        },
      ],
    });
    const body = res.body as { byDay: { date: string; bookings: number }[] };
    expect(body.byDay.map((d) => [d.date, d.bookings])).toEqual([
      ['2026-10-11', 0],
      ['2026-10-12', 5],
      ['2026-10-13', 0],
    ]);
  });

  it('cached for 5 minutes, but a recompute clears it (08 §2 reports tag)', async () => {
    const { b3 } = await aDay();
    const first = await get(`/reports/summary?from=${TODAY}&to=${TODAY}`, s.admin.header);
    expect(first.body).toMatchObject({ totals: { cancelled: 1 } });
    await post(`/bookings/${b3}/cancel`, s.receptionist.header, {
      override: true,
      reason: 'Called',
    }).expect(200);
    await worker.drain();
    const second = await get(`/reports/summary?from=${TODAY}&to=${TODAY}`, s.admin.header);
    expect(second.body).toMatchObject({ totals: { cancelled: 2 } });
  });

  it('FR-072 the CSV download has the same figures', async () => {
    await aDay();
    const res = await get(`/reports/summary.csv?from=${TODAY}&to=${TODAY}`, s.admin.header);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="straight-salon-report-${TODAY}-to-${TODAY}.csv"`,
    );
    const lines = res.text.trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'section,key,name,bookings,completed,cancelled,no_shows,no_show_rate,revenue_minor,currency,booked_minutes,available_minutes,utilisation',
    );
    expect(lines[1]).toBe('total,,,5,2,1,1,0.25,90000,INR,150,1320,0.1136');
    expect(lines).toContain(`day,${TODAY},,5,2,1,1,0.25,90000,INR,150,1320,0.1136`);
    expect(lines).toContain(`staff,${s.arjun.staffId},Arjun,2,1,1,0,0,40000,INR,45,660,0.0682`);
    expect(lines).toContain(`service,${s.beard},Beard Trim,,1,,,,13636,INR,,,`);
    expect(lines).toHaveLength(1 + 1 + 1 + 2 + 2);
  });

  it('validates the range: from <= to, at most 366 days, both required, nothing else', async () => {
    const q = (query: string) => get(`/reports/summary?${query}`, s.admin.header);
    expect((await q('from=2026-10-12&to=2026-10-11')).status).toBe(400);
    expect((await q('from=2025-10-12&to=2026-10-12')).status).toBe(200); // 366 days
    expect((await q('from=2025-10-11&to=2026-10-12')).status).toBe(400); // 367
    expect((await q('from=2026-10-12')).status).toBe(400);
    expect((await q('from=2026-10-12&to=2026-10-12&staffId=x')).status).toBe(400);
    expect(
      (await get('/reports/summary.csv?from=2026-10-13&to=2026-10-12', s.admin.header)).status,
    ).toBe(400);
  });

  it('permission reports:read: ADMIN only', async () => {
    const range = `from=${TODAY}&to=${TODAY}`;
    expect((await get(`/reports/summary?${range}`, s.receptionist.header)).status).toBe(403);
    expect((await get(`/reports/summary.csv?${range}`, s.receptionist.header)).status).toBe(403);
    expect((await get(`/reports/summary?${range}`, s.ravi.header)).status).toBe(403);
    expect((await get(`/reports/summary?${range}`)).status).toBe(401);
  });
});

describe('GET /reports/dashboard (API-070, FR-070)', () => {
  it("today's counts, revenue so far and the per-stylist timeline, live", async () => {
    const { b1, b2, b3, b5 } = await aDay();
    const res = await get('/reports/dashboard', s.receptionist.header);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      date: TODAY,
      timezone: 'Asia/Kolkata',
      counts: { BOOKED: 1, CHECKED_IN: 0, IN_SERVICE: 0, COMPLETED: 2, CANCELLED: 1, NO_SHOW: 1 },
      totals: { bookings: 5, revenue: { amountMinor: 90_000, currency: 'INR' } },
    });
    const staff = (res.body as { staff: { displayName: string; bookings: { id: string }[] }[] })
      .staff;
    // Cancelled bookings are left off the timeline; stylists by name.
    expect(staff.map((x) => [x.displayName, x.bookings.map((b) => b.id)])).toEqual([
      ['Arjun', [b2]],
      ['Ravi', [b1, b5, b3]],
    ]);
    expect(staff[1]!.bookings[0]).toMatchObject({
      status: 'COMPLETED',
      customerName: 'Ananya Rao',
      services: ['Haircut', 'Beard Trim'],
    });

    const other = await get('/reports/dashboard?date=2026-10-13', s.admin.header);
    expect(other.body).toMatchObject({ date: '2026-10-13', totals: { bookings: 0 } });
    expect((await get('/reports/dashboard?date=13-10-2026', s.admin.header)).status).toBe(400);
  });

  it('permission reports:dashboard: reception and admin; not stylists or customers', async () => {
    expect((await get('/reports/dashboard', s.admin.header)).status).toBe(200);
    expect((await get('/reports/dashboard', s.ravi.header)).status).toBe(403);
    expect((await get('/reports/dashboard', s.customer.header)).status).toBe(403);
    expect((await get('/reports/dashboard')).status).toBe(401);
  });
});
