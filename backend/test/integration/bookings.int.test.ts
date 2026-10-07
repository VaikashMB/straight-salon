import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BookingModel } from '../../src/modules/bookings/bookings.model.js';
import { HolidayModel } from '../../src/modules/holidays/holidays.model.js';
import { ServiceModel } from '../../src/modules/catalog/catalog.model.js';
import { AuditLogModel } from '../../src/shared/audit/auditLog.model.js';
import { StaffDayGuardModel } from '../../src/shared/db/staffDayGuard.js';
import { OutboxModel } from '../../src/shared/events/outbox.model.js';
import { ServiceUnavailableError } from '../../src/shared/errors/index.js';
import type { ManualClock } from '../../src/shared/time/clock.js';
import { createUser, loginAs } from '../helpers/auth.js';
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
import { createService, createStylist, newId } from '../helpers/fixtures.js';
import { buildApiTestApp } from '../setup/testApp.js';

let app: Express;
let clock: ManualClock;
let s: Scenario;
let redis: ReturnType<typeof buildApiTestApp>['redis'];

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearCollections();
  clock = frozenClock();
  ({ app, redis } = buildApiTestApp({ clock }));
  s = await salonScenario();
});

const body = (res: request.Response) => res.body as BookingBody;
const customerId = () => s.customer.user._id.toHexString();
const book = (startTime: string, extra: Record<string, unknown> = {}, header = s.customer.header) =>
  bookAs(app, header, {
    serviceIds: [s.haircut],
    staffId: s.ravi.staffId,
    startAt: local(startTime),
    ...extra,
  });
const deskBook = (startTime: string, extra: Record<string, unknown> = {}) =>
  book(startTime, { customerId: customerId(), ...extra }, s.receptionist.header);
const post = (path: string, header: string, payload: object = {}) =>
  request(app).post(`/api/v1${path}`).set('Authorization', header).send(payload);
const get = (path: string, header: string) =>
  request(app).get(`/api/v1${path}`).set('Authorization', header);

