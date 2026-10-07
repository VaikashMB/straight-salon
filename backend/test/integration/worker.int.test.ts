import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cacheKeys, cacheTags } from '../../src/shared/cache/keys.js';
import { ProcessedEventModel } from '../../src/shared/events/idempotent.js';
import { OutboxModel } from '../../src/shared/events/outbox.model.js';
import { UserModel } from '../../src/modules/users/users.model.js';
import type { ManualClock } from '../../src/shared/time/clock.js';
import { encryptionKey } from '../factories/index.js';
import { CSRF, createUser } from '../helpers/auth.js';
import {
  bookAs,
  frozenClock,
  local,
  salonScenario,
  type BookingBody,
  type Scenario,
} from '../helpers/booking.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { APP_BASE_URL, buildWorkerHarness } from '../helpers/worker.js';
import { buildApiTestApp } from '../setup/testApp.js';

// Phase 6 done-when: a booking made through the API produces its messages through the outbox,
// relay and consumers (09 §4–6), with idempotent delivery and retries.

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

const book = async (startTime = '11:00', staffId?: string) => {
  const res = await bookAs(app, s.customer.header, {
    serviceIds: [s.haircut],
    staffId: staffId ?? s.ravi.staffId,
    startAt: local(startTime),
  });
  expect(res.status).toBe(201);
  return res.body as BookingBody;
};

const sent = () =>
  worker.notifications().then((rows) =>
    rows.map((r) => ({
      userId: r.userId.toHexString(),
      channel: r.channel,
      template: r.template,
      status: r.status,
    })),
  );

