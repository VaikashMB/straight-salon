import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ServiceModel } from '../../src/modules/catalog/catalog.model.js';
import { StaffModel } from '../../src/modules/staff/staff.model.js';
import { ReviewModel } from '../../src/modules/reviews/reviews.model.js';
import { AuditLogModel } from '../../src/shared/audit/auditLog.model.js';
import { ProcessedEventModel } from '../../src/shared/events/idempotent.js';
import { OutboxModel } from '../../src/shared/events/outbox.model.js';
import type { ManualClock } from '../../src/shared/time/clock.js';
import { encryptionKey } from '../factories/index.js';
import { loginAs } from '../helpers/auth.js';
import {
  bookAs,
  frozenClock,
  local,
  salonScenario,
  type BookingBody,
  type Scenario,
} from '../helpers/booking.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { newId } from '../helpers/fixtures.js';
import { buildWorkerHarness } from '../helpers/worker.js';
import { buildApiTestApp } from '../setup/testApp.js';

// Reviews: BR-012, API-060..062, FR-060..062, and the ratings consumer (09 §5).

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

// Haircut + beard trim with Ravi at `time`, moved to `until` (COMPLETED by default).
async function booking(time = '09:30', until = 'COMPLETED'): Promise<string> {
  const created = await bookAs(app, s.receptionist.header, {
    serviceIds: [s.haircut, s.beard],
    staffId: s.ravi.staffId,
    startAt: local(time),
    customerId: s.customer.user._id.toHexString(),
  });
  expect(created.status).toBe(201);
  const id = (created.body as BookingBody).id;
  for (const status of ['CHECKED_IN', 'IN_SERVICE', 'COMPLETED']) {
    await post(`/bookings/${id}/status`, s.receptionist.header, { status }).expect(200);
    if (status === until) break;
  }
  return id;
}

const review = (id: string, header = s.customer.header, payload: object = { rating: 5 }) =>
  post(`/bookings/${id}/review`, header, payload);

describe('POST /bookings/:id/review (API-060, BR-012)', () => {
  it('BR-012 the customer reviews a completed booking: 201, audited, EVT-020, canReview turns off', async () => {
    const id = await booking();
    const before = await request(app)
      .get(`/api/v1/bookings/${id}`)
      .set('Authorization', s.customer.header);
    expect(before.body).toMatchObject({ status: 'COMPLETED', canReview: true });

    const res = await review(id, s.customer.header, { rating: 4, comment: '  Sharp fade.  ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      rating: 4,
      comment: 'Sharp fade.',
      customer: { name: 'Ananya' },
      staff: { id: s.ravi.staffId, displayName: 'Ravi' },
      services: [
        { id: s.haircut, name: 'Haircut' },
        { id: s.beard, name: 'Beard Trim' },
      ],
    });
    expect(res.body).not.toHaveProperty('isHidden');
    expect(res.body).not.toHaveProperty('bookingId');

    const reviewId = (res.body as { id: string }).id;
    expect(await AuditLogModel.findOne({ action: 'review.create' }).lean()).toMatchObject({
      entityType: 'review',
      entityId: reviewId,
      actor: { id: s.customer.user._id.toHexString(), role: 'CUSTOMER' },
      after: { rating: 4, isHidden: false },
    });
    expect(await OutboxModel.findOne({ type: 'review.created' }).lean()).toMatchObject({
      payload: { reviewId, staffId: s.ravi.staffId, serviceIds: [s.haircut, s.beard], rating: 4 },
    });

    const after = await request(app)
      .get('/api/v1/bookings/me?scope=past')
      .set('Authorization', s.customer.header);
    expect((after.body as { data: BookingBody[] }).data[0]).toMatchObject({ canReview: false });
  });

  it('BR-012 rejects bookings that are not COMPLETED (422 REVIEW_NOT_ALLOWED); canReview is false', async () => {
    const id = await booking('09:30', 'IN_SERVICE');
    const res = await review(id);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'REVIEW_NOT_ALLOWED' });
    const dto = await request(app)
      .get(`/api/v1/bookings/${id}`)
      .set('Authorization', s.customer.header);
    expect(dto.body).toMatchObject({ canReview: false });
  });

  it('BR-012 open for reviewWindowDays after completion, then 422', async () => {
    // Both completed at the frozen "now".
    const id = await booking('09:30');
    const late = await booking('11:00');
    clock.advance(14 * 86_400_000); // exactly at the edge
    expect((await review(id)).status).toBe(201);

    clock.advance(1);
    const res = await review(late);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'REVIEW_NOT_ALLOWED' });
  });

  it('BR-012 one review per booking: the second is 409 DUPLICATE', async () => {
    const id = await booking();
    expect((await review(id)).status).toBe(201);
    const again = await review(id, s.customer.header, { rating: 1 });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'DUPLICATE' });
    expect(await ReviewModel.countDocuments()).toBe(1);
  });

  it("another customer's booking and unknown bookings are 404 (06 §3)", async () => {
    const id = await booking();
    const other = await loginAs('CUSTOMER');
    expect((await review(id, other.header)).status).toBe(404);
    expect((await review(newId())).status).toBe(404);
  });

  it('only customers (403 for staff roles), only signed in (401), validated (400)', async () => {
    const id = await booking();
    expect((await review(id, s.admin.header)).status).toBe(403);
    expect((await review(id, s.ravi.header)).status).toBe(403);
    expect(
      (await request(app).post(`/api/v1/bookings/${id}/review`).send({ rating: 5 })).status,
    ).toBe(401);
    expect((await review(id, s.customer.header, { rating: 6 })).status).toBe(400);
    expect((await review(id, s.customer.header, { rating: 4.5 })).status).toBe(400);
    expect((await review(id, s.customer.header, { rating: 5, extra: 1 })).status).toBe(400);
    expect(
      (await review(id, s.customer.header, { rating: 5, comment: 'x'.repeat(501) })).status,
    ).toBe(400);
  });
});