describe('POST /bookings (API-050, 03 §5.1)', () => {
  it('a customer books: 201 with the DTO; booking + audit + outbox are written together (09 §9)', async () => {
    const res = await book('11:00', { notes: 'Short on the sides' });
    expect(res.status).toBe(201);
    expect(body(res)).toMatchObject({
      status: 'BOOKED',
      startAt: local('11:00'),
      endAt: local('11:45'),
      source: 'ONLINE',
      staff: { id: s.ravi.staffId, displayName: 'Ravi' },
      customer: { id: customerId(), name: 'Ananya Rao' },
      canCancel: true,
      canReschedule: true,
    });
    expect(body(res).bookingRef).toMatch(/^SS-261012-[A-Z2-9]{4}$/);
    expect(res.body).toMatchObject({
      total: { amountMinor: 40_000, currency: 'INR' },
      payment: { status: 'UNPAID' },
      notes: 'Short on the sides',
      services: [{ name: 'Haircut', durationMin: 45, price: { amountMinor: 40_000 } }],
    });
    const id = body(res).id;
    expect(
      await AuditLogModel.findOne({ action: 'booking.create', entityId: id }).lean(),
    ).toMatchObject({
      actor: { id: customerId(), role: 'CUSTOMER' },
      after: { status: 'BOOKED', staffId: s.ravi.staffId },
    });
    expect(await OutboxModel.findOne({ type: 'booking.created' }).lean()).toMatchObject({
      aggregateId: id,
      payload: {
        bookingId: id,
        staffId: s.ravi.staffId,
        customerId: customerId(),
        source: 'ONLINE',
      },
    });
    expect(
      await StaffDayGuardModel.findOne({ staffId: s.ravi.staff._id, date: TODAY }).lean(),
    ).toMatchObject({
      seq: 1,
    });
  });

  it('FR-032: total duration and price are summed and snapshotted', async () => {
    const res = await book('11:00', { serviceIds: [s.haircut, s.beard] });
    expect(res.body).toMatchObject({ endAt: local('12:00'), total: { amountMinor: 55_000 } });
    await ServiceModel.updateOne({ name: 'Haircut' }, { priceMinor: 99_000 });
    const again = await get(`/bookings/${body(res).id}`, s.customer.header);
    expect(again.body).toMatchObject({ total: { amountMinor: 55_000 } }); // snapshot kept
  });

  it('BR-001 rejects a start off the 15-minute grid (422); BR-001 accepts an aligned one', async () => {
    const res = await bookAs(app, s.customer.header, {
      serviceIds: [s.haircut],
      staffId: s.ravi.staffId,
      startAt: local('11:10'),
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED', errors: [{ path: 'startAt' }] });
    expect((await book('11:15')).status).toBe(201);
  });

  it('BR-002 enforces the lead time for customers but not for reception; nobody books the past', async () => {
    const tooSoon = await book('09:45'); // now 09:00, lead 60 minutes
    expect(tooSoon.status).toBe(422);
    expect(tooSoon.body).toMatchObject({ code: 'LEAD_TIME_VIOLATION' });
    expect((await book('10:00')).status).toBe(201);
    expect((await deskBook('09:30', { staffId: s.arjun.staffId })).status).toBe(201);
    clock.set(local('12:00'));
    const past = await deskBook('11:00', { staffId: s.arjun.staffId });
    expect(past.status).toBe(422);
    expect(past.body).toMatchObject({ code: 'LEAD_TIME_VIOLATION' });
  });

  it('BR-003 rejects starts beyond maxAdvanceDays (30); the last allowed day works', async () => {
    const tooFar = await book('11:00', { startAt: local('11:00', '2026-11-12') });
    expect(tooFar.status).toBe(422);
    expect(tooFar.body).toMatchObject({ code: 'ADVANCE_WINDOW_VIOLATION' });
    expect((await book('11:00', { startAt: local('11:00', '2026-11-11') })).status).toBe(201);
  });

  it('BR-004 no overlap: the same slot again is 409 SLOT_UNAVAILABLE; back-to-back is fine', async () => {
    expect((await deskBook('11:00')).status).toBe(201);
    const clash = await deskBook('11:30');
    expect(clash.status).toBe(409);
    expect(clash.body).toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect((await deskBook('11:45')).status).toBe(201);
    expect((await deskBook('10:15')).status).toBe(201);
  });

  it('BR-005 rejects times outside hours, in breaks, during time-off or on holidays', async () => {
    const outside = await deskBook('20:00'); // 45 minutes past 20:30 closing
    expect(outside.status).toBe(422);
    expect(outside.body).toMatchObject({ code: 'OUTSIDE_BUSINESS_HOURS' });

    await request(app)
      .post(`/api/v1/staff/${s.ravi.staffId}/time-off`)
      .set('Authorization', s.admin.header)
      .send({ startAt: local('15:00'), endAt: local('16:00') })
      .expect(201);
    expect((await deskBook('14:30')).body).toMatchObject({ code: 'OUTSIDE_BUSINESS_HOURS' });

    await HolidayModel.create({ date: '2026-10-13', name: 'Closed' });
    expect((await deskBook('11:00', { startAt: local('11:00', '2026-10-13') })).body).toMatchObject(
      {
        code: 'OUTSIDE_BUSINESS_HOURS',
      },
    );
    expect((await deskBook('19:45')).status).toBe(201); // ends exactly at closing
  });

  it('BR-007: the stylist must perform every service and be active; services must be active', async () => {
    const cannot = await book('11:00', { serviceIds: [s.beard], staffId: s.arjun.staffId });
    expect(cannot.status).toBe(422);
    expect(cannot.body).toMatchObject({ code: 'STAFF_CANNOT_PERFORM_SERVICE' });
    const gone = await createStylist({ displayName: 'Gone', serviceIds: [], isActive: false });
    expect((await book('11:00', { staffId: gone.staffId })).body).toMatchObject({
      code: 'STAFF_CANNOT_PERFORM_SERVICE',
    });
    await ServiceModel.updateOne({ name: 'Haircut' }, { isActive: false });
    expect((await book('11:00')).status).toBe(400);
  });

  it('BR-008: 1 to 5 services, no duplicates (400)', async () => {
    const six = await Promise.all(
      Array.from({ length: 6 }, () => createService({ durationMin: 15 })),
    );
    for (const serviceIds of [[], [s.haircut, s.haircut], six.map((x) => x._id.toHexString())]) {
      expect((await book('11:00', { serviceIds })).status).toBe(400);
    }
  });

  it('BR-009: a customer may hold 3 future BOOKED bookings; reception may book a 4th for them', async () => {
    for (const time of ['10:00', '11:00', '12:00']) expect((await book(time)).status).toBe(201);
    const fourth = await book('13:00');
    expect(fourth.status).toBe(422);
    expect(fourth.body).toMatchObject({ code: 'BOOKING_LIMIT_REACHED' });
    expect((await deskBook('13:00')).status).toBe(201);
  });

  it('FR-033: "any" picks the qualified stylist with the fewest bookings that day, then by name', async () => {
    // Tie (0 each): alphabetical -> Arjun.
    const first = await book('11:00', { staffId: 'any' });
    expect(body(first).staff.displayName).toBe('Arjun');
    // Arjun now has 1, Ravi 0 -> Ravi, even at another time.
    const second = await book('15:00', { staffId: 'any' });
    expect(body(second).staff.displayName).toBe('Ravi');
    // At 11:00 Arjun is busy, so "any" falls through to Ravi.
    const third = await deskBook('11:00', { staffId: 'any' });
    expect(body(third).staff.displayName).toBe('Ravi');
    // Everyone busy at 11:00 -> 409.
    expect((await deskBook('11:15', { staffId: 'any' })).status).toBe(409);
  });

  it('staff-only fields: customers cannot set customerId/source/checkInNow; reception must name a customer', async () => {
    const res = await book('11:00', { source: 'PHONE' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ errors: [{ path: 'source' }] });
    expect((await book('11:00', {}, s.receptionist.header)).status).toBe(400);
    const staffUser = await createUser({ role: 'STAFF' });
    expect((await deskBook('11:00', { customerId: staffUser._id.toHexString() })).status).toBe(400);
    const phone = await deskBook('11:00');
    expect(body(phone).source).toBe('PHONE'); // default for reception (decision 2026-10-07)
    expect((await post('/bookings', (await loginAs('STAFF')).header, {})).status).toBe(403);
    expect((await request(app).post('/api/v1/bookings').send({})).status).toBe(401);
  });

  it('walk-in (checkInNow, US-03): CHECKED_IN, WALK_IN, at the current slot boundary', async () => {
    clock.set(local('11:07'));
    const res = await post('/bookings', s.receptionist.header, {
      serviceIds: [s.haircut],
      staffId: s.ravi.staffId,
      customerId: customerId(),
      checkInNow: true,
    });
    expect(res.status).toBe(201);
    expect(body(res)).toMatchObject({
      status: 'CHECKED_IN',
      source: 'WALK_IN',
      startAt: local('11:00'),
    });
    // Ravi is busy until 11:45, so the next walk-in with him starts then.
    const next = await post('/bookings', s.receptionist.header, {
      serviceIds: [s.haircut],
      staffId: s.ravi.staffId,
      customerId: customerId(),
      checkInNow: true,
    });
    expect(body(next).startAt).toBe(local('11:45'));
    // "any" takes whoever is free soonest: Arjun now.
    const any = await post('/bookings', s.receptionist.header, {
      serviceIds: [s.haircut],
      staffId: 'any',
      customerId: customerId(),
      checkInNow: true,
    });
    expect(body(any)).toMatchObject({ startAt: local('11:00'), staff: { displayName: 'Arjun' } });
  });

  it('walk-in after closing is 409; checkInNow with startAt is 400', async () => {
    clock.set(local('20:20'));
    const res = await post('/bookings', s.receptionist.header, {
      serviceIds: [s.haircut],
      staffId: 'any',
      customerId: customerId(),
      checkInNow: true,
    });
    expect(res.status).toBe(409);
    const both = await post('/bookings', s.receptionist.header, {
      serviceIds: [s.haircut],
      staffId: 'any',
      customerId: customerId(),
      checkInNow: true,
      startAt: local('20:00'),
    });
    expect(both.status).toBe(400);
  });

  it('503 TEMPORARILY_UNAVAILABLE when the lock store is down (08 §5)', async () => {
    const down = buildApiTestApp({
      clock,
      lock: {
        acquire: () => Promise.reject(new ServiceUnavailableError()),
        release: () => Promise.resolve(false),
      },
    }).app;
    const res = await bookAs(down, s.customer.header, {
      serviceIds: [s.haircut],
      staffId: s.ravi.staffId,
      startAt: local('11:00'),
    });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'TEMPORARILY_UNAVAILABLE' });
    expect(await BookingModel.countDocuments()).toBe(0);
  });

  it('20 booking attempts per hour per user (06 §4), then 429', async () => {
    const limited = buildApiTestApp({
      clock,
      modules: { bookingRateLimit: { windowMs: 60_000, max: 2 } },
    }).app;
    const attempt = () =>
      bookAs(limited, s.customer.header, {
        serviceIds: [s.haircut],
        staffId: s.ravi.staffId,
        startAt: local('09:00'),
      });
    await attempt();
    await attempt();
    expect((await attempt()).status).toBe(429);
  });
});