describe('notifications consumer (09 §5)', () => {
  it('EVT-010 a booking sends the customer a confirmation by email and SMS (FR-050)', async () => {
    const booking = await book();
    expect(await worker.drain()).toMatchObject({ failed: 0 });

    const customerId = s.customer.user._id.toHexString();
    expect((await sent()).filter((n) => n.userId === customerId)).toEqual([
      { userId: customerId, channel: 'EMAIL', template: 'booking_confirmed', status: 'SENT' },
      { userId: customerId, channel: 'SMS', template: 'booking_confirmed', status: 'SENT' },
    ]);
    const email = worker.providers.emails.find((m) => m.to === s.customer.user.email)!;
    expect(email.subject).toBe('Booking confirmed: Mon 12 Oct 2026, 11:00');
    expect(email.text).toContain(booking.bookingRef);
    expect(email.text).toContain(`${APP_BASE_URL}/account/bookings/${booking.id}`);
    expect(worker.providers.texts.find((m) => m.to === s.customer.user.phone)!.text).toContain(
      `booking ${booking.bookingRef} confirmed for Mon 12 Oct 2026, 11:00 with Ravi`,
    );
  });

  it('EVT-010 FR-052 the assigned stylist is told about the new booking', async () => {
    await book();
    await worker.drain();
    const stylistId = s.ravi.user._id.toHexString();
    expect((await sent()).filter((n) => n.userId === stylistId)).toEqual([
      { userId: stylistId, channel: 'EMAIL', template: 'staff_booking_assigned', status: 'SENT' },
      { userId: stylistId, channel: 'SMS', template: 'staff_booking_assigned', status: 'SENT' },
    ]);
    const email = worker.providers.emails.find((m) => m.to === s.ravi.user.email)!;
    expect(email.text).toContain('Customer: Ananya'); // first name only (00 US-04)
    expect(email.text).not.toContain('Rao');
  });

  it('09 §6 a duplicate delivery sends nothing again', async () => {
    await book();
    await worker.drain();
    const before = { emails: worker.providers.emails.length, rows: (await sent()).length };
    expect(before.rows).toBe(4);

    // At-least-once: the relay publishes the same events again.
    for (const event of [...worker.bus.published]) await worker.bus.publish(event);
    expect(worker.providers.emails).toHaveLength(before.emails);
    expect(await sent()).toHaveLength(before.rows);
  });

  it('09 §6 a provider failure is retried and then sent once', async () => {
    await book();
    worker.providers.failNext(1);
    expect(await worker.drain()).toMatchObject({ published: 0, failed: 1 });
    const failed = await worker.notifications();
    expect(failed[0]).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      error: 'Provider unavailable',
    });
    expect(await ProcessedEventModel.countDocuments({ consumer: 'notifications' })).toBe(0);

    expect(await worker.drain()).toMatchObject({ published: 1, failed: 0 });
    const rows = await worker.notifications();
    expect(rows[0]).toMatchObject({ status: 'SENT', attempts: 2 });
    expect(rows[0]!.error).toBeUndefined();
    expect(rows.every((r) => r.status === 'SENT')).toBe(true);
    expect(await OutboxModel.countDocuments({ status: 'PUBLISHED' })).toBe(1);
  });

  it('EVT-011 a reassignment tells the customer, the new and the old stylist', async () => {
    const booking = await book();
    await worker.drain();
    const res = await request(app)
      .post(`/api/v1/bookings/${booking.id}/reschedule`)
      .set('Authorization', s.customer.header)
      .send({ startAt: local('12:00'), staffId: s.arjun.staffId });
    expect(res.status).toBe(200);
    await worker.drain();

    const templates = (await sent()).map((n) => `${n.userId}:${n.channel}:${n.template}`);
    const [customer, ravi, arjun] = [s.customer, s.ravi, s.arjun].map((x) =>
      x.user._id.toHexString(),
    );
    expect(templates).toEqual(
      expect.arrayContaining([
        `${customer}:EMAIL:booking_rescheduled`,
        `${arjun}:EMAIL:staff_booking_assigned`,
        `${ravi}:EMAIL:staff_booking_cancelled`,
      ]),
    );
    const moved = worker.providers.emails.find((m) => m.subject.startsWith('Booking moved to'))!;
    expect(moved.text).toContain('moved from Mon 12 Oct 2026, 11:00 to Mon 12 Oct 2026, 12:00');
    const removed = worker.providers.emails.find(
      (m) => m.to === s.ravi.user.email && m.subject.startsWith('Booking removed'),
    )!;
    // The old stylist sees the slot they had.
    expect(removed.text).toContain('When: Mon 12 Oct 2026, 11:00');
    expect(removed.text).toContain('Reassigned to another stylist');
  });

  it('EVT-011 a move with the same stylist sends the stylist "changed"', async () => {
    const booking = await book();
    await worker.drain();
    await request(app)
      .post(`/api/v1/bookings/${booking.id}/reschedule`)
      .set('Authorization', s.customer.header)
      .send({ startAt: local('12:00') })
      .expect(200);
    await worker.drain();
    expect(
      (await sent())
        .filter((n) => n.userId === s.ravi.user._id.toHexString() && n.channel === 'EMAIL')
        .map((n) => n.template),
    ).toEqual(['staff_booking_assigned', 'staff_booking_changed']);
  });

  it('EVT-012 a cancellation tells the customer and the stylist, with the reason', async () => {
    const booking = await book();
    await request(app)
      .post(`/api/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', s.customer.header)
      .send({ reason: 'Feeling unwell' })
      .expect(200);
    await worker.drain();
    const templates = (await sent()).filter((n) => n.channel === 'EMAIL').map((n) => n.template);
    expect(templates).toEqual(
      expect.arrayContaining(['booking_cancelled', 'staff_booking_cancelled']),
    );
    const email = worker.providers.emails.find((m) => m.subject.startsWith('Booking cancelled'))!;
    expect(email.text).toContain('Reason: Feeling unwell');
  });

  it('EVT-014 completion sends a thank-you; EVT-015 a no-show sends "we missed you"', async () => {
    const done = await book('10:00');
    const missed = await book('10:30', s.arjun.staffId);
    clock.set(local('10:01'));
    for (const status of ['CHECKED_IN', 'IN_SERVICE', 'COMPLETED']) {
      await request(app)
        .post(`/api/v1/bookings/${done.id}/status`)
        .set('Authorization', s.receptionist.header)
        .send({ status })
        .expect(200);
    }
    clock.set(local('10:35'));
    await request(app)
      .post(`/api/v1/bookings/${missed.id}/status`)
      .set('Authorization', s.receptionist.header)
      .send({ status: 'NO_SHOW' })
      .expect(200);
    await worker.drain();

    const subjects = worker.providers.emails
      .filter((m) => m.to === s.customer.user.email)
      .map((m) => m.subject);
    expect(subjects).toEqual(
      expect.arrayContaining(['Thank you for visiting Straight Salon', 'We missed you today']),
    );
  });

  it('FR-054 SMS opt-out is respected; walk-ins without email get SMS only', async () => {
    await UserModel.updateOne(
      { _id: s.customer.user._id },
      { $set: { 'preferences.smsOptIn': false } },
    );
    await book();
    const walkIn = await request(app)
      .post('/api/v1/users/walk-in')
      .set('Authorization', s.receptionist.header)
      .send({ name: 'Walk In', phone: '+919811100011' });
    await bookAs(app, s.receptionist.header, {
      serviceIds: [s.haircut],
      staffId: s.arjun.staffId,
      startAt: local('11:00'),
      customerId: (walkIn.body as { id: string }).id,
    }).expect(201);
    await worker.drain();

    const customerMessages = (await sent()).filter((n) => n.template === 'booking_confirmed');
    expect(customerMessages.map((n) => [n.userId, n.channel])).toEqual([
      [s.customer.user._id.toHexString(), 'EMAIL'],
      [(walkIn.body as { id: string }).id, 'SMS'],
    ]);
  });

  it('a deactivated customer gets nothing', async () => {
    await book();
    await UserModel.updateOne({ _id: s.customer.user._id }, { $set: { isActive: false } });
    await worker.drain();
    expect((await sent()).filter((n) => n.userId === s.customer.user._id.toHexString())).toEqual(
      [],
    );
  });
});

describe('account messages (EVT-001, EVT-002)', () => {
  const auth = (path: string) => request(app).post(`/api/v1/auth/${path}`).set(CSRF);

  it('EVT-001 registration sends a welcome email only (no SMS)', async () => {
    const res = await auth('register').send({
      name: 'Meera Iyer',
      email: 'meera@example.com',
      phone: '+919812300012',
      password: 'Fresh-Look-26',
    });
    expect(res.status).toBe(201);
    await worker.drain();
    expect((await sent()).map((n) => [n.channel, n.template])).toEqual([['EMAIL', 'welcome']]);
    expect(worker.providers.emails[0]).toMatchObject({
      to: 'meera@example.com',
      subject: 'Welcome to Straight Salon',
    });
  });

  it('EVT-002 FR-004 the reset email carries a working single-use link; the stored copy does not', async () => {
    const user = await createUser({ email: 'reset.me@example.com' });
    expect((await auth('forgot-password').send({ email: 'reset.me@example.com' })).status).toBe(
      202,
    );
    await worker.drain();

    const email = worker.providers.emails.find((m) => m.to === 'reset.me@example.com')!;
    expect(email.subject).toBe('Reset your Straight Salon password');
    const link = /http:\/\/salon\.test\/reset-password\?token=([\w%-]+)/.exec(email.text);
    expect(link).not.toBeNull();
    const token = decodeURIComponent(link![1]!);

    const [stored] = await worker.notifications();
    expect(stored).toMatchObject({ userId: user._id, template: 'password_reset', status: 'SENT' });
    expect(JSON.stringify(stored!.payload)).not.toContain(token);
    expect(stored!.payload.text).toContain('[redacted]');
    // The SMS channel is not used for account messages.
    expect(worker.providers.texts).toHaveLength(0);

    expect(
      (await auth('reset-password').send({ token, newPassword: 'Brand-New-2027' })).status,
    ).toBe(204);
  });
});

describe('cache-invalidation consumer (08 §4)', () => {
  it('clears the booked stylist/day even if the API never did', async () => {
    await book();
    // An availability entry cached after the API's own invalidation, as if the API had died
    // between commit and invalidating.
    const key = cacheKeys.availability(s.ravi.staffId, '2026-10-12', 45);
    await worker.services.cache.cacheAside(key, 60, () => Promise.resolve(['stale']), {
      tags: [cacheTags.availability(s.ravi.staffId, '2026-10-12')],
    });
    expect(await worker.redis.get(key)).not.toBeNull();

    await worker.drain();
    expect(await worker.redis.get(key)).toBeNull();
  });
});
