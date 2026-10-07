import type { Express } from 'express';
import { decodeJwt } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ServiceModel } from '../../src/modules/catalog/catalog.model.js';
import { StaffScheduleModel, TimeOffModel } from '../../src/modules/staff/staff.model.js';
import { AuditLogModel } from '../../src/shared/audit/auditLog.model.js';
import { StaffDayGuardModel } from '../../src/shared/db/staffDayGuard.js';
import { OutboxModel } from '../../src/shared/events/outbox.model.js';
import { createUser, CSRF, loginAs, TEST_PASSWORD } from '../helpers/auth.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { createService, createStylist, fakeBookingsGate, newId } from '../helpers/fixtures.js';
import { buildApiTestApp } from '../setup/testApp.js';

let app: Express;
let admin: string;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearCollections();
  app = buildApiTestApp().app;
  admin = (await loginAs('ADMIN')).header;
});

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
const api = (method: Method, path: string, header?: string, target: Express = app) => {
  const req = request(target)[method](`/api/v1${path}`);
  return header ? req.set('Authorization', header) : req;
};

const week = (overrides: Record<number, object> = {}) =>
  [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    isWorking: true,
    start: '10:00',
    end: '19:00',
    breaks: [{ start: '13:30', end: '14:15' }],
    ...overrides[dayOfWeek],
  }));

describe('POST /staff (API-032 create)', () => {
  it('links a STAFF user; the schedule starts as the salon hours (FR-023); audited + EVT-030', async () => {
    const user = await createUser({ role: 'STAFF' });
    const service = await createService({ name: 'Haircut' });
    const res = await api('post', '/staff', admin).send({
      userId: user._id.toHexString(),
      displayName: 'Ravi',
      bio: 'Fades and beards',
      serviceIds: [service._id.toHexString()],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      displayName: 'Ravi',
      userId: user._id.toHexString(),
      isActive: true,
      serviceIds: [service._id.toHexString()],
    });
    const staffId = (res.body as { id: string }).id;
    const schedule = await StaffScheduleModel.findOne({ staffId }).lean();
    expect(schedule?.weekly).toHaveLength(7);
    expect(schedule?.weekly[1]).toMatchObject({
      isWorking: true,
      start: '09:30',
      end: '20:30',
      breaks: [],
    });
    expect(
      await AuditLogModel.findOne({ action: 'staff.create', entityId: staffId }).lean(),
    ).toBeTruthy();
    expect(await OutboxModel.findOne({ type: 'staff.updated' }).lean()).toMatchObject({
      payload: { staffId, affectedDates: [] },
    });
    // One profile per user.
    const again = await api('post', '/staff', admin).send({
      userId: user._id.toHexString(),
      displayName: 'Ravi 2',
      serviceIds: [],
    });
    expect(again.status).toBe(409);
  });

  it('400 when the user is not an active STAFF user or a service is unknown/inactive', async () => {
    const customer = await createUser();
    const inactiveStaff = await createUser({ role: 'STAFF', isActive: false });
    const staffUser = await createUser({ role: 'STAFF' });
    const retired = await createService({ isActive: false });
    const body = (userId: string, serviceIds: string[] = []) => ({
      userId,
      displayName: 'X Y',
      serviceIds,
    });
    for (const res of [
      await api('post', '/staff', admin).send(body(customer._id.toHexString())),
      await api('post', '/staff', admin).send(body(inactiveStaff._id.toHexString())),
      await api('post', '/staff', admin).send(body(newId())),
      await api('post', '/staff', admin).send(body(staffUser._id.toHexString(), [newId()])),
      await api('post', '/staff', admin).send(
        body(staffUser._id.toHexString(), [retired._id.toHexString()]),
      ),
    ]) {
      expect(res.status).toBe(400);
    }
  });

  it('permission staff:manage: receptionist 403, anonymous 401', async () => {
    const body = { userId: newId(), displayName: 'X Y', serviceIds: [] };
    expect(
      (await api('post', '/staff', (await loginAs('RECEPTIONIST')).header).send(body)).status,
    ).toBe(403);
    expect((await api('post', '/staff').send(body)).status).toBe(401);
  });
});

