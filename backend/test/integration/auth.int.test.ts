import bcrypt from 'bcrypt';
import type { Express } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RefreshTokenModel, PasswordResetTokenModel } from '../../src/modules/auth/tokens.model.js';
import { UserModel } from '../../src/modules/users/users.model.js';
import { AuditLogModel } from '../../src/shared/audit/auditLog.model.js';
import { OutboxModel } from '../../src/shared/events/outbox.model.js';
import { decryptSecret, type EncryptedSecret } from '../../src/shared/events/secret.js';
import { createManualClock, type ManualClock } from '../../src/shared/time/clock.js';
import { encryptionKey } from '../factories/index.js';
import { createUser, CSRF, loginAs, TEST_PASSWORD } from '../helpers/auth.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { buildApiTestApp } from '../setup/testApp.js';

const KEY = encryptionKey();
let app: Express;
let clock: ManualClock;

beforeAll(async () => {
  await connectTestDb();
});
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearCollections();
  vi.restoreAllMocks();
  clock = createManualClock(new Date());
  app = buildApiTestApp({ clock, modules: { outboxEncryptionKey: KEY } }).app;
});

const newCustomer = {
  name: 'Ananya R',
  email: 'Ananya@Example.com',
  phone: '+919876543212',
  password: 'Fade-and-Trim7',
};

function cookiesOf(res: request.Response): Record<string, string> {
  const raw = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  return Object.fromEntries(raw.map((c) => [c.split('=')[0]!, c]));
}
const refreshValue = (res: request.Response) =>
  /ss_rt=([^;]*)/.exec(cookiesOf(res).ss_rt ?? '')?.[1] ?? '';
const post = (path: string) => request(app).post(`/api/v1/auth/${path}`).set(CSRF);
const refreshWith = (token: string) => post('refresh').set('Cookie', `ss_rt=${token}`);
const login = (email: string, password: string) => post('login').send({ email, password });

describe('POST /auth/register (API-001)', () => {
  it('creates a customer, signs them in, audits and emits user.registered', async () => {
    const res = await post('register').send(newCustomer);
    expect(res.status).toBe(201);
    const body = res.body as {
      user: Record<string, unknown> & { id: string };
      accessToken: string;
    };
    expect(body.user).toMatchObject({
      name: 'Ananya R',
      email: 'ananya@example.com',
      role: 'CUSTOMER',
      isWalkIn: false,
    });
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(body.accessToken.split('.')).toHaveLength(3);
    expect(cookiesOf(res).ss_rt).toContain('Path=/api/v1/auth');
    expect(cookiesOf(res).ss_session).toContain('ss_session=1');

    const audit = await AuditLogModel.findOne({ action: 'user.create' }).lean();
    expect(audit?.actor).toMatchObject({ id: body.user.id, role: 'CUSTOMER' });
    expect(JSON.stringify(audit)).not.toContain('ananya@example.com'); // masked (07 §2.2)
    expect(
      await OutboxModel.countDocuments({ type: 'user.registered', aggregateId: body.user.id }),
    ).toBe(1);
  });

  it('validates: weak password, unknown fields, bad phone (400) and requires the CSRF header (403)', async () => {
    expect((await post('register').send({ ...newCustomer, password: 'password123' })).status).toBe(
      400,
    );
    expect((await post('register').send({ ...newCustomer, role: 'ADMIN' })).status).toBe(400);
    expect((await post('register').send({ ...newCustomer, phone: '98765' })).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/register').send(newCustomer)).status).toBe(403);
  });

  it('409 DUPLICATE for a taken email or phone; 409 PHONE_ALREADY_REGISTERED for a walk-in phone (FR-001)', async () => {
    await createUser({ email: 'ananya@example.com' });
    const dupEmail = await post('register').send(newCustomer);
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.text).toContain('"code":"DUPLICATE"');

    await createUser({ phone: '+919811111111' });
    const dupPhone = await post('register').send({
      ...newCustomer,
      email: 'other@example.com',
      phone: '+919811111111',
    });
    expect(dupPhone.text).toContain('"code":"DUPLICATE"');

    await createUser({ phone: '+919822222222', isWalkIn: true, email: undefined });
    const walkIn = await post('register').send({
      ...newCustomer,
      email: 'new@example.com',
      phone: '+919822222222',
    });
    expect(walkIn.status).toBe(409);
    expect(walkIn.text).toContain('PHONE_ALREADY_REGISTERED');
  });
});

