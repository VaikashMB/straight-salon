import type { Express } from 'express';
import request from 'supertest';
import { createManualClock, type ManualClock } from '../../src/shared/time/clock.js';
import { zonedDateTime } from '../../src/shared/time/tz.js';
import { loginAs } from './auth.js';
import { createService, createStylist } from './fixtures.js';

// Booking scenarios run on a frozen clock: Monday 2026-10-12, 09:00 in the salon (IST).
// Default settings apply: open 09:30-20:30 every day, 15-minute slots, 60-minute lead time,
// 120-minute cancellation cut-off, 30-day window, no buffer. Fixture stylists have no stored
// schedule, so they work the salon hours (FR-023).
export const TZ = 'Asia/Kolkata';
export const TODAY = '2026-10-12';
export const NOW = '2026-10-12T03:30:00.000Z'; // 09:00 IST

export const local = (time: string, date = TODAY) => zonedDateTime(date, time, TZ).toISOString();

export const frozenClock = (at: string = NOW): ManualClock => createManualClock(at);

export async function salonScenario() {
  const haircut = await createService({ name: 'Haircut', durationMin: 45, priceMinor: 40_000 });
  const beard = await createService({ name: 'Beard Trim', durationMin: 15, priceMinor: 15_000 });
  const colour = await createService({
    name: 'Hair Colour',
    durationMin: 120,
    priceMinor: 250_000,
  });
  const ravi = await createStylist({ displayName: 'Ravi', serviceIds: [haircut._id, beard._id] });
  const arjun = await createStylist({ displayName: 'Arjun', serviceIds: [haircut._id] });
  const customer = await loginAs('CUSTOMER', { name: 'Ananya Rao' });
  const receptionist = await loginAs('RECEPTIONIST');
  const admin = await loginAs('ADMIN');
  return {
    haircut: haircut._id.toHexString(),
    beard: beard._id.toHexString(),
    colour: colour._id.toHexString(),
    ravi,
    arjun,
    customer,
    receptionist,
    admin,
  };
}

export type Scenario = Awaited<ReturnType<typeof salonScenario>>;

export function bookAs(app: Express, header: string, body: Record<string, unknown>) {
  return request(app).post('/api/v1/bookings').set('Authorization', header).send(body);
}

export interface BookingBody {
  id: string;
  bookingRef: string;
  status: string;
  startAt: string;
  endAt: string;
  staff: { id: string; displayName: string };
  customer: { id: string; name: string; phone: string };
  canCancel: boolean;
  canReschedule: boolean;
  source: string;
}