describe('GET /reviews (API-061) and PATCH /reviews/:id (API-062)', () => {
  async function twoReviews() {
    const first = await booking('09:30');
    const second = await booking('11:00');
    const a = (await review(first, s.customer.header, { rating: 5 })).body as { id: string };
    clock.advance(60_000);
    const b = (await review(second, s.customer.header, { rating: 2, comment: 'Rude remark' }))
      .body as { id: string };
    return { a: a.id, b: b.id };
  }

  const list = (query = '', header?: string) => {
    const req = request(app).get(`/api/v1/reviews${query}`);
    return header ? req.set('Authorization', header) : req;
  };

  it('API-061 public: visible reviews, newest first, filtered by stylist or service', async () => {
    const { a, b } = await twoReviews();
    const all = await list();
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ meta: { total: 2, page: 1 } });
    expect((all.body as { data: { id: string }[] }).data.map((r) => r.id)).toEqual([b, a]);

    expect((await list(`?staffId=${s.ravi.staffId}`)).body).toMatchObject({ meta: { total: 2 } });
    expect((await list(`?staffId=${s.arjun.staffId}`)).body).toMatchObject({ meta: { total: 0 } });
    expect((await list(`?serviceId=${s.beard}`)).body).toMatchObject({ meta: { total: 2 } });
    expect((await list(`?serviceId=${s.colour}`)).body).toMatchObject({ meta: { total: 0 } });
    expect((await list('?pageSize=1&page=2')).body).toMatchObject({
      data: [{ id: a }],
      meta: { totalPages: 2 },
    });
    expect((await list('?staffId=nope')).status).toBe(400);
  });

  it('FR-062 API-062 hiding needs a reason, is audited, emits EVT-021 and leaves the public list', async () => {
    const { a, b } = await twoReviews();
    const patch = (id: string, header: string, payload: object) =>
      request(app).patch(`/api/v1/reviews/${id}`).set('Authorization', header).send(payload);

    expect((await patch(b, s.admin.header, { isHidden: true })).status).toBe(400);
    const hidden = await patch(b, s.admin.header, { isHidden: true, hiddenReason: 'Abusive' });
    expect(hidden.status).toBe(200);
    expect(hidden.body).toMatchObject({ id: b, isHidden: true, hiddenReason: 'Abusive' });
    expect(await AuditLogModel.findOne({ action: 'review.hide' }).lean()).toMatchObject({
      entityId: b,
      before: { isHidden: false },
      after: { isHidden: true, hiddenReason: 'Abusive' },
    });
    expect(await OutboxModel.findOne({ type: 'review.visibility_changed' }).lean()).toMatchObject({
      payload: { reviewId: b, isHidden: true },
    });

    const visible = await list();
    expect((visible.body as { data: { id: string }[] }).data.map((r) => r.id)).toEqual([a]);

    // Same state again: nothing to record.
    await patch(b, s.admin.header, { isHidden: true, hiddenReason: 'Abusive' }).expect(200);
    expect(await AuditLogModel.countDocuments({ action: 'review.hide' })).toBe(1);

    const shown = await patch(b, s.admin.header, { isHidden: false });
    expect(shown.body).toMatchObject({ isHidden: false });
    expect(shown.body).not.toHaveProperty('hiddenReason');
    expect(await AuditLogModel.countDocuments({ action: 'review.unhide' })).toBe(1);
    expect((await patch(b, s.admin.header, { isHidden: false, hiddenReason: 'x' })).status).toBe(
      400,
    );
  });

  it('permission review:moderate: ADMIN only; unknown review 404', async () => {
    const { b } = await twoReviews();
    const body = { isHidden: true, hiddenReason: 'Abusive' };
    const patch = (id: string, header?: string) => {
      const req = request(app).patch(`/api/v1/reviews/${id}`);
      return (header ? req.set('Authorization', header) : req).send(body);
    };
    expect((await patch(b, s.receptionist.header)).status).toBe(403);
    expect((await patch(b, s.customer.header)).status).toBe(403);
    expect((await patch(b)).status).toBe(401);
    expect((await patch(newId(), s.admin.header)).status).toBe(404);
  });

  it('includeHidden=true is the ADMIN moderation view (401 anonymous, 403 others)', async () => {
    const { b } = await twoReviews();
    await request(app)
      .patch(`/api/v1/reviews/${b}`)
      .set('Authorization', s.admin.header)
      .send({ isHidden: true, hiddenReason: 'Abusive' })
      .expect(200);
    expect((await list('?includeHidden=true')).status).toBe(401);
    expect((await list('?includeHidden=true', s.receptionist.header)).status).toBe(403);
    expect((await list('', 'Bearer not-a-token')).status).toBe(401);

    const admin = await list('?includeHidden=true', s.admin.header);
    expect(admin.status).toBe(200);
    expect(admin.body).toMatchObject({ meta: { total: 2 } });
    expect((admin.body as { data: unknown[] }).data[0]).toMatchObject({
      id: b,
      isHidden: true,
      hiddenReason: 'Abusive',
      customer: { id: s.customer.user._id.toHexString(), name: 'Ananya Rao' },
    });
    // The admin's ordinary view is the public one.
    expect((await list('', s.admin.header)).body).toMatchObject({ meta: { total: 1 } });
  });
});

