import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditRepository } from '../../src/shared/audit/audit.repository.js';
import type { AuditLogDoc } from '../../src/shared/audit/auditLog.model.js';
import { loginAs } from '../helpers/auth.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { newId } from '../helpers/fixtures.js';
import { buildApiTestApp } from '../setup/testApp.js';

// GET /audit-logs (API-073, FR-073). Dates are salon-local (Asia/Kolkata, UTC+5:30).

let app: Express;
let admin: Awaited<ReturnType<typeof loginAs>>;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearCollections();
  app = buildApiTestApp().app;
  admin = await loginAs('ADMIN');
});

const bookingId = newId();
const actorId = newId();

const row = (overrides: Partial<AuditLogDoc>): AuditLogDoc => ({
  at: new Date('2026-10-12T05:00:00.000Z'),
  actor: { id: actorId, role: 'RECEPTIONIST', ip: '10.0.0.5' },
  action: 'booking.create',
  entityType: 'booking',
  entityId: bookingId,
  before: null,
  after: { status: 'BOOKED' },
  diff: ['status'],
  ...overrides,
});

async function seedRows() {
  await auditRepository.insert(row({ requestId: 'req-1' }));
  await auditRepository.insert(
    row({
      at: new Date('2026-10-12T06:00:00.000Z'),
      action: 'booking.cancel',
      before: { status: 'BOOKED' },
      after: { status: 'CANCELLED' },
      metadata: { override: true },
    }),
  );
  await auditRepository.insert(
    row({
      // 2026-10-13 00:30 in the salon, i.e. still 12 Oct in UTC
      at: new Date('2026-10-12T19:00:00.000Z'),
      actor: { id: 'system', role: 'SYSTEM' },
      action: 'booking.status_change',
    }),
  );
  await auditRepository.insert(
    row({
      at: new Date('2026-10-11T05:00:00.000Z'),
      action: 'service.create',
      entityType: 'service',
      entityId: newId(),
    }),
  );
}

const list = (query = '', header = admin.header) =>
  request(app).get(`/api/v1/audit-logs${query}`).set('Authorization', header);

const actions = (body: unknown) =>
  (body as { data: { action: string }[] }).data.map((r) => r.action);

describe('GET /audit-logs (API-073)', () => {
  it('lists newest first with every field; paginated', async () => {
    await seedRows();
    const res = await list();
    expect(res.status).toBe(200);
    expect(actions(res.body)).toEqual([
      'booking.status_change',
      'booking.cancel',
      'booking.create',
      'service.create',
    ]);
    expect(res.body).toMatchObject({ meta: { total: 4, page: 1, totalPages: 1 } });
    expect((res.body as { data: unknown[] }).data[1]).toMatchObject({
      at: '2026-10-12T06:00:00.000Z',
      actor: { id: actorId, role: 'RECEPTIONIST', ip: '10.0.0.5' },
      entityType: 'booking',
      entityId: bookingId,
      before: { status: 'BOOKED' },
      after: { status: 'CANCELLED' },
      diff: ['status'],
      metadata: { override: true },
    });
    const page2 = await list('?pageSize=3&page=2');
    expect(actions(page2.body)).toEqual(['service.create']);
  });

  it('filters by entity, actor, action and salon-local dates (inclusive)', async () => {
    await seedRows();
    expect(actions((await list(`?entityType=booking&entityId=${bookingId}`)).body)).toHaveLength(3);
    expect(actions((await list('?entityType=service')).body)).toEqual(['service.create']);
    expect(actions((await list('?actorId=system')).body)).toEqual(['booking.status_change']);
    expect(actions((await list(`?actorId=${actorId}&action=booking.cancel`)).body)).toEqual([
      'booking.cancel',
    ]);
    expect(actions((await list('?from=2026-10-12&to=2026-10-12')).body)).toEqual([
      'booking.cancel',
      'booking.create',
    ]);
    expect(actions((await list('?from=2026-10-13')).body)).toEqual(['booking.status_change']);
    expect(actions((await list('?to=2026-10-11')).body)).toEqual(['service.create']);
  });

  it('a real change shows up with the actor from the request (07 §2)', async () => {
    const res = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', admin.header)
      .send({ name: 'Spa' });
    expect(res.status).toBe(201);
    const entries = await list('?entityType=category');
    expect((entries.body as { data: unknown[] }).data).toMatchObject([
      {
        action: 'category.create',
        entityId: (res.body as { id: string }).id,
        actor: { id: admin.user._id.toHexString(), role: 'ADMIN' },
      },
    ]);
  });

  it('rejects bad filters (400)', async () => {
    expect((await list('?action=drop table')).status).toBe(400);
    expect((await list('?actorId=nobody')).status).toBe(400);
    expect((await list('?entityType=Booking')).status).toBe(400);
    expect((await list('?from=2026-10-13&to=2026-10-12')).status).toBe(400);
    expect((await list('?entityId[$ne]=x')).status).toBe(400);
    expect((await list('?unknown=1')).status).toBe(400);
  });

  it('permission audit:read: ADMIN only', async () => {
    expect((await list('', (await loginAs('RECEPTIONIST')).header)).status).toBe(403);
    expect((await list('', (await loginAs('CUSTOMER')).header)).status).toBe(403);
    expect((await request(app).get('/api/v1/audit-logs')).status).toBe(401);
  });
});
