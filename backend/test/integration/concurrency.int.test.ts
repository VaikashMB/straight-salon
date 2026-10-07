import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BookingModel } from '../../src/modules/bookings/bookings.model.js';
import type { RedisLock } from '../../src/shared/locks/redisLock.js';
import { loginAs } from '../helpers/auth.js';
import { bookAs, frozenClock, local, salonScenario, type Scenario } from '../helpers/booking.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { buildApiTestApp } from '../setup/testApp.js';

// 10 §3: ten parallel bookings for the same stylist and slot -> exactly one 201, nine 409.
// Run with the Redis lock, and with the lock stubbed to always succeed, which proves the
// staff-day guard + transaction alone enforce BR-004 (02 §2.18).

let s: Scenario;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearCollections();
  s = await salonScenario();
});

const alwaysGranted: RedisLock = {
  acquire: () => Promise.resolve('token'),
  release: () => Promise.resolve(true),
};

async function race(options: { lock?: RedisLock }) {
  const { app } = buildApiTestApp({ clock: frozenClock(), ...options });
  // Ten different customers, so BR-009 and the per-user rate limit play no part.
  const customers = await Promise.all(Array.from({ length: 10 }, () => loginAs('CUSTOMER')));
  const results = await Promise.all(
    customers.map((c) =>
      bookAs(app, c.header, {
        serviceIds: [s.haircut],
        staffId: s.ravi.staffId,
        startAt: local('11:00'),
      }),
    ),
  );
  return results.map((r) => r.status).sort();
}

describe('BR-004 under concurrency', () => {
  it('with the Redis lock: 1 x 201, 9 x 409', async () => {
    expect(await race({})).toEqual([201, ...Array<number>(9).fill(409)]);
    expect(await BookingModel.countDocuments({ status: 'BOOKED' })).toBe(1);
  });

  it('with the lock stubbed to always succeed (guard + transaction only): 1 x 201, 9 x 409', async () => {
    expect(await race({ lock: alwaysGranted })).toEqual([201, ...Array<number>(9).fill(409)]);
    expect(await BookingModel.countDocuments({ status: 'BOOKED' })).toBe(1);
  });

  it('overlapping but different starts race the same way (guard covers the whole stylist-day)', async () => {
    const { app } = buildApiTestApp({ clock: frozenClock(), lock: alwaysGranted });
    const customers = await Promise.all(Array.from({ length: 6 }, () => loginAs('CUSTOMER')));
    const times = ['11:00', '11:15', '11:30', '11:00', '11:15', '11:30'];
    const results = await Promise.all(
      customers.map((c, i) =>
        bookAs(app, c.header, {
          serviceIds: [s.haircut],
          staffId: s.ravi.staffId,
          startAt: local(times[i]!),
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const booked = await BookingModel.find({ status: 'BOOKED' }).lean();
    expect(booked).toHaveLength(1);
  });
});
