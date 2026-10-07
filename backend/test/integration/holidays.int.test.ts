import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HolidayModel } from '../../src/modules/holidays/holidays.model.js';
import { AuditLogModel } from '../../src/shared/audit/auditLog.model.js';
import { OutboxModel } from '../../src/shared/events/outbox.model.js';
import { loginAs } from '../helpers/auth.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { fakeBookingsGate } from '../helpers/fixtures.js';
import { buildApiTestApp } from '../setup/testApp.js';

let app: Express;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearCollections();
  app = buildApiTestApp().app;
});

const post = async (target: Express, body: object, header?: string) =>
  request(target)
    .post('/api/v1/holidays')
    .set('Authorization', header ?? (await loginAs('ADMIN')).header)
    .send(body);

describe('GET /holidays (API-019)', () => {
  it('is public, sorted by date, with optional inclusive bounds', async () => {
    await HolidayModel.create([
      { date: '2026-12-25', name: 'Christmas' },
      { date: '2026-11-08', name: 'Diwali' },
      { date: '2027-01-14', name: 'Pongal' },
    ]);
    const all = await request(app).get('/api/v1/holidays');
    expect(all.status).toBe(200);
    expect((all.body as { date: string }[]).map((h) => h.date)).toEqual([
      '2026-11-08',
      '2026-12-25',
      '2027-01-14',
    ]);
    const range = await request(app).get('/api/v1/holidays?from=2026-11-08&to=2026-12-25');
    expect((range.body as { name: string }[]).map((h) => h.name)).toEqual(['Diwali', 'Christmas']);
    const after = await request(app).get('/api/v1/holidays?from=2026-12-01');
    expect(after.body).toHaveLength(2);
    expect((await request(app).get('/api/v1/holidays?from=2026-12-31&to=2026-01-01')).status).toBe(
      400,
    );
    expect((await request(app).get('/api/v1/holidays?from=tomorrow')).status).toBe(400);
  });
});

describe('POST /holidays (API-020)', () => {
  it('creates a holiday with audit + EVT-033; the same date again is 409', async () => {
    const { user, header } = await loginAs('ADMIN');
    const res = await post(app, { date: '2026-11-08', name: 'Diwali' }, header);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ date: '2026-11-08', name: 'Diwali' });
    const audit = await AuditLogModel.findOne({ action: 'holiday.create' }).lean();
    expect(audit).toMatchObject({ entityType: 'holiday', after: { date: '2026-11-08' } });
    expect(audit?.actor.id).toBe(user._id.toHexString());
    expect(await OutboxModel.findOne({ type: 'holiday.changed' }).lean()).toMatchObject({
      payload: { date: '2026-11-08' },
    });
    expect((await post(app, { date: '2026-11-08', name: 'Again' }, header)).status).toBe(409);
  });

  it('422 ACTIVE_BOOKINGS_EXIST when bookings exist that day; nothing is written', async () => {
    const { gate, calls } = fakeBookingsGate(2);
    const res = await post(buildApiTestApp({ bookingsGate: gate }).app, {
      date: '2026-11-08',
      name: 'Diwali',
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'ACTIVE_BOOKINGS_EXIST' });
    // The whole salon-local day: 2026-11-08 00:00 IST = 2026-11-07 18:30 UTC.
    expect(calls[0]).toMatchObject({
      method: 'count',
      inTransaction: true,
      scope: {
        from: new Date('2026-11-07T18:30:00.000Z'),
        to: new Date('2026-11-08T18:30:00.000Z'),
      },
    });
    expect(await HolidayModel.countDocuments()).toBe(0);
    expect(await AuditLogModel.countDocuments()).toBe(0);
    expect(await OutboxModel.countDocuments()).toBe(0);
  });

  it('force: true cancels those bookings in the same transaction (audited)', async () => {
    const { gate, calls } = fakeBookingsGate(2);
    const res = await post(buildApiTestApp({ bookingsGate: gate }).app, {
      date: '2026-11-08',
      name: 'Diwali',
      force: true,
    });
    expect(res.status).toBe(201);
    expect(calls.find((c) => c.method === 'cancel')).toMatchObject({
      inTransaction: true,
      reason: 'Salon closed: Diwali',
    });
    expect(await AuditLogModel.findOne({ action: 'holiday.create' }).lean()).toMatchObject({
      metadata: { force: true, cancelledBookings: 2 },
    });
  });

  it('permission holidays:manage: receptionist and staff 403; anonymous 401; bad input 400', async () => {
    const body = { date: '2026-11-08', name: 'Diwali' };
    expect((await post(app, body, (await loginAs('RECEPTIONIST')).header)).status).toBe(403);
    expect((await post(app, body, (await loginAs('STAFF')).header)).status).toBe(403);
    expect((await request(app).post('/api/v1/holidays').send(body)).status).toBe(401);
    expect((await post(app, { date: '08/11/2026', name: 'Diwali' })).status).toBe(400);
    expect((await post(app, { ...body, extra: 1 })).status).toBe(400);
  });
});

describe('DELETE /holidays/:id (API-020)', () => {
  it('removes it (audited with the old values, EVT-033); then 404', async () => {
    const { header } = await loginAs('ADMIN');
    const created = await post(app, { date: '2026-12-25', name: 'Christmas' }, header);
    const id = (created.body as { id: string }).id;
    const res = await request(app).delete(`/api/v1/holidays/${id}`).set('Authorization', header);
    expect(res.status).toBe(204);
    expect(await HolidayModel.countDocuments()).toBe(0);
    expect(await AuditLogModel.findOne({ action: 'holiday.delete' }).lean()).toMatchObject({
      entityId: id,
      before: { date: '2026-12-25', name: 'Christmas' },
      after: null,
    });
    expect(await OutboxModel.countDocuments({ type: 'holiday.changed' })).toBe(2);
    expect(
      (await request(app).delete(`/api/v1/holidays/${id}`).set('Authorization', header)).status,
    ).toBe(404);
  });

  it('403 for receptionist; 400 for a malformed id', async () => {
    expect(
      (
        await request(app)
          .delete('/api/v1/holidays/6712c0f9a1b2c3d4e5f60999')
          .set('Authorization', (await loginAs('RECEPTIONIST')).header)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .delete('/api/v1/holidays/nope')
          .set('Authorization', (await loginAs('ADMIN')).header)
      ).status,
    ).toBe(400);
  });
});