describe('Idempotency-Key (03 §9)', () => {
  it('a retry with the same key and body replays the first response; another body is 422', async () => {
    const key = 'f0c7a5e4-1111-4b1e-9f00-000000000001';
    const payload = { serviceIds: [s.haircut], staffId: s.ravi.staffId, startAt: local('11:00') };
    const first = await post('/bookings', s.customer.header, payload).set('Idempotency-Key', key);
    const again = await post('/bookings', s.customer.header, payload).set('Idempotency-Key', key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(body(again).id).toBe(body(first).id);
    expect(await BookingModel.countDocuments()).toBe(1);

    const other = await post('/bookings', s.customer.header, {
      ...payload,
      startAt: local('12:00'),
    }).set('Idempotency-Key', key);
    expect(other.status).toBe(422);
    expect(other.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('errors are not stored, so the same key can be retried; keys are per user; bad keys are 400', async () => {
    const key = 'retry-key-0002';
    const payload = { serviceIds: [s.haircut], staffId: s.ravi.staffId, startAt: local('09:45') };
    expect(
      (await post('/bookings', s.customer.header, payload).set('Idempotency-Key', key)).status,
    ).toBe(422);
    clock.set(local('08:30'));
    expect(
      (await post('/bookings', s.customer.header, payload).set('Idempotency-Key', key)).status,
    ).toBe(201);
    expect(await redis.get(`ss:v1:idem:${customerId()}:${key}`)).toContain('"state":"done"');
    expect(
      (await post('/bookings', s.customer.header, payload).set('Idempotency-Key', 'no')).status,
    ).toBe(400);
  });
});

describe('reading bookings (API-051..053)', () => {
  it('GET /bookings/:id: owner, assigned stylist and desk see it; others get 404 (06 §3)', async () => {
    const id = body(await book('11:00')).id;
    expect((await get(`/bookings/${id}`, s.customer.header)).status).toBe(200);
    expect((await get(`/bookings/${id}`, s.ravi.header)).status).toBe(200);
    expect((await get(`/bookings/${id}`, s.receptionist.header)).status).toBe(200);
    expect((await get(`/bookings/${id}`, (await loginAs('CUSTOMER')).header)).status).toBe(404);
    expect((await get(`/bookings/${id}`, s.arjun.header)).status).toBe(404);
    expect((await get(`/bookings/${newId()}`, s.admin.header)).status).toBe(404);
  });

  it("stylists see the customer's first name and a masked phone (decision 2026-10-07)", async () => {
    const id = body(await book('11:00')).id;
    const asStylist = body(await get(`/bookings/${id}`, s.ravi.header));
    expect(asStylist.customer.name).toBe('Ananya');
    expect(asStylist.customer.phone).toMatch(/^\+\d{4}\*+\d{2}$/);
    expect(asStylist.canCancel).toBe(false);
    const asDesk = body(await get(`/bookings/${id}`, s.receptionist.header));
    expect(asDesk.customer).toEqual({
      id: customerId(),
      name: 'Ananya Rao',
      phone: s.customer.user.phone,
    });
  });

  it('GET /bookings/me: upcoming soonest first; past latest first (cancelled count as past)', async () => {
    const a = body(await book('15:00')).id;
    const b = body(await book('11:00')).id;
    const c = body(await book('12:00')).id;
    await post(`/bookings/${c}/cancel`, s.customer.header);
    const upcoming = await get('/bookings/me?scope=upcoming', s.customer.header);
    expect((upcoming.body as { data: { id: string }[] }).data.map((x) => x.id)).toEqual([b, a]);
    const past = await get('/bookings/me?scope=past', s.customer.header);
    expect((past.body as { data: { id: string }[] }).data.map((x) => x.id)).toEqual([c]);
    expect((await get('/bookings/me', s.receptionist.header)).status).toBe(403);
  });

  it('GET /bookings: desk filters by date, stylist, status, reference and phone; stylists see only theirs', async () => {
    const r1 = body(await deskBook('11:00'));
    await deskBook('11:00', { staffId: s.arjun.staffId });
    const other = await loginAs('CUSTOMER', { phone: '+919811122233' });
    await book('12:00', { staffId: s.arjun.staffId }, other.header);
    await deskBook('11:00', { startAt: local('11:00', '2026-10-13') });

    const today = await get(`/bookings?date=${TODAY}`, s.receptionist.header);
    expect((today.body as { meta: { total: number } }).meta.total).toBe(3);
    const ravis = await get(
      `/bookings?staffId=${s.ravi.staffId}&from=${TODAY}&to=2026-10-13`,
      s.admin.header,
    );
    expect((ravis.body as { meta: { total: number } }).meta.total).toBe(2);
    const byRef = await get(`/bookings?q=${r1.bookingRef.toLowerCase()}`, s.receptionist.header);
    expect((byRef.body as { data: { id: string }[] }).data.map((x) => x.id)).toEqual([r1.id]);
    const byPhone = await get('/bookings?q=%2B9198111', s.receptionist.header);
    expect((byPhone.body as { meta: { total: number } }).meta.total).toBe(1);
    expect((await get('/bookings?q=%2B9100000', s.receptionist.header)).body).toMatchObject({
      meta: { total: 0 },
    });

    const mine = await get(`/bookings?staffId=${s.arjun.staffId}`, s.ravi.header); // staffId ignored
    expect(
      (mine.body as { data: { staff: { id: string } }[] }).data.every(
        (x) => x.staff.id === s.ravi.staffId,
      ),
    ).toBe(true);
    const noProfile = await loginAs('STAFF');
    expect((await get('/bookings', noProfile.header)).body).toMatchObject({ meta: { total: 0 } });
    expect((await get('/bookings', s.customer.header)).status).toBe(403);
    expect((await get(`/bookings?date=${TODAY}&from=${TODAY}`, s.admin.header)).status).toBe(400);
  });
});

describe('cancel and reschedule (API-054, API-055, BR-006, BR-015)', () => {
  it('BR-006: a customer cancels before the cut-off; the slot frees immediately (US-02); events + audit', async () => {
    const id = body(await book('15:00')).id;
    const res = await post(`/bookings/${id}/cancel`, s.customer.header, {
      reason: 'Plans changed',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'CANCELLED',
      canCancel: false,
      cancellation: { reason: 'Plans changed', overridden: false },
    });
    expect(
      await AuditLogModel.findOne({ action: 'booking.cancel', entityId: id }).lean(),
    ).toMatchObject({
      after: { status: 'CANCELLED' },
    });
    const events = (await OutboxModel.find({ aggregateId: id }).lean()).map((e) => e.type).sort();
    expect(events).toEqual(['booking.cancelled', 'booking.created', 'booking.status_changed']);
    expect((await deskBook('15:00')).status).toBe(201);
  });

  it('BR-006: inside the cut-off a customer gets 422 CUTOFF_PASSED and canCancel=false', async () => {
    const created = body(await book('10:30')); // 90 minutes away; cut-off 120
    expect(created.canCancel).toBe(false);
    const res = await post(`/bookings/${created.id}/cancel`, s.customer.header);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'CUTOFF_PASSED' });
    expect(
      (
        await post(`/bookings/${created.id}/cancel`, s.customer.header, {
          override: true,
          reason: 'x',
        })
      ).status,
    ).toBe(403);
  });

  it('BR-006: reception overrides with a reason (audited as booking.override); no reason is 400', async () => {
    const id = body(await book('10:30')).id;
    expect(
      (await post(`/bookings/${id}/cancel`, s.receptionist.header, { override: true })).status,
    ).toBe(400);
    const desk = await post(`/bookings/${id}/cancel`, s.receptionist.header);
    expect(desk.body).toMatchObject({ code: 'CUTOFF_PASSED' }); // override is explicit
    const res = await post(`/bookings/${id}/cancel`, s.receptionist.header, {
      override: true,
      reason: 'Customer called, unwell',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cancellation: { overridden: true } });
    expect(
      await AuditLogModel.findOne({ action: 'booking.override', entityId: id }).lean(),
    ).toMatchObject({
      metadata: { operation: 'cancel', reason: 'Customer called, unwell' },
    });
  });

  it('BR-015: reschedule keeps the booking and reference, moves time/stylist, frees the old slot', async () => {
    const created = body(await book('15:00'));
    const res = await post(`/bookings/${created.id}/reschedule`, s.customer.header, {
      startAt: local('16:00'),
      staffId: s.arjun.staffId,
    });
    expect(res.status).toBe(200);
    expect(body(res)).toMatchObject({
      id: created.id,
      bookingRef: created.bookingRef,
      startAt: local('16:00'),
      endAt: local('16:45'),
      staff: { id: s.arjun.staffId },
    });
    expect(await OutboxModel.findOne({ type: 'booking.rescheduled' }).lean()).toMatchObject({
      payload: {
        from: { startAt: local('15:00'), staffId: s.ravi.staffId },
        to: { startAt: local('16:00'), staffId: s.arjun.staffId },
      },
    });
    expect(await AuditLogModel.findOne({ action: 'booking.reschedule' }).lean()).toMatchObject({
      before: { startAt: local('15:00') },
      after: { startAt: local('16:00') },
    });
    expect((await deskBook('15:00')).status).toBe(201); // old slot free
    expect(
      await StaffDayGuardModel.findOne({ staffId: s.arjun.staff._id, date: TODAY }).lean(),
    ).toBeTruthy();
  });

  it('BR-015 re-validates BR-001..007: taken, unaligned, outside hours, unqualified, too soon', async () => {
    const id = body(await book('15:00')).id;
    await deskBook('17:00', { staffId: s.ravi.staffId });
    const move = (payload: object) =>
      post(`/bookings/${id}/reschedule`, s.customer.header, payload);
    expect((await move({ startAt: local('17:15') })).status).toBe(409);
    expect((await move({ startAt: local('16:05') })).body).toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect((await move({ startAt: local('20:00') })).body).toMatchObject({
      code: 'OUTSIDE_BUSINESS_HOURS',
    });
    expect((await move({ startAt: local('09:45') })).body).toMatchObject({
      code: 'LEAD_TIME_VIOLATION',
    });
    const beardOnly = body(await book('13:00', { serviceIds: [s.beard] }));
    expect(
      (
        await post(`/bookings/${beardOnly.id}/reschedule`, s.customer.header, {
          startAt: local('14:00'),
          staffId: s.arjun.staffId,
        })
      ).body,
    ).toMatchObject({ code: 'STAFF_CANNOT_PERFORM_SERVICE' });
    // A no-op reschedule changes nothing.
    expect((await move({ startAt: local('15:00') })).status).toBe(200);
    expect(await AuditLogModel.countDocuments({ action: 'booking.reschedule' })).toBe(0);
  });

  it('only BOOKED bookings can be cancelled or rescheduled (BR-010); stylists cannot (403)', async () => {
    const id = body(await deskBook('15:00')).id;
    await post(`/bookings/${id}/status`, s.receptionist.header, { status: 'CHECKED_IN' }).expect(
      200,
    );
    expect((await post(`/bookings/${id}/cancel`, s.receptionist.header)).body).toMatchObject({
      code: 'INVALID_STATUS_TRANSITION',
    });
    expect(
      (await post(`/bookings/${id}/reschedule`, s.receptionist.header, { startAt: local('16:00') }))
        .status,
    ).toBe(422);
    expect((await post(`/bookings/${id}/cancel`, s.ravi.header)).status).toBe(403);
    expect((await post(`/bookings/${id}/cancel`, (await loginAs('CUSTOMER')).header)).status).toBe(
      404,
    );
  });
});

describe('status changes (API-056, BR-010)', () => {
  it('BR-010 allows BOOKED -> CHECKED_IN -> IN_SERVICE -> COMPLETED by the assigned stylist, with events', async () => {
    const id = body(await deskBook('15:00')).id;
    for (const status of ['CHECKED_IN', 'IN_SERVICE', 'COMPLETED']) {
      const res = await post(`/bookings/${id}/status`, s.ravi.header, {
        status,
        note: `to ${status}`,
      });
      expect(res.status).toBe(200);
      expect(body(res).status).toBe(status);
    }
    const types = (await OutboxModel.find({ aggregateId: id }).lean()).map((e) => e.type);
    expect(types.filter((t) => t === 'booking.status_changed')).toHaveLength(3);
    expect(await OutboxModel.findOne({ type: 'booking.completed' }).lean()).toMatchObject({
      payload: {
        bookingId: id,
        staffId: s.ravi.staffId,
        serviceIds: [s.haircut],
        totalPriceMinor: 40_000,
      },
    });
    expect(
      await AuditLogModel.countDocuments({ action: 'booking.status_change', entityId: id }),
    ).toBe(3);
  });

  it('BR-010 rejects invalid transitions (422) and other stylists (404); customers are 403', async () => {
    const id = body(await deskBook('15:00')).id;
    expect(
      (await post(`/bookings/${id}/status`, s.ravi.header, { status: 'COMPLETED' })).body,
    ).toMatchObject({
      code: 'INVALID_STATUS_TRANSITION',
    });
    expect(
      (await post(`/bookings/${id}/status`, s.arjun.header, { status: 'CHECKED_IN' })).status,
    ).toBe(404);
    expect(
      (await post(`/bookings/${id}/status`, s.customer.header, { status: 'CHECKED_IN' })).status,
    ).toBe(403);
    expect(
      (await post(`/bookings/${id}/status`, s.ravi.header, { status: 'CANCELLED' })).status,
    ).toBe(400);
  });

  it('BR-010 NO_SHOW only once the start time has passed (decision 2026-10-07), emitting EVT-015', async () => {
    const id = body(await deskBook('15:00')).id;
    const early = await post(`/bookings/${id}/status`, s.receptionist.header, {
      status: 'NO_SHOW',
    });
    expect(early.status).toBe(422);
    clock.set(local('15:05'));
    const res = await post(`/bookings/${id}/status`, s.receptionist.header, { status: 'NO_SHOW' });
    expect(body(res).status).toBe('NO_SHOW');
    expect(await OutboxModel.findOne({ type: 'booking.no_show' }).lean()).toMatchObject({
      payload: { bookingId: id, staffId: s.ravi.staffId },
    });
  });
});

describe('GET /bookings/:id/history (API-058)', () => {
  it('returns status history and the audit trail; desk only', async () => {
    const id = body(await deskBook('15:00')).id;
    await post(`/bookings/${id}/reschedule`, s.receptionist.header, { startAt: local('16:00') });
    await post(`/bookings/${id}/status`, s.receptionist.header, { status: 'CHECKED_IN' });
    const res = await get(`/bookings/${id}/history`, s.admin.header);
    expect(res.status).toBe(200);
    expect(
      (res.body as { statusHistory: { status: string }[] }).statusHistory.map((h) => h.status),
    ).toEqual(['BOOKED', 'CHECKED_IN']);
    expect((res.body as { audit: { action: string }[] }).audit.map((a) => a.action)).toEqual([
      'booking.create',
      'booking.reschedule',
      'booking.status_change',
    ]);
    expect((await get(`/bookings/${id}/history`, s.ravi.header)).status).toBe(403);
    expect((await get(`/bookings/${newId()}/history`, s.admin.header)).status).toBe(404);
  });
});

describe('active-booking checks now use real bookings (API-018, 020, 032, 036)', () => {
  it('BR-014: deactivating a stylist with future bookings needs force, which cancels and notifies', async () => {
    const id = body(await deskBook('15:00')).id;
    const blocked = await request(app)
      .patch(`/api/v1/staff/${s.ravi.staffId}`)
      .set('Authorization', s.admin.header)
      .send({ isActive: false });
    expect(blocked.status).toBe(422);
    expect(blocked.body).toMatchObject({ code: 'ACTIVE_BOOKINGS_EXIST' });
    const forced = await request(app)
      .patch(`/api/v1/staff/${s.ravi.staffId}`)
      .set('Authorization', s.admin.header)
      .send({ isActive: false, force: true });
    expect(forced.status).toBe(200);
    expect(await BookingModel.findById(id).lean()).toMatchObject({
      status: 'CANCELLED',
      cancellation: {
        overridden: true,
        reason: 'Stylist no longer available',
        by: s.admin.user._id.toHexString(),
      },
    });
    expect(
      await OutboxModel.findOne({ type: 'booking.cancelled', aggregateId: id }).lean(),
    ).toBeTruthy();
    expect(
      await AuditLogModel.findOne({ action: 'booking.cancel', entityId: id }).lean(),
    ).toMatchObject({
      metadata: { force: true },
    });
  });

  it('API-020 holiday and API-036 time-off see real bookings; FR-080 timezone too', async () => {
    await deskBook('15:00');
    const holiday = await request(app)
      .post('/api/v1/holidays')
      .set('Authorization', s.admin.header)
      .send({ date: TODAY, name: 'Closed' });
    expect(holiday.body).toMatchObject({ code: 'ACTIVE_BOOKINGS_EXIST' });
    const timeOff = await request(app)
      .post(`/api/v1/staff/${s.ravi.staffId}/time-off`)
      .set('Authorization', s.ravi.header)
      .send({ startAt: local('14:00'), endAt: local('16:00') });
    expect(timeOff.body).toMatchObject({ code: 'ACTIVE_BOOKINGS_EXIST' });
    // Non-overlapping time-off is fine.
    await request(app)
      .post(`/api/v1/staff/${s.ravi.staffId}/time-off`)
      .set('Authorization', s.ravi.header)
      .send({ startAt: local('17:00'), endAt: local('18:00') })
      .expect(201);
    const settings = await get('/settings', s.admin.header);
    const tz = await request(app)
      .put('/api/v1/settings')
      .set('Authorization', s.admin.header)
      .send({
        ...(settings.body as Record<string, unknown>),
        updatedAt: undefined,
        timezone: 'Asia/Dubai',
      });
    expect(tz.body).toMatchObject({ code: 'ACTIVE_BOOKINGS_EXIST' });
  });
});
