import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { notificationsRepository } from '../../src/modules/notifications/notifications.repository.js';
import { createNotificationSender } from '../../src/modules/notifications/notifications.sender.js';
import { NotificationListSchema } from '../../src/modules/notifications/notifications.schemas.js';
import { createManualClock, type ManualClock } from '../../src/shared/time/clock.js';
import { loginAs } from '../helpers/auth.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { captureLogger } from '../helpers/logger.js';
import { recordingProviders } from '../helpers/worker.js';
import { buildApiTestApp } from '../setup/testApp.js';

// API-065, API-066 (04 §3 Notifications; permission notifications:read:any, 06 §3).

type Viewer = Awaited<ReturnType<typeof loginAs>>;

let app: Express;
let clock: ManualClock;
let customer: Viewer;
let other: Viewer;
let admin: Viewer;
let receptionist: Viewer;

const salon = { name: 'Straight Salon' };

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearCollections();
  clock = createManualClock('2026-10-12T03:30:00.000Z');
  ({ app } = buildApiTestApp({ clock }));
  [customer, other, admin, receptionist] = await Promise.all([
    loginAs('CUSTOMER', { name: 'Ananya Rao' }),
    loginAs('CUSTOMER', { name: 'Kabir Shah' }),
    loginAs('ADMIN'),
    loginAs('RECEPTIONIST'),
  ]);

  // Messages as the worker records them: two for the customer, one for someone else.
  const providers = recordingProviders();
  const sender = createNotificationSender({
    repository: notificationsRepository,
    email: providers.email,
    sms: providers.sms,
    clock,
    logger: captureLogger().logger,
  });
  const welcome = (viewer: Viewer, eventId: string) => ({
    eventId,
    userId: viewer.user._id.toHexString(),
    channel: 'EMAIL' as const,
    to: viewer.user.email!,
    template: 'welcome' as const,
    data: { name: viewer.user.name, salon, link: 'http://salon.test/book' },
  });
  await sender.deliver(welcome(customer, 'evt-1'));
  clock.advance(60_000);
  providers.failNext();
  await sender
    .deliver({
      ...welcome(customer, 'evt-2'),
      template: 'password_reset',
      data: {
        name: 'Ananya',
        salon,
        resetUrl: 'http://salon.test/reset-password?token=t0k3n',
        validMinutes: 30,
      },
    })
    .catch(() => undefined); // recorded as FAILED
  clock.advance(60_000);
  await sender.deliver({ ...welcome(other, 'evt-3'), channel: 'SMS', to: other.user.phone });
});

const list = (path: string, viewer?: Viewer) => {
  const req = request(app).get(`/api/v1/notifications${path}`);
  return viewer ? req.set('Authorization', viewer.header) : req;
};

interface Row {
  userId: string;
  template: string;
  channel: string;
  status: string;
  provider?: string;
  error?: string;
  content: { subject?: string; text: string };
}
const rows = (res: request.Response) => (res.body as { data: Row[] }).data;

describe('API-065 GET /notifications/me', () => {
  it('returns my messages, newest first, without delivery internals', async () => {
    const res = await list('/me', customer);
    expect(res.status).toBe(200);
    expect(NotificationListSchema.safeParse(res.body).success).toBe(true);
    expect(rows(res).map((n) => [n.template, n.status])).toEqual([
      ['password_reset', 'FAILED'],
      ['welcome', 'SENT'],
    ]);
    expect(rows(res).every((n) => n.userId === customer.user._id.toHexString())).toBe(true);
    expect(rows(res)[0]).not.toHaveProperty('provider');
    expect(rows(res)[0]).not.toHaveProperty('error');
    // 09 §7: the reset link is never stored, so it is never shown.
    expect(JSON.stringify(res.body)).not.toContain('t0k3n');
    expect((res.body as { meta: unknown }).meta).toEqual({
      page: 1,
      pageSize: 20,
      total: 2,
      totalPages: 1,
    });
  });

  it('paginates', async () => {
    const res = await list('/me?page=2&pageSize=1', customer);
    expect(rows(res).map((n) => n.template)).toEqual(['welcome']);
  });

  it('works for every role (no permission needed)', async () => {
    expect((await list('/me', admin)).status).toBe(200);
    expect(rows(await list('/me', admin))).toEqual([]);
  });

  it('rejects invalid query parameters (400) and anonymous callers (401)', async () => {
    expect((await list('/me?pageSize=0', customer)).status).toBe(400);
    expect((await list('/me?sort=-createdAt', customer)).status).toBe(400);
    expect((await list('/me')).status).toBe(401);
  });
});

describe('API-066 GET /notifications', () => {
  it('ADMIN sees everyone’s messages with delivery details', async () => {
    const res = await list('', admin);
    expect(res.status).toBe(200);
    expect(NotificationListSchema.safeParse(res.body).success).toBe(true);
    expect(rows(res).map((n) => n.template)).toEqual(['welcome', 'password_reset', 'welcome']);
    expect(rows(res)[0]).toMatchObject({ channel: 'SMS', provider: 'test', status: 'SENT' });
    expect(rows(res)[1]).toMatchObject({ status: 'FAILED', error: 'Provider unavailable' });
  });

  it('filters by user, channel, status and template', async () => {
    const id = customer.user._id.toHexString();
    expect(rows(await list(`?userId=${id}`, admin))).toHaveLength(2);
    expect(rows(await list('?channel=SMS', admin)).map((n) => n.userId)).toEqual([
      other.user._id.toHexString(),
    ]);
    expect(rows(await list('?status=FAILED', admin)).map((n) => n.template)).toEqual([
      'password_reset',
    ]);
    expect(rows(await list('?template=welcome&channel=EMAIL', admin))).toHaveLength(1);
  });

  it('rejects invalid filters (400)', async () => {
    expect((await list('?template=newsletter', admin)).status).toBe(400);
    expect((await list('?userId=nope', admin)).status).toBe(400);
    expect((await list('?unknown=1', admin)).status).toBe(400);
  });

  it('is ADMIN-only: 403 for reception and customers, 401 anonymous', async () => {
    expect((await list('', receptionist)).status).toBe(403);
    expect((await list('', customer)).status).toBe(403);
    expect((await list('')).status).toBe(401);
  });
});