describe('POST /auth/login (API-002)', () => {
  it('signs in, records lastLoginAt and audits auth.login', async () => {
    const user = await createUser({ email: 'ravi@example.com' });
    const res = await login('RAVI@example.com', TEST_PASSWORD);
    expect(res.status).toBe(200);
    expect((res.body as { user: { id: string } }).user.id).toBe(user._id.toHexString());
    expect(refreshValue(res)).not.toBe('');
    expect((await UserModel.findById(user._id).lean())?.lastLoginAt).toBeInstanceOf(Date);
    expect(
      await AuditLogModel.countDocuments({
        action: 'auth.login',
        entityId: user._id.toHexString(),
      }),
    ).toBe(1);
  });

  it('answers wrong password, unknown email and inactive account with the same generic 401', async () => {
    await createUser({ email: 'ravi@example.com' });
    await createUser({ email: 'gone@example.com', isActive: false });
    const responses = await Promise.all([
      login('ravi@example.com', 'Wrong-pass9'),
      login('nobody@example.com', TEST_PASSWORD),
      login('gone@example.com', TEST_PASSWORD),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.text).toContain('Invalid email or password.');
    }
    const reasons = (await AuditLogModel.find({ action: 'auth.login_failed' }).lean())
      .map((a) => a.metadata?.reason)
      .sort();
    expect(reasons).toEqual(['bad_password', 'inactive', 'unknown_email']);
    expect(JSON.stringify(await AuditLogModel.find().lean())).not.toContain('Wrong-pass9');
  });

  it('06 §5: runs a bcrypt comparison even for unknown users (constant timing)', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    await login('nobody@example.com', TEST_PASSWORD);
    expect(compare).toHaveBeenCalledTimes(1);
  });

  it('06 §5: locks the account after 5 failures, even with the right password afterwards', async () => {
    await createUser({ email: 'ravi@example.com' });
    for (let i = 0; i < 5; i++)
      expect((await login('ravi@example.com', 'Wrong-pass9')).status).toBe(401);
    const locked = await login('ravi@example.com', TEST_PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.text).toContain('RATE_LIMITED');
  });

  it('06 §5: rejects a $gt injection attempt with 400', async () => {
    const res = await post('login').send({ email: { $gt: '' }, password: { $gt: '' } });
    expect(res.status).toBe(400);
  });

  it('limits login/register/forgot to 10 requests per 15 minutes per IP (06 §4)', async () => {
    for (let i = 0; i < 10; i++) await post('forgot-password').send({ email: `x${i}@example.com` });
    const res = await login('anyone@example.com', 'whatever1');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('POST /auth/refresh (API-003)', () => {
  async function signIn() {
    await createUser({ email: 'ravi@example.com' });
    return refreshValue(await login('ravi@example.com', TEST_PASSWORD));
  }

  it('06 §5: rotation issues a new cookie and a new access token', async () => {
    const first = await signIn();
    const res = await refreshWith(first);
    expect(res.status).toBe(200);
    expect((res.body as { accessToken: string }).accessToken).toEqual(expect.any(String));
    const second = refreshValue(res);
    expect(second).not.toBe('');
    expect(second).not.toBe(first);
    const old = await RefreshTokenModel.findOne({
      revokedAt: mongoose.trusted({ $exists: true }),
    }).lean();
    expect(old?.replacedByHash).toEqual(expect.any(String));
    expect((await refreshWith(second)).status).toBe(200);
  });

  it('06 §5: reusing a rotated token revokes the whole family and is audited', async () => {
    const first = await signIn();
    const second = refreshValue(await refreshWith(first));

    const replay = await refreshWith(first);
    expect(replay.status).toBe(401);
    expect(cookiesOf(replay).ss_rt).toMatch(/ss_rt=;/); // cookies cleared
    expect((await refreshWith(second)).status).toBe(401); // the legitimate successor died too
    expect(
      await RefreshTokenModel.countDocuments({ revokedAt: mongoose.trusted({ $exists: false }) }),
    ).toBe(0);
    // Two revoked tokens were presented (the replay, then its successor): both are audited.
    expect(await AuditLogModel.countDocuments({ action: 'auth.refresh_reuse_detected' })).toBe(2);
  });

  it('401 without a cookie, with an unknown or expired token', async () => {
    expect((await post('refresh')).status).toBe(401);
    expect((await refreshWith('not-a-real-token')).status).toBe(401);
    const token = await signIn();
    clock.advance(8 * 24 * 60 * 60_000); // past the 7-day lifetime
    expect((await refreshWith(token)).status).toBe(401);
  });

  it('401 when the user was deactivated or changed password after the token was issued', async () => {
    const token = await signIn();
    await UserModel.updateOne({ email: 'ravi@example.com' }, { $set: { isActive: false } });
    expect((await refreshWith(token)).status).toBe(401);

    await UserModel.updateOne({ email: 'ravi@example.com' }, { $set: { isActive: true } });
    const token2 = refreshValue(await login('ravi@example.com', TEST_PASSWORD));
    await UserModel.updateOne(
      { email: 'ravi@example.com' },
      { $set: { passwordChangedAt: new Date(Date.now() + 60_000) } },
    );
    expect((await refreshWith(token2)).status).toBe(401);
  });
});

describe('logout (API-004) and logout-all (API-005)', () => {
  it('logout revokes this session, clears cookies and is idempotent', async () => {
    const { user } = await loginAs('CUSTOMER');
    const token = refreshValue(await login(user.email!, TEST_PASSWORD));
    const res = await post('logout').set('Cookie', `ss_rt=${token}`);
    expect(res.status).toBe(204);
    expect(cookiesOf(res).ss_session).toMatch(/ss_session=;/);
    expect((await refreshWith(token)).status).toBe(401);
    expect(await AuditLogModel.countDocuments({ action: 'auth.logout' })).toBe(1);
    expect((await post('logout')).status).toBe(204);
  });

  it('logout-all revokes every session of the user', async () => {
    const { user, header } = await loginAs('STAFF');
    const a = refreshValue(await login(user.email!, TEST_PASSWORD));
    const b = refreshValue(await login(user.email!, TEST_PASSWORD));
    expect((await post('logout-all')).status).toBe(401);
    expect((await post('logout-all').set('Authorization', header)).status).toBe(204);
    expect((await refreshWith(a)).status).toBe(401);
    expect((await refreshWith(b)).status).toBe(401);
    expect(await AuditLogModel.findOne({ action: 'auth.logout_all' }).lean()).toMatchObject({
      metadata: { sessions: 2 },
    });
  });
});

describe('GET /auth/me (API-009)', () => {
  it('returns the profile; 401 without a token; 401 TOKEN_EXPIRED once expired', async () => {
    await createUser({ email: 'ravi@example.com' });
    const { accessToken } = (await login('ravi@example.com', TEST_PASSWORD)).body as {
      accessToken: string;
    };
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: 'ravi@example.com' });
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    clock.advance(16 * 60_000);
    const expired = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(expired.status).toBe(401);
    expect(expired.text).toContain('TOKEN_EXPIRED');
  });
});

describe('password reset (API-006, API-007)', () => {
  async function requestReset(email: string): Promise<string> {
    expect((await post('forgot-password').send({ email })).status).toBe(202);
    const event = await OutboxModel.findOne({ type: 'user.password_reset_requested' })
      .sort({ occurredAt: -1 })
      .lean();
    return decryptSecret(event!.secret as EncryptedSecret, KEY);
  }

  it('always answers 202; only real accounts get a token and an encrypted event', async () => {
    expect((await post('forgot-password').send({ email: 'nobody@example.com' })).status).toBe(202);
    expect(await PasswordResetTokenModel.countDocuments()).toBe(0);

    await createUser({ email: 'ravi@example.com' });
    const raw = await requestReset('ravi@example.com');
    const stored = await PasswordResetTokenModel.findOne().lean();
    expect(stored?.tokenHash).not.toBe(raw); // only the hash is stored
    expect(JSON.stringify(await OutboxModel.find().lean())).not.toContain(raw);

    await requestReset('ravi@example.com'); // a new request replaces the old token
    expect(await PasswordResetTokenModel.countDocuments()).toBe(1);
  });

  it('resets the password once, ends every session, and audits it', async () => {
    const user = await createUser({ email: 'ravi@example.com' });
    const session = refreshValue(await login('ravi@example.com', TEST_PASSWORD));
    const raw = await requestReset('ravi@example.com');

    expect(
      (await post('reset-password').send({ token: raw, newPassword: 'New-Style-2027' })).status,
    ).toBe(204);
    expect((await login('ravi@example.com', 'New-Style-2027')).status).toBe(200);
    expect((await refreshWith(session)).status).toBe(401);
    expect(
      await AuditLogModel.countDocuments({
        action: 'auth.password_reset',
        entityId: user._id.toHexString(),
      }),
    ).toBe(1);

    const again = await post('reset-password').send({
      token: raw,
      newPassword: 'Another-Style-28',
    });
    expect(again.status).toBe(400);
    expect(again.text).toContain('INVALID_RESET_TOKEN');
  });

  it('rejects an expired token and weak new passwords', async () => {
    await createUser({ email: 'ravi@example.com' });
    const raw = await requestReset('ravi@example.com');
    expect((await post('reset-password').send({ token: raw, newPassword: 'short' })).status).toBe(
      400,
    );
    clock.advance(31 * 60_000);
    const expired = await post('reset-password').send({
      token: raw,
      newPassword: 'New-Style-2027',
    });
    expect(expired.text).toContain('INVALID_RESET_TOKEN');
  });
});

describe('POST /auth/change-password (API-008)', () => {
  it('ends other sessions but keeps this device signed in with a fresh cookie', async () => {
    await createUser({ email: 'ravi@example.com' });
    const signIn = await login('ravi@example.com', TEST_PASSWORD);
    const { accessToken } = signIn.body as { accessToken: string };
    const otherDevice = refreshValue(await login('ravi@example.com', TEST_PASSWORD));

    const res = await post('change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'New-Style-2027' });
    expect(res.status).toBe(204);
    const thisDevice = refreshValue(res);
    expect(thisDevice).not.toBe('');

    expect((await refreshWith(otherDevice)).status).toBe(401);
    expect((await refreshWith(thisDevice)).status).toBe(200);
    expect((await login('ravi@example.com', 'New-Style-2027')).status).toBe(200);
    expect(await AuditLogModel.countDocuments({ action: 'auth.password_changed' })).toBe(1);
  });

  it('wrong current password -> 400 on currentPassword; same password -> 400; no token -> 401', async () => {
    const { header } = await loginAs('CUSTOMER');
    const wrong = await post('change-password')
      .set('Authorization', header)
      .send({ currentPassword: 'Nope-1234', newPassword: 'New-Style-2027' });
    expect(wrong.status).toBe(400);
    expect(wrong.text).toContain('currentPassword');
    const same = await post('change-password')
      .set('Authorization', header)
      .send({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD });
    expect(same.status).toBe(400);
    expect(
      (await post('change-password').send({ currentPassword: 'a', newPassword: 'New-Style-2027' }))
        .status,
    ).toBe(401);
  });
});