describe('GET /staff and /staff/:id (API-030, API-031)', () => {
  it('public list: active stylists by name, public fields only, filter by service', async () => {
    const haircut = await createService({ name: 'Haircut' });
    await createStylist({ displayName: 'Ravi', serviceIds: [haircut._id] });
    await createStylist({ displayName: 'Arjun', serviceIds: [] });
    await createStylist({ displayName: 'Zed', serviceIds: [haircut._id], isActive: false });

    const all = await api('get', '/staff');
    expect((all.body as { displayName: string }[]).map((s) => s.displayName)).toEqual([
      'Arjun',
      'Ravi',
    ]);
    expect((all.body as object[])[0]).not.toHaveProperty('userId');
    expect((all.body as object[])[0]).not.toHaveProperty('isActive');
    const qualified = await api('get', `/staff?serviceId=${haircut._id.toHexString()}`);
    expect((qualified.body as { displayName: string }[]).map((s) => s.displayName)).toEqual([
      'Ravi',
    ]);

    const adminList = await api('get', '/staff?includeInactive=true', admin);
    expect(adminList.body).toHaveLength(3);
    expect((adminList.body as object[])[0]).toHaveProperty('userId');
    expect((await api('get', '/staff?includeInactive=true')).status).toBe(401);
    expect(
      (await api('get', '/staff?includeInactive=true', (await loginAs('STAFF')).header)).status,
    ).toBe(403);
  });

  it('profile lists active services; deactivated stylists are 404 except for admins', async () => {
    const active = await createService({ name: 'Haircut' });
    const retired = await createService({ name: 'Retired', isActive: false });
    const ravi = await createStylist({
      displayName: 'Ravi',
      serviceIds: [active._id, retired._id],
    });

    const profile = await api('get', `/staff/${ravi.staffId}`);
    expect(profile.status).toBe(200);
    expect((profile.body as { services: { name: string }[] }).services.map((s) => s.name)).toEqual([
      'Haircut',
    ]);
    const adminView = await api('get', `/staff/${ravi.staffId}`, admin);
    expect((adminView.body as { services: unknown[] }).services).toHaveLength(2);

    await api('patch', `/staff/${ravi.staffId}`, admin).send({ isActive: false });
    expect((await api('get', `/staff/${ravi.staffId}`)).status).toBe(404);
    expect((await api('get', `/staff/${ravi.staffId}`, admin)).body).toMatchObject({
      isActive: false,
    });
    expect((await api('get', `/staff/${newId()}`)).status).toBe(404);
    expect((await api('get', '/staff/nope')).status).toBe(400);
  });

  it('cached profile and list refresh after an update', async () => {
    const ravi = await createStylist({ displayName: 'Ravi' });
    await api('get', `/staff/${ravi.staffId}`);
    await api('get', '/staff');
    await api('patch', `/staff/${ravi.staffId}`, admin).send({
      displayName: 'Ravi K',
      bio: 'New bio',
    });
    expect((await api('get', `/staff/${ravi.staffId}`)).body).toMatchObject({
      displayName: 'Ravi K',
      bio: 'New bio',
    });
    expect((await api('get', '/staff')).body).toMatchObject([{ displayName: 'Ravi K' }]);
  });
});

