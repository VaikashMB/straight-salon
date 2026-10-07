import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/modules/settings/settings.model.js';
import { AuditLogModel } from '../../src/shared/audit/auditLog.model.js';
import { OutboxModel } from '../../src/shared/events/outbox.model.js';
import { loginAs } from '../helpers/auth.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { createService, fakeBookingsGate } from '../helpers/fixtures.js';
import { buildApiTestApp } from '../setup/testApp.js';

let app: Express;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearCollections();
  app = buildApiTestApp().app;
});

const settingsBody = (overrides: Record<string, unknown> = {}) => ({
  ...DEFAULT_SETTINGS,
  address: '12 MG Road, Bengaluru',
  phone: '+918041234567',
  ...overrides,
});

describe('GET /settings/public (API-016)', () => {
  it('serves defaults before anything is saved, with public fields only, anonymously', async () => {
    const res = await request(app).get('/api/v1/settings/public');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Straight Salon',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      slotGranularityMin: 15,
      maxAdvanceDays: 30,
      cancellationCutoffMin: 120,
      minLeadTimeMin: 60,
    });
    expect((res.body as { businessHours: unknown[] }).businessHours).toHaveLength(7);
    expect(res.body).not.toHaveProperty('noShowGraceMin');
    expect(res.body).not.toHaveProperty('bufferMin');
  });

  it('is cached (08 §2) and refreshed right after an admin update (08 §4)', async () => {
    const { app: cachedApp, redis } = buildApiTestApp();
    await request(cachedApp).get('/api/v1/settings/public');
    expect(await redis.get('ss:v1:settings:public')).not.toBeNull();

    const { header } = await loginAs('ADMIN');
    await request(cachedApp)
      .put('/api/v1/settings')
      .set('Authorization', header)
      .send(settingsBody({ name: 'Straight Salon HSR' }))
      .expect(200);
    const res = await request(cachedApp).get('/api/v1/settings/public');
    expect(res.body).toMatchObject({
      name: 'Straight Salon HSR',
      address: '12 MG Road, Bengaluru',
    });
  });
});

describe('GET /settings (API-017)', () => {
  it('permission settings:manage: admin allowed; receptionist 403; anonymous 401', async () => {
    const admin = await request(app)
      .get('/api/v1/settings')
      .set('Authorization', (await loginAs('ADMIN')).header);
    expect(admin.status).toBe(200);
    expect(admin.body).toMatchObject({ bufferMin: 0, noShowGraceMin: 30, reviewWindowDays: 14 });
    expect(admin.body).not.toHaveProperty('updatedAt');
    expect(
      (
        await request(app)
          .get('/api/v1/settings')
          .set('Authorization', (await loginAs('RECEPTIONIST')).header)
      ).status,
    ).toBe(403);
    expect((await request(app).get('/api/v1/settings')).status).toBe(401);
  });
});

describe('PUT /settings (API-018)', () => {
  it('saves every field, audits once and emits EVT-032 with the changed keys', async () => {
    const { user, header } = await loginAs('ADMIN');
    const res = await request(app)
      .put('/api/v1/settings')
      .set('Authorization', header)
      .send(settingsBody({ bufferMin: 10, email: 'Hello@StraightSalon.in' }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ bufferMin: 10, email: 'hello@straightsalon.in' });
    expect(res.body).toHaveProperty('updatedAt');

    const audit = await AuditLogModel.findOne({ action: 'settings.update' }).lean();
    expect(audit).toMatchObject({ entityType: 'settings', entityId: 'salon' });
    expect(audit?.actor.id).toBe(user._id.toHexString());
    expect(audit?.diff).toEqual(expect.arrayContaining(['bufferMin', 'address', 'phone', 'email']));
    const event = await OutboxModel.findOne({ type: 'settings.changed' }).lean();
    expect((event?.payload as { changedKeys: string[] }).changedKeys.sort()).toEqual([
      'address',
      'bufferMin',
      'email',
      'phone',
    ]);

    // Same body again: no write, no audit, no event.
    await request(app)
      .put('/api/v1/settings')
      .set('Authorization', header)
      .send(settingsBody({ bufferMin: 10, email: 'hello@straightsalon.in' }));
    expect(await AuditLogModel.countDocuments({ action: 'settings.update' })).toBe(1);

    // Optional contact fields can be removed again.
    const withoutAddress: Record<string, unknown> = settingsBody({ bufferMin: 10 });
    delete withoutAddress.address;
    const cleared = await request(app)
      .put('/api/v1/settings')
      .set('Authorization', header)
      .send(withoutAddress);
    expect(cleared.body).not.toHaveProperty('address');
  });

  it('BR-013: a granularity an active service does not fit is 422 INVALID_DURATION', async () => {
    await createService({ name: 'Beard Trim', durationMin: 15 });
    await createService({ name: 'Old', durationMin: 20, isActive: false }); // inactive: ignored
    const { header } = await loginAs('ADMIN');
    const res = await request(app)
      .put('/api/v1/settings')
      .set('Authorization', header)
      .send(settingsBody({ slotGranularityMin: 30 }));
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'INVALID_DURATION' });
    expect((res.body as { detail: string }).detail).toContain('Beard Trim');
    const ok = await request(app)
      .put('/api/v1/settings')
      .set('Authorization', header)
      .send(settingsBody({ slotGranularityMin: 5 }));
    expect(ok.status).toBe(200);
  });

  it('FR-080: the timezone cannot change while future active bookings exist (422)', async () => {
    const { gate } = fakeBookingsGate(1);
    const gated = buildApiTestApp({ bookingsGate: gate }).app;
    const { header } = await loginAs('ADMIN');
    const res = await request(gated)
      .put('/api/v1/settings')
      .set('Authorization', header)
      .send(settingsBody({ timezone: 'Asia/Dubai' }));
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'ACTIVE_BOOKINGS_EXIST' });
    // Without bookings (Phase 4 gate) it is allowed.
    const free = await request(app)
      .put('/api/v1/settings')
      .set('Authorization', header)
      .send(settingsBody({ timezone: 'Asia/Dubai' }));
    expect(free.body).toMatchObject({ timezone: 'Asia/Dubai' });
  });

  it('400 for invalid or unknown fields; 403 for receptionist', async () => {
    const { header } = await loginAs('ADMIN');
    for (const body of [
      settingsBody({ timezone: 'Nowhere/City' }),
      settingsBody({ slotGranularityMin: 7 }),
      settingsBody({ businessHours: [] }),
      settingsBody({ secret: true }),
      { name: 'Only a name' },
    ]) {
      expect(
        (await request(app).put('/api/v1/settings').set('Authorization', header).send(body)).status,
      ).toBe(400);
    }
    expect(
      (
        await request(app)
          .put('/api/v1/settings')
          .set('Authorization', (await loginAs('RECEPTIONIST')).header)
          .send(settingsBody())
      ).status,
    ).toBe(403);
  });
});
