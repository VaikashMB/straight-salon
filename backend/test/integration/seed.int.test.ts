import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  seedDatabase,
  seedDerivedData,
  SEED_CUSTOMER_COUNT,
  SEED_SERVICE_COUNT,
} from '../../src/db/seed/seed.js';
import { BookingModel } from '../../src/modules/bookings/bookings.model.js';
import { CategoryModel, ServiceModel } from '../../src/modules/catalog/catalog.model.js';
import { HolidayModel } from '../../src/modules/holidays/holidays.model.js';
import { DailyStatsModel } from '../../src/modules/reports/reports.model.js';
import { ReviewModel } from '../../src/modules/reviews/reviews.model.js';
import { SettingsModel } from '../../src/modules/settings/settings.model.js';
import {
  StaffModel,
  StaffScheduleModel,
  TimeOffModel,
} from '../../src/modules/staff/staff.model.js';
import { UserModel } from '../../src/modules/users/users.model.js';
import { createManualClock } from '../../src/shared/time/clock.js';
import { connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { buildWorkerHarness } from '../helpers/worker.js';
import { captureLogger } from '../helpers/logger.js';

beforeAll(connectTestDb);
afterAll(disconnectTestDb);

describe('db:seed (02 §3)', () => {
  it('seeds settings, users, catalogue, staff, schedules, a holiday, time-off, bookings and reviews; reruns add nothing', async () => {
    const clock = createManualClock('2026-10-06T06:00:00Z');
    const { logger } = captureLogger();
    await seedDatabase({ logger, bcryptCost: 4, clock });

    const counts = async () => ({
      settings: await SettingsModel.countDocuments(),
      users: await UserModel.countDocuments(),
      customers: await UserModel.countDocuments({ role: 'CUSTOMER' }),
      categories: await CategoryModel.countDocuments(),
      services: await ServiceModel.countDocuments(),
      staff: await StaffModel.countDocuments(),
      schedules: await StaffScheduleModel.countDocuments(),
      holidays: await HolidayModel.countDocuments(),
      timeOff: await TimeOffModel.countDocuments(),
      bookings: await BookingModel.countDocuments(),
      reviews: await ReviewModel.countDocuments(),
    });
    const first = await counts();
    expect(first).toEqual({
      settings: 1,
      users: 2 + 4 + SEED_CUSTOMER_COUNT,
      customers: 10,
      categories: 4,
      services: SEED_SERVICE_COUNT,
      staff: 4,
      schedules: 4,
      holidays: 1,
      timeOff: 3,
      bookings: first.bookings,
      reviews: first.reviews,
    });
    expect(first.bookings).toBeGreaterThanOrEqual(50);
    expect(first.bookings).toBeLessThanOrEqual(70);

    // Phase 5 seed: every status, payments on completed bookings that add up (BR-011),
    // no overlaps per stylist (BR-004), at most 3 upcoming BOOKED per customer (BR-009).
    const bookings = await BookingModel.find().lean();
    expect(new Set(bookings.map((b) => b.status))).toEqual(
      new Set(['BOOKED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
    );
    for (const b of bookings.filter((x) => x.status === 'COMPLETED')) {
      expect(b.payment.status).toBe('PAID');
      expect((b.payment.amountPaidMinor ?? 0) + (b.payment.discountMinor ?? 0)).toBe(
        b.totalPriceMinor,
      );
    }
    const active = bookings.filter((b) => b.status !== 'CANCELLED' && b.status !== 'NO_SHOW');
    for (const a of active) {
      const clash = active.find(
        (b) =>
          b !== a &&
          b.staffId.equals(a.staffId) &&
          a.startAt < b.blockedUntil &&
          b.startAt < a.blockedUntil,
      );
      expect(clash).toBeUndefined();
    }
    const upcoming = new Map<string, number>();
    for (const b of bookings.filter((x) => x.status === 'BOOKED' && x.startAt > clock.now())) {
      upcoming.set(b.customerId.toHexString(), (upcoming.get(b.customerId.toHexString()) ?? 0) + 1);
    }
    expect(Math.max(...upcoming.values())).toBeLessThanOrEqual(3);
    expect(SEED_SERVICE_COUNT).toBe(15);
    expect(await HolidayModel.findOne().lean()).toMatchObject({ date: '2026-11-15' });

    // One stylist is off on Mondays; every service fits the 15-minute grid (BR-013).
    const schedules = await StaffScheduleModel.find().lean();
    expect(schedules.filter((s) => s.weekly[1]?.isWorking === false)).toHaveLength(1);
    const durations = (await ServiceModel.find().lean()).map((s) => s.durationMin % 15);
    expect(new Set(durations)).toEqual(new Set([0]));

    // Phase 7: a handful of reviews, each on a completed booking by its own customer.
    expect(first.reviews).toBeGreaterThanOrEqual(3);
    expect(first.reviews).toBeLessThanOrEqual(8);
    for (const review of await ReviewModel.find().lean()) {
      const booking = bookings.find((b) => b._id.equals(review.bookingId))!;
      expect(booking.status).toBe('COMPLETED');
      expect(review.customerId.equals(booking.customerId)).toBe(true);
    }

    await seedDatabase({ logger, bcryptCost: 4, clock });
    expect(await counts()).toEqual(first);
  });

  it('seedDerivedData computes ratings and daily_stats from the seeded data', async () => {
    const clock = createManualClock('2026-10-06T06:00:00Z');
    const { services } = buildWorkerHarness({ clock });
    const { logger } = captureLogger();
    await seedDerivedData(services, logger);

    const reviewed = await ReviewModel.distinct('staffId');
    const rated = await StaffModel.find({ ratingCount: mongoose.trusted({ $gt: 0 }) }).lean();
    expect(rated.map((s) => s._id.toHexString()).sort()).toEqual(
      reviewed.map((id) => id.toHexString()).sort(),
    );
    expect(
      await ServiceModel.countDocuments({ ratingCount: mongoose.trusted({ $gt: 0 }) }),
    ).toBeGreaterThan(0);

    // A salon row for every date from the first to the last booking (past 14 + next 7 days).
    const salonRows = await DailyStatsModel.find({ staffId: null }).lean();
    expect(salonRows.length).toBeGreaterThanOrEqual(21);
    const revenue = salonRows.reduce((sum, r) => sum + r.revenueMinor, 0);
    const paid = (await BookingModel.find({ status: 'COMPLETED' }).lean()).reduce(
      (sum, b) => sum + (b.payment.amountPaidMinor ?? 0),
      0,
    );
    expect(revenue).toBe(paid);
  });
});