describe('ratings consumer (09 §5, FR-061)', () => {
  const ratingOf = async () => ({
    ravi: await StaffModel.findById(s.ravi.staffId, { ratingAvg: 1, ratingCount: 1 }).lean(),
    haircut: await ServiceModel.findById(s.haircut, { ratingAvg: 1, ratingCount: 1 }).lean(),
  });

  it('EVT-020 / EVT-021 recompute the stylist and service averages from visible reviews', async () => {
    const first = await booking('09:30');
    const second = await booking('11:00');
    const third = await booking('12:30');
    await review(first, s.customer.header, { rating: 5 });
    await review(second, s.customer.header, { rating: 4 });
    const hide = (await review(third, s.customer.header, { rating: 1 })).body as { id: string };
    expect(await worker.drain()).toMatchObject({ failed: 0 });
    expect(await ratingOf()).toMatchObject({
      ravi: { ratingAvg: 3.33, ratingCount: 3 },
      haircut: { ratingAvg: 3.33, ratingCount: 3 },
    });

    await request(app)
      .patch(`/api/v1/reviews/${hide.id}`)
      .set('Authorization', s.admin.header)
      .send({ isHidden: true, hiddenReason: 'Spam' })
      .expect(200);
    await worker.drain();
    expect(await ratingOf()).toMatchObject({
      ravi: { ratingAvg: 4.5, ratingCount: 2 },
      haircut: { ratingAvg: 4.5, ratingCount: 2 },
    });

    // The public stylist profile shows the new figure (its cache was cleared).
    const profile = await request(app).get(`/api/v1/staff/${s.ravi.staffId}`);
    expect(profile.body).toMatchObject({ ratingAvg: 4.5, ratingCount: 2 });
  });

  it('a repeated delivery is a no-op; an unknown review is skipped with a warning', async () => {
    const id = await booking();
    await review(id, s.customer.header, { rating: 3 });
    await worker.drain();
    const envelope = worker.bus.published.find((e) => e.type === 'review.created')!;
    await worker.bus.publish(envelope);
    expect(await ProcessedEventModel.countDocuments({ consumer: 'ratings' })).toBe(1);

    await worker.bus.publish({
      ...envelope,
      eventId: '00000000-0000-4000-8000-000000000001',
      payload: { ...(envelope.payload as object), reviewId: newId() },
    });
    expect(worker.logs().some((l) => l.msg === 'Review not found; ratings left as they are')).toBe(
      true,
    );
    expect(await ratingOf()).toMatchObject({ ravi: { ratingAvg: 3, ratingCount: 1 } });
  });
});
