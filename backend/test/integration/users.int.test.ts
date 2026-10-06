import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UserModel } from '../../src/modules/users/users.model.js';
import { AuditLogModel } from '../../src/shared/audit/auditLog.model.js';
import { createUser, CSRF, loginAs, TEST_PASSWORD } from '../helpers/auth.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { buildApiTestApp } from '../setup/testApp.js';

let app: Express;

beforeAll(async () => {
  await connectTestDb();
  await UserModel.syncIndexes(); // text index for name search
});
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearCollections();
  app = buildApiTestApp().app;
});

const api = (method: 'get' | 'post' | 'patch', path: string, header?: string) => {
  const req = request(app)[method](`/api/v1${path}`);
  return header ? req.set('Authorization', header) : req;
};

describe('PATCH /users/me (API-010)', () => {
  it('updates name, phone and preferences, and audits with masked PII', async () => {
    const { user, header } = await loginAs('CUSTOMER');
    const res = await api('patch', '/users/me', header).send({
      name: 'Ananya Rao',
      phone: '+919800000099',
      preferences: { smsOptIn: false, preferredStaffId: '6712c0f9a1b2c3d4e5f60222' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Ananya Rao',
      phone: '+919800000099',
      preferences: {
        smsOptIn: false,
        emailOptIn: true,
        preferredStaffId: '6712c0f9a1b2c3d4e5f60222',
      },
    });
    const audit = await AuditLogModel.findOne({
      action: 'user.update',
      entityId: user._id.toHexString(),
    }).lean();
    expect(audit?.diff).toEqual(expect.arrayContaining(['name', 'phone', 'preferences.smsOptIn']));
    expect(JSON.stringify(audit)).not.toContain('+919800000099');

    const cleared = await api('patch', '/users/me', header).send({
      preferences: { preferredStaffId: null },
    });
    expect((cleared.body as { preferences: object }).preferences).not.toHaveProperty(
      'preferredStaffId',
    );
  });

  it('409 for a phone used by someone else; 400 for role or unknown fields; 401 without a token', async () => {
    const { header } = await loginAs('CUSTOMER');
    await createUser({ phone: '+919811111111' });
    expect((await api('patch', '/users/me', header).send({ phone: '+919811111111' })).status).toBe(
      409,
    );
    expect((await api('patch', '/users/me', header).send({ role: 'ADMIN' })).status).toBe(400);
    expect((await api('patch', '/users/me', header).send({})).status).toBe(400);
    expect((await api('patch', '/users/me').send({ name: 'X Y' })).status).toBe(401);
  });

  it('keeping your own phone is not a conflict', async () => {
    const { user, header } = await loginAs('CUSTOMER');
    expect((await api('patch', '/users/me', header).send({ phone: user.phone })).status).toBe(200);
  });
});

describe('GET /users (API-011)', () => {
  it('admin lists and searches everyone (phone prefix, email prefix, name words), paginated', async () => {
    const { header } = await loginAs('ADMIN');
    await createUser({ name: 'Ananya Rao', phone: '+919811100001', email: 'ananya@example.com' });
    await createUser({ name: 'Ravi Kumar', phone: '+919822200002', role: 'STAFF' });

    const all = await api('get', '/users?pageSize=2', header);
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ meta: { page: 1, pageSize: 2, total: 3, totalPages: 2 } });

    const byPhone = await api('get', '/users?q=91981110', header);
    expect((byPhone.body as { data: { name: string }[] }).data.map((u) => u.name)).toEqual([
      'Ananya Rao',
    ]);
    const byEmail = await api('get', '/users?q=ANANYA@', header);
    expect((byEmail.body as { data: unknown[] }).data).toHaveLength(1);
    const byName = await api('get', '/users?q=ravi', header);
    expect((byName.body as { data: { role: string }[] }).data.map((u) => u.role)).toEqual([
      'STAFF',
    ]);
    const staffOnly = await api('get', '/users?role=STAFF&isActive=true', header);
    expect((staffOnly.body as { meta: { total: number } }).meta.total).toBe(1);
  });

  it('receptionist only ever sees customers, even when asking for another role', async () => {
    const { header } = await loginAs('RECEPTIONIST');
    await createUser({ role: 'CUSTOMER' });
    await createUser({ role: 'ADMIN' });
    const res = await api('get', '/users?role=ADMIN', header);
    expect(res.status).toBe(200);
    const roles = (res.body as { data: { role: string }[] }).data.map((u) => u.role);
    expect(roles).toEqual(['CUSTOMER']);
  });

  it('permission users:read: customer and staff are forbidden; anonymous is 401', async () => {
    expect((await api('get', '/users', (await loginAs('CUSTOMER')).header)).status).toBe(403);
    expect((await api('get', '/users', (await loginAs('STAFF')).header)).status).toBe(403);
    expect((await api('get', '/users')).status).toBe(401);
    expect((await api('get', '/users?pageSize=500', (await loginAs('ADMIN')).header)).status).toBe(
      400,
    );
  });
});

