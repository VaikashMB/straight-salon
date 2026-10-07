import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLogModel } from '../../src/shared/audit/auditLog.model.js';
import { OutboxModel } from '../../src/shared/events/outbox.model.js';
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
import { buildApiTestApp } from '../setup/testApp.js';

let app: Express;
let s: Scenario;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearCollections();
  app = buildApiTestApp({ clock: frozenClock() }).app;
  s = await salonScenario();
});

const post = (path: string, header: string, payload: object = {}) =>
  request(app).post(`/api/v1${path}`).set('Authorization', header).send(payload);

// A haircut + beard trim (total 55,000), moved to COMPLETED.
async function completedBooking(): Promise<string> {
  const created = await bookAs(app, s.receptionist.header, {
    serviceIds: [s.haircut, s.beard],
    staffId: s.ravi.staffId,
    startAt: local('09:30'),
    customerId: s.customer.user._id.toHexString(),
  });
  const id = (created.body as BookingBody).id;
  for (const status of ['CHECKED_IN', 'IN_SERVICE', 'COMPLETED']) {
    await post(`/bookings/${id}/status`, s.receptionist.header, { status }).expect(200);
  }
  return id;
}

describe('POST /bookings/:id/payment (API-057, BR-011)', () => {
  it('BR-011 records cash with a discount and reason: PAID, audited, EVT-016', async () => {
    const id = await completedBooking();
    const res = await post(`/bookings/${id}/payment`, s.receptionist.header, {
      method: 'CASH',
      amountPaidMinor: 50_000,
      discountMinor: 5_000,
      discountReason: 'Loyalty',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      payment: {
        status: 'PAID',
        method: 'CASH',
        amountPaid: { amountMinor: 50_000, currency: 'INR' },
        discount: { amountMinor: 5_000 },
        discountReason: 'Loyalty',
      },
    });
    expect(
      await AuditLogModel.findOne({ action: 'payment.record', entityId: id }).lean(),
    ).toMatchObject({
      actor: { id: s.receptionist.user._id.toHexString() },
      after: { payment: { status: 'PAID', amountPaidMinor: 50_000 } },
    });
    expect(await OutboxModel.findOne({ type: 'booking.payment_recorded' }).lean()).toMatchObject({
      payload: { bookingId: id, amountPaidMinor: 50_000, method: 'CASH' },
    });
  });

  it('BR-011 rejects amounts that do not add up (422 PAYMENT_MISMATCH) and a discount without reason (400)', async () => {
    const id = await completedBooking();
    const short = await post(`/bookings/${id}/payment`, s.admin.header, {
      method: 'UPI',
      amountPaidMinor: 50_000,
    });
    expect(short.status).toBe(422);
    expect(short.body).toMatchObject({ code: 'PAYMENT_MISMATCH' });
    const noReason = await post(`/bookings/${id}/payment`, s.admin.header, {
      method: 'UPI',
      amountPaidMinor: 50_000,
      discountMinor: 5_000,
    });
    expect(noReason.status).toBe(400);
    expect(
      (
        await post(`/bookings/${id}/payment`, s.admin.header, {
          method: 'UPI',
          amountPaidMinor: 55_000,
        })
      ).status,
    ).toBe(200);
  });

  it('BR-011 only for COMPLETED bookings (422 PAYMENT_NOT_ALLOWED)', async () => {
    const created = await bookAs(app, s.receptionist.header, {
      serviceIds: [s.haircut],
      staffId: s.ravi.staffId,
      startAt: local('12:00'),
      customerId: s.customer.user._id.toHexString(),
    });
    const res = await post(
      `/bookings/${(created.body as BookingBody).id}/payment`,
      s.receptionist.header,
      {
        method: 'CARD',
        amountPaidMinor: 40_000,
      },
    );
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'PAYMENT_NOT_ALLOWED' });
  });

  it('a second payment is 409 PAYMENT_ALREADY_RECORDED; the same Idempotency-Key replays the first', async () => {
    const id = await completedBooking();
    const payload = { method: 'CARD', amountPaidMinor: 55_000 };
    const key = 'pay-0001-abcdef';
    const first = await post(`/bookings/${id}/payment`, s.receptionist.header, payload).set(
      'Idempotency-Key',
      key,
    );
    const replay = await post(`/bookings/${id}/payment`, s.receptionist.header, payload).set(
      'Idempotency-Key',
      key,
    );
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    const again = await post(`/bookings/${id}/payment`, s.receptionist.header, payload);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'PAYMENT_ALREADY_RECORDED' });
    expect(await AuditLogModel.countDocuments({ action: 'payment.record' })).toBe(1);
  });

  it('permission payment:record: stylist and customer 403; unknown booking 404', async () => {
    const id = await completedBooking();
    const payload = { method: 'CASH', amountPaidMinor: 55_000 };
    expect((await post(`/bookings/${id}/payment`, s.ravi.header, payload)).status).toBe(403);
    expect((await post(`/bookings/${id}/payment`, s.customer.header, payload)).status).toBe(403);
    expect((await post(`/bookings/${newId()}/payment`, s.admin.header, payload)).status).toBe(404);
  });
});