describe('PATCH /staff/:id (API-032 update, BR-014)', () => {
  it('updates fields and services; an already-assigned deactivated service may stay, a new one may not', async () => {
    const kept = await createService({ name: 'Kept' });
    const ravi = await createStylist({ serviceIds: [kept._id] });
    await ServiceModel.updateOne({ _id: kept._id }, { isActive: false });
    const fresh = await createService({ name: 'Fresh' });
    const retired = await createService({ name: 'Retired', isActive: false });

    const ok = await api('patch', `/staff/${ravi.staffId}`, admin).send({
      serviceIds: [kept._id.toHexString(), fresh._id.toHexString()],
      photoUrl: 'http://localhost:4000/uploads/images/r.webp',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ photoUrl: 'http://localhost:4000/uploads/images/r.webp' });
    const bad = await api('patch', `/staff/${ravi.staffId}`, admin).send({
      serviceIds: [retired._id.toHexString()],
    });
    expect(bad.status).toBe(400);
    expect(
      await AuditLogModel.countDocuments({ action: 'staff.update', entityId: ravi.staffId }),
    ).toBe(1);
    const cleared = await api('patch', `/staff/${ravi.staffId}`, admin).send({ photoUrl: null });
    expect(cleared.body).not.toHaveProperty('photoUrl');
  });

  it('BR-014: deactivation with future active bookings is 422 unless force: true', async () => {
    const { gate, calls } = fakeBookingsGate(3);
    const gated = buildApiTestApp({ bookingsGate: gate }).app;
    const ravi = await createStylist();

    const blocked = await api('patch', `/staff/${ravi.staffId}`, admin, gated).send({
      isActive: false,
    });
    expect(blocked.status).toBe(422);
    expect(blocked.body).toMatchObject({ code: 'ACTIVE_BOOKINGS_EXIST' });
    expect(calls[0]).toMatchObject({
      method: 'count',
      inTransaction: true,
      scope: { staffId: ravi.staffId },
    });

    const forced = await api('patch', `/staff/${ravi.staffId}`, admin, gated).send({
      isActive: false,
      force: true,
    });
    expect(forced.status).toBe(200);
    expect(forced.body).toMatchObject({ isActive: false });
    expect(calls.find((c) => c.method === 'cancel')).toMatchObject({ inTransaction: true });
    expect(await AuditLogModel.findOne({ action: 'staff.deactivate' }).lean()).toMatchObject({
      metadata: { force: true, cancelledBookings: 3 },
    });
  });

  it('BR-014: without bookings deactivation needs no force; a no-op writes nothing; 404/403', async () => {
    const ravi = await createStylist();
    expect(
      (await api('patch', `/staff/${ravi.staffId}`, admin).send({ isActive: false })).status,
    ).toBe(200);
    await api('patch', `/staff/${ravi.staffId}`, admin).send({ isActive: false });
    expect(await AuditLogModel.countDocuments({ entityId: ravi.staffId })).toBe(1);
    expect((await api('patch', `/staff/${newId()}`, admin).send({ isActive: false })).status).toBe(
      404,
    );
    expect(
      (
        await api('patch', `/staff/${ravi.staffId}`, (await loginAs('RECEPTIONIST')).header).send({
          bio: 'x',
        })
      ).status,
    ).toBe(403);
  });
});

describe('schedules (API-033, API-034)', () => {
  it('permission schedule:read: own stylist, receptionist and admin may read; others 403', async () => {
    const ravi = await createStylist();
    const priya = await createStylist();
    expect((await api('get', `/staff/${ravi.staffId}/schedule`, ravi.header)).status).toBe(200);
    expect(
      (await api('get', `/staff/${ravi.staffId}/schedule`, (await loginAs('RECEPTIONIST')).header))
        .status,
    ).toBe(200);
    expect((await api('get', `/staff/${ravi.staffId}/schedule`, admin)).status).toBe(200);
    expect((await api('get', `/staff/${ravi.staffId}/schedule`, priya.header)).status).toBe(403);
    expect(
      (await api('get', `/staff/${ravi.staffId}/schedule`, (await loginAs('CUSTOMER')).header))
        .status,
    ).toBe(403);
    expect((await api('get', `/staff/${ravi.staffId}/schedule`)).status).toBe(401);
    expect((await api('get', `/staff/${newId()}/schedule`, admin)).status).toBe(404);
  });

  it('defaults to the salon hours when none is stored', async () => {
    const ravi = await createStylist(); // fixture writes no schedule
    const res = await api('get', `/staff/${ravi.staffId}/schedule`, admin);
    expect(res.body).toMatchObject({ staffId: ravi.staffId });
    expect((res.body as { weekly: unknown[] }).weekly[0]).toEqual({
      dayOfWeek: 0,
      isWorking: true,
      start: '09:30',
      end: '20:30',
      breaks: [],
    });
  });

  it('admin replaces it (audited, EVT-030 staff.schedule_changed); the same schedule again is a no-op', async () => {
    const ravi = await createStylist();
    const weekly = week({ 1: { isWorking: false } });
    const res = await api('put', `/staff/${ravi.staffId}/schedule`, admin).send({ weekly });
    expect(res.status).toBe(200);
    expect((res.body as { weekly: { isWorking: boolean }[] }).weekly[1]?.isWorking).toBe(false);
    expect((await api('get', `/staff/${ravi.staffId}/schedule`, ravi.header)).body).toEqual(
      res.body,
    );
    const audit = await AuditLogModel.findOne({ action: 'staff.schedule_update' }).lean();
    expect(audit).toMatchObject({ entityType: 'staff', entityId: ravi.staffId, diff: ['weekly'] });
    expect(await OutboxModel.findOne({ type: 'staff.schedule_changed' }).lean()).toMatchObject({
      payload: { staffId: ravi.staffId, affectedDates: [] },
    });
    await api('put', `/staff/${ravi.staffId}/schedule`, admin).send({ weekly });
    expect(await AuditLogModel.countDocuments({ action: 'staff.schedule_update' })).toBe(1);
  });

  it('permission staff:manage: a stylist cannot edit even their own schedule; bad schedules are 400', async () => {
    const ravi = await createStylist();
    expect(
      (await api('put', `/staff/${ravi.staffId}/schedule`, ravi.header).send({ weekly: week() }))
        .status,
    ).toBe(403);
    const overlapping = week({
      2: {
        breaks: [
          { start: '13:00', end: '14:00' },
          { start: '13:30', end: '15:00' },
        ],
      },
    });
    expect(
      (await api('put', `/staff/${ravi.staffId}/schedule`, admin).send({ weekly: overlapping }))
        .status,
    ).toBe(400);
    expect(
      (
        await api('put', `/staff/${ravi.staffId}/schedule`, admin).send({
          weekly: week().slice(0, 6),
        })
      ).status,
    ).toBe(400);
    expect(
      (await api('put', `/staff/${newId()}/schedule`, admin).send({ weekly: week() })).status,
    ).toBe(404);
  });
});