describe('POST /users (API-012)', () => {
  const staff = {
    name: 'Ravi Kumar',
    email: 'ravi@salon.in',
    phone: '+919811112222',
    role: 'STAFF',
    password: 'Clipper-Day3',
  };

  it('admin creates a staff account with a temporary password the person can log in with', async () => {
    const { user: admin, header } = await loginAs('ADMIN');
    const res = await api('post', '/users', header).send(staff);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'ravi@salon.in', role: 'STAFF', isWalkIn: false });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email: 'ravi@salon.in', password: 'Clipper-Day3' });
    expect(login.status).toBe(200);
    const audit = await AuditLogModel.findOne({
      action: 'user.create',
      entityId: (res.body as { id: string }).id,
    }).lean();
    expect(audit?.actor.id).toBe(admin._id.toHexString());
  });

  it('permission users:manage: receptionist 403; CUSTOMER role, weak password 400; duplicates 409', async () => {
    expect(
      (await api('post', '/users', (await loginAs('RECEPTIONIST')).header).send(staff)).status,
    ).toBe(403);
    const { header } = await loginAs('ADMIN');
    expect((await api('post', '/users', header).send({ ...staff, role: 'CUSTOMER' })).status).toBe(
      400,
    );
    expect((await api('post', '/users', header).send({ ...staff, password: 'abc' })).status).toBe(
      400,
    );
    expect((await api('post', '/users', header).send(staff)).status).toBe(201);
    expect((await api('post', '/users', header).send(staff)).status).toBe(409);
  });
});

describe('POST /users/walk-in (API-013, FR-037)', () => {
  it('creates a walk-in (no email, no password) and returns the same record for the same phone', async () => {
    const { header } = await loginAs('RECEPTIONIST');
    const first = await api('post', '/users/walk-in', header).send({
      name: 'Meera S',
      phone: '+919833300003',
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ isWalkIn: true, role: 'CUSTOMER' });
    expect(first.body).not.toHaveProperty('email');
    const again = await api('post', '/users/walk-in', header).send({
      name: 'Meera Sharma',
      phone: '+919833300003',
    });
    expect(again.status).toBe(200);
    expect((again.body as { id: string }).id).toBe((first.body as { id: string }).id);
    expect(await AuditLogModel.findOne({ action: 'user.create' }).lean()).toMatchObject({
      metadata: { walkIn: true },
    });

    // FR-001: that phone cannot self-register; it gets the explanatory code.
    const register = await request(app).post('/api/v1/auth/register').set(CSRF).send({
      name: 'Meera S',
      email: 'meera@example.com',
      phone: '+919833300003',
      password: 'Fade-and-Trim7',
    });
    expect(register.text).toContain('PHONE_ALREADY_REGISTERED');
  });

  it('returns an existing registered customer; refuses a staff phone (409); customer forbidden', async () => {
    const { header } = await loginAs('ADMIN');
    const customer = await createUser({ phone: '+919844400004' });
    const existing = await api('post', '/users/walk-in', header).send({
      name: 'Whoever',
      phone: '+919844400004',
    });
    expect(existing.status).toBe(200);
    expect((existing.body as { id: string }).id).toBe(customer._id.toHexString());
    await createUser({ phone: '+919855500005', role: 'STAFF' });
    expect(
      (await api('post', '/users/walk-in', header).send({ name: 'X Y', phone: '+919855500005' }))
        .status,
    ).toBe(409);
    expect(
      (
        await api('post', '/users/walk-in', (await loginAs('CUSTOMER')).header).send({
          name: 'X Y',
          phone: '+919866600006',
        })
      ).status,
    ).toBe(403);
  });
});

