import { expect, type APIRequestContext } from '@playwright/test';

// Test-data setup through the public API (via the frontend's /api proxy, like the browser).
// Only the step under test goes through the UI; everything it needs is prepared here.

export const PASSWORD = 'Password@123'; // seed password for every account (02 §3)
export const SEED = {
  admin: 'admin@straightsalon.local',
  reception: 'reception@straightsalon.local',
  ravi: 'ravi@straightsalon.local',
} as const;

const API = '/api/v1';
const CSRF = { 'X-Requested-With': 'straight-salon-web' }; // every POST /auth/* (06 §4)

export interface Service {
  id: string;
  name: string;
  durationMin: number;
  price: { amountMinor: number; currency: string };
}
export interface Stylist {
  id: string;
  displayName: string;
  serviceIds: string[];
}
export interface Booking {
  id: string;
  bookingRef: string;
  startAt: string;
  status: string;
  total: { amountMinor: number; currency: string };
}

async function json<T>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

/** A unique suffix, so repeated runs against the same stack never collide. */
export function uniqueId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** An unused Indian mobile number in E.164 (02 §2.1). */
export function uniquePhone(): string {
  const digits = `${Date.now()}${Math.floor(Math.random() * 10)}`.slice(-9);
  return `+917${digits}`;
}

export async function login(api: APIRequestContext, email: string): Promise<string> {
  const body = await json<{ accessToken: string }>(
    await api.post(`${API}/auth/login`, { data: { email, password: PASSWORD }, headers: CSRF }),
  );
  return body.accessToken;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function settings(api: APIRequestContext): Promise<{ timezone: string }> {
  return json(await api.get(`${API}/settings/public`));
}

export async function services(api: APIRequestContext): Promise<Service[]> {
  return (await json<{ data: Service[] }>(await api.get(`${API}/services?pageSize=100`))).data;
}

export async function stylists(api: APIRequestContext, serviceId: string): Promise<Stylist[]> {
  return json(await api.get(`${API}/staff?serviceId=${serviceId}`));
}

/** `YYYY-MM-DD` of an instant in the salon's timezone. */
export function salonDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant);
}

/**
 * The first free start for `staffId` on a salon day after today, as seen by front-desk staff.
 * Tomorrow onwards keeps the scenarios independent of the time of day the suite runs.
 */
export async function firstFreeSlot(
  api: APIRequestContext,
  token: string,
  serviceId: string,
  staffId: string,
): Promise<{ date: string; startAt: string }> {
  const { timezone } = await settings(api);
  const day = 24 * 60 * 60 * 1000;
  const from = salonDate(new Date(Date.now() + day), timezone);
  const to = salonDate(new Date(Date.now() + 14 * day), timezone);
  const days = await json<{ availableDates: string[] }>(
    await api.get(
      `${API}/availability/days?serviceIds=${serviceId}&staffId=${staffId}&from=${from}&to=${to}`,
      { headers: bearer(token) },
    ),
  );
  for (const date of days.availableDates) {
    const { slots } = await json<{ slots: { startAt: string }[] }>(
      await api.get(`${API}/availability?serviceIds=${serviceId}&staffId=${staffId}&date=${date}`, {
        headers: bearer(token),
      }),
    );
    if (slots[0]) return { date, startAt: slots[0].startAt };
  }
  throw new Error(`No free slot for stylist ${staffId} between ${from} and ${to}`);
}

/** A walk-in customer record (API-013): name + phone only, unique per run. */
export async function createWalkIn(
  api: APIRequestContext,
  token: string,
  name: string,
): Promise<{ id: string; name: string }> {
  return json(
    await api.post(`${API}/users/walk-in`, {
      data: { name, phone: uniquePhone() },
      headers: bearer(token),
    }),
  );
}

/** A phone booking made by the front desk for a customer (API-050). */
export async function createBooking(
  api: APIRequestContext,
  token: string,
  input: { serviceId: string; staffId: string; startAt: string; customerId: string },
): Promise<Booking> {
  return json(
    await api.post(`${API}/bookings`, {
      data: {
        serviceIds: [input.serviceId],
        staffId: input.staffId,
        startAt: input.startAt,
        customerId: input.customerId,
      },
      headers: bearer(token),
    }),
  );
}

/** Moves a booking along BR-010's graph (API-056). */
export async function setStatus(
  api: APIRequestContext,
  token: string,
  bookingId: string,
  status: 'CHECKED_IN' | 'IN_SERVICE' | 'COMPLETED',
): Promise<Booking> {
  return json(
    await api.post(`${API}/bookings/${bookingId}/status`, {
      data: { status },
      headers: bearer(token),
    }),
  );
}