describe('time-off (API-035..037, FR-024)', () => {
  // 2026-10-12 22:00 IST -> 2026-10-14 01:00 IST touches three salon-local dates.
  const overnight = {
    startAt: '2026-10-12T16:30:00.000Z',
    endAt: '2026-10-13T19:30:00.000Z',
    reason: 'Wedding',
  };

  it('a stylist blocks their own time: staff-day guards bumped, audited, EVT-030 with affected dates', async () => {
    const ravi = await createStylist();
    const res = await api('post', `/staff/${ravi.staffId}/time-off`, ravi.header).send(overnight);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ...overnight,
      staffId: ravi.staffId,
      createdBy: ravi.user._id.toHexString(),
    });
    const guards = await StaffDayGuardModel.find({ staffId: ravi.staff._id })
      .sort({ date: 1 })
      .lean();
    expect(guards.map((g) => [g.date, g.seq])).toEqual([
      ['2026-10-12', 1],
      ['2026-10-13', 1],
      ['2026-10-14', 1],
    ]);
    const audit = await AuditLogModel.findOne({ action: 'timeoff.create' }).lean();
    expect(audit).toMatchObject({
      entityType: 'staff',
      entityId: ravi.staffId,
      after: { timeOff: { reason: 'Wedding' } },
      metadata: { timeOffId: (res.body as { id: string }).id },
    });
    expect(await OutboxModel.findOne({ type: 'staff.timeoff_changed' }).lean()).toMatchObject({
      payload: { staffId: ravi.staffId, affectedDates: ['2026-10-12', '2026-10-13', '2026-10-14'] },
    });
  });

  it('lists blocks overlapping a salon-local date range (own stylist and receptionist)', async () => {
    const ravi = await createStylist();
    await api('post', `/staff/${ravi.staffId}/time-off`, ravi.header).send(overnight);
    await api('post', `/staff/${ravi.staffId}/time-off`, ravi.header).send({
      startAt: '2026-10-20T04:30:00.000Z',
      endAt: '2026-10-20T06:30:00.000Z',
    });
    const all = await api('get', `/staff/${ravi.staffId}/time-off`, ravi.header);
    expect(all.body).toHaveLength(2);
    const day14 = await api(
      'get',
      `/staff/${ravi.staffId}/time-off?from=2026-10-14&to=2026-10-14`,
      (await loginAs('RECEPTIONIST')).header,
    );
    expect((day14.body as { reason?: string }[]).map((t) => t.reason)).toEqual(['Wedding']);
    const later = await api('get', `/staff/${ravi.staffId}/time-off?from=2026-10-15`, admin);
    expect(later.body).toHaveLength(1);
    expect(
      (await api('get', `/staff/${ravi.staffId}/time-off?from=2026-10-15&to=2026-10-01`, admin))
        .status,
    ).toBe(400);
  });

  it('permission timeoff:manage: another stylist 403, receptionist 403, customer 403', async () => {
    const ravi = await createStylist();
    const priya = await createStylist();
    expect(
      (await api('post', `/staff/${ravi.staffId}/time-off`, priya.header).send(overnight)).status,
    ).toBe(403);
    expect(
      (
        await api(
          'post',
          `/staff/${ravi.staffId}/time-off`,
          (await loginAs('RECEPTIONIST')).header,
        ).send(overnight)
      ).status,
    ).toBe(403);
    expect((await api('get', `/staff/${ravi.staffId}/time-off`, priya.header)).status).toBe(403);
    expect(
      (await api('get', `/staff/${ravi.staffId}/time-off`, (await loginAs('CUSTOMER')).header))
        .status,
    ).toBe(403);
    expect(
      (await api('post', `/staff/${ravi.staffId}/time-off`, admin).send(overnight)).status,
    ).toBe(201);
  });

  it('FR-024: overlapping active bookings are 422; only an admin may force (cancel + notify)', async () => {
    const { gate, calls } = fakeBookingsGate(1);
    const gated = buildApiTestApp({ bookingsGate: gate }).app;
    const ravi = await createStylist();

    const blocked = await api('post', `/staff/${ravi.staffId}/time-off`, ravi.header, gated).send(
      overnight,
    );
    expect(blocked.status).toBe(422);
    expect(blocked.body).toMatchObject({ code: 'ACTIVE_BOOKINGS_EXIST' });
    expect(calls[0]).toMatchObject({
      inTransaction: true,
      scope: {
        staffId: ravi.staffId,
        from: new Date(overnight.startAt),
        to: new Date(overnight.endAt),
      },
    });
    expect(await TimeOffModel.countDocuments()).toBe(0);
    // Rolled back with the transaction: no guard rows either.
    expect(await StaffDayGuardModel.countDocuments()).toBe(0);

    const staffForce = await api(
      'post',
      `/staff/${ravi.staffId}/time-off`,
      ravi.header,
      gated,
    ).send({ ...overnight, force: true });
    expect(staffForce.status).toBe(403);

    const adminForce = await api('post', `/staff/${ravi.staffId}/time-off`, admin, gated).send({
      ...overnight,
      force: true,
    });
    expect(adminForce.status).toBe(201);
    expect(calls.find((c) => c.method === 'cancel')).toMatchObject({
      reason: 'Stylist unavailable: Wedding',
    });
  });

  it("a stylist deletes their own block (audited, EVT-030); another stylist's id path is 404", async () => {
    const ravi = await createStylist();
    const priya = await createStylist();
    const created = await api('post', `/staff/${ravi.staffId}/time-off`, ravi.header).send(
      overnight,
    );
    const timeOffId = (created.body as { id: string }).id;

    expect(
      (await api('delete', `/staff/${priya.staffId}/time-off/${timeOffId}`, priya.header)).status,
    ).toBe(404);
    expect(
      (await api('delete', `/staff/${ravi.staffId}/time-off/${timeOffId}`, priya.header)).status,
    ).toBe(403);
    expect(
      (await api('delete', `/staff/${ravi.staffId}/time-off/${timeOffId}`, ravi.header)).status,
    ).toBe(204);
    expect(await TimeOffModel.countDocuments()).toBe(0);
    expect(await AuditLogModel.findOne({ action: 'timeoff.delete' }).lean()).toMatchObject({
      before: { timeOff: { id: timeOffId } },
      after: null,
    });
    expect(await OutboxModel.countDocuments({ type: 'staff.timeoff_changed' })).toBe(2);
    expect(
      (await api('delete', `/staff/${ravi.staffId}/time-off/${timeOffId}`, admin)).status,
    ).toBe(404);
  });

  it('400 for an empty or reversed interval; 404 for an unknown stylist', async () => {
    const ravi = await createStylist();
    const reversed = { startAt: overnight.endAt, endAt: overnight.startAt };
    expect(
      (await api('post', `/staff/${ravi.staffId}/time-off`, admin).send(reversed)).status,
    ).toBe(400);
    expect((await api('post', `/staff/${newId()}/time-off`, admin).send(overnight)).status).toBe(
      404,
    );
  });
});

describe('staffId access-token claim (06 §1)', () => {
  it('a STAFF user with a profile gets staffId at login and refresh; others do not', async () => {
    const ravi = await createStylist();
    const login = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email: ravi.user.email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    expect(decodeJwt((login.body as { accessToken: string }).accessToken).staffId).toBe(
      ravi.staffId,
    );

    const cookie = (login.headers['set-cookie'] as unknown as string[]).join(';');
    const refreshToken = /ss_rt=([^;]*)/.exec(cookie)?.[1];
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', `ss_rt=${refreshToken}`);
    expect(decodeJwt((refresh.body as { accessToken: string }).accessToken).staffId).toBe(
      ravi.staffId,
    );

    const noProfile = await createUser({ role: 'STAFF', email: 'new-stylist@example.com' });
    const plain = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email: noProfile.email, password: TEST_PASSWORD });
    expect(decodeJwt((plain.body as { accessToken: string }).accessToken)).not.toHaveProperty(
      'staffId',
    );
  });
});