describe('GET /users/:id (API-014)', () => {
  it('admin sees anyone; receptionist sees customers, others look not found', async () => {
    const staff = await createUser({ role: 'STAFF' });
    const customer = await createUser();
    const admin = (await loginAs('ADMIN')).header;
    const receptionist = (await loginAs('RECEPTIONIST')).header;
    expect((await api('get', `/users/${staff._id.toHexString()}`, admin)).status).toBe(200);
    expect((await api('get', `/users/${customer._id.toHexString()}`, receptionist)).status).toBe(
      200,
    );
    expect((await api('get', `/users/${staff._id.toHexString()}`, receptionist)).status).toBe(404);
  });

  it('400 for a malformed id, 404 for a missing one, 403 for customers', async () => {
    const admin = (await loginAs('ADMIN')).header;
    expect((await api('get', '/users/not-an-id', admin)).status).toBe(400);
    expect((await api('get', '/users/6712c0f9a1b2c3d4e5f60999', admin)).status).toBe(404);
    expect(
      (await api('get', '/users/6712c0f9a1b2c3d4e5f60999', (await loginAs('CUSTOMER')).header))
        .status,
    ).toBe(403);
  });
});

describe('PATCH /users/:id (API-015)', () => {
  it('deactivates an account (audited); the user can no longer log in or refresh', async () => {
    const { header } = await loginAs('ADMIN');
    const target = await createUser({ email: 'leaving@example.com' });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email: 'leaving@example.com', password: TEST_PASSWORD });
    const refreshCookie = /ss_rt=([^;]*)/.exec(
      (login.headers['set-cookie'] as unknown as string[]).join(';'),
    )?.[1];

    const res = await api('patch', `/users/${target._id.toHexString()}`, header).send({
      isActive: false,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ isActive: false });
    expect(await AuditLogModel.findOne({ action: 'user.deactivate' }).lean()).toMatchObject({
      before: { isActive: true },
      after: { isActive: false },
    });
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .set(CSRF)
          .send({ email: 'leaving@example.com', password: TEST_PASSWORD })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/refresh')
          .set(CSRF)
          .set('Cookie', `ss_rt=${refreshCookie}`)
      ).status,
    ).toBe(401);

    const reactivated = await api('patch', `/users/${target._id.toHexString()}`, header).send({
      isActive: true,
    });
    expect(reactivated.body).toMatchObject({ isActive: true });
    expect(
      await AuditLogModel.countDocuments({
        action: 'user.update',
        entityId: target._id.toHexString(),
      }),
    ).toBe(1);
  });

  it('changes a role (audited); a no-op change writes nothing', async () => {
    const { header } = await loginAs('ADMIN');
    const target = await createUser({ role: 'STAFF' });
    const res = await api('patch', `/users/${target._id.toHexString()}`, header).send({
      role: 'RECEPTIONIST',
    });
    expect(res.body).toMatchObject({ role: 'RECEPTIONIST' });
    expect(await AuditLogModel.findOne({ action: 'user.role_change' }).lean()).toMatchObject({
      before: { role: 'STAFF' },
      after: { role: 'RECEPTIONIST' },
    });
    await api('patch', `/users/${target._id.toHexString()}`, header).send({ role: 'RECEPTIONIST' });
    expect(await AuditLogModel.countDocuments({ action: 'user.role_change' })).toBe(1);
  });

  it('cannot change your own account (403); receptionist 403; missing user 404; empty body 400', async () => {
    const { user: admin, header } = await loginAs('ADMIN');
    expect(
      (await api('patch', `/users/${admin._id.toHexString()}`, header).send({ isActive: false }))
        .status,
    ).toBe(403);
    expect(
      (
        await api(
          'patch',
          '/users/6712c0f9a1b2c3d4e5f60999',
          (await loginAs('RECEPTIONIST')).header,
        ).send({ isActive: false })
      ).status,
    ).toBe(403);
    expect(
      (await api('patch', '/users/6712c0f9a1b2c3d4e5f60999', header).send({ isActive: false }))
        .status,
    ).toBe(404);
    expect((await api('patch', '/users/6712c0f9a1b2c3d4e5f60999', header).send({})).status).toBe(
      400,
    );
  });
});
