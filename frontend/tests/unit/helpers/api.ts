import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { Schemas } from '@/lib/api/client';

// MSW API mocks (10 §4). The client calls the page's own origin (proxy.ts forwards to the API).
export const ORIGIN = 'http://localhost:3000';
export const api = (path: string) => `${ORIGIN}/api/v1${path}`;

export function problem(status: number, code: string, extra: Record<string, unknown> = {}) {
  return HttpResponse.json(
    {
      type: 'about:blank',
      title: code,
      status,
      code,
      detail: code,
      requestId: 'req-123',
      ...extra,
    },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

export const settings: Schemas['PublicSettings'] = {
  name: 'Straight Salon',
  address: '12 MG Road, Bengaluru',
  phone: '+918041234567',
  email: 'hello@straightsalon.local',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  businessHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    isOpen: true,
    open: '09:30',
    close: '20:30',
  })),
  slotGranularityMin: 15,
  minLeadTimeMin: 60,
  maxAdvanceDays: 30,
  cancellationCutoffMin: 120,
};

export function makeUser(overrides: Partial<Schemas['User']> = {}): Schemas['User'] {
  return {
    id: '6712c0f9a1b2c3d4e5f60111',
    name: 'Ananya Rao',
    email: 'ananya@example.com',
    phone: '+919876543212',
    role: 'CUSTOMER',
    isActive: true,
    isWalkIn: false,
    preferences: { smsOptIn: true, emailOptIn: true },
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

// Default: an anonymous visitor (no refresh cookie) and public settings.
export const server = setupServer(
  http.post(api('/auth/refresh'), () => problem(401, 'UNAUTHENTICATED')),
  http.get(api('/settings/public'), () => HttpResponse.json(settings)),
);

// A signed-in user: refresh issues a token, /auth/me returns them.
export function signedInAs(user: Schemas['User'], token = 'token-1') {
  server.use(
    http.post(api('/auth/refresh'), () => HttpResponse.json({ accessToken: token })),
    http.get(api('/auth/me'), ({ request }) =>
      request.headers.get('authorization') === `Bearer ${token}`
        ? HttpResponse.json(user)
        : problem(401, 'UNAUTHENTICATED'),
    ),
  );
}
