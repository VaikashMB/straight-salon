import type { Schemas } from '../api/client';

// Role-based landing (05 §5) and which signed-in area each role may use. The API enforces
// permissions authoritatively; this only decides where people land and what the UI shows.

export type Role = Schemas['Role'];
export type Area = 'account' | 'staff' | 'admin';

export const AREA_ROLES: Record<Area, readonly Role[]> = {
  account: ['CUSTOMER'],
  staff: ['STAFF'],
  admin: ['ADMIN', 'RECEPTIONIST'], // 05 §3: the admin area is shared; ADMIN-only items are hidden
};

const LANDING: Record<Role, string> = {
  CUSTOMER: '/account',
  STAFF: '/staff',
  RECEPTIONIST: '/admin',
  ADMIN: '/admin',
};

export const landingFor = (role: Role): string => LANDING[role];

export function areaOf(pathname: string): Area | null {
  const first = pathname.split('/')[1];
  return first === 'account' || first === 'staff' || first === 'admin' ? first : null;
}

export const canUseArea = (role: Role, area: Area): boolean => AREA_ROLES[area].includes(role);

// `next` from the URL, if it is a same-site path (no open redirects: "//evil", "/\\evil",
// "https://…" are rejected) and not an auth page (which would bounce straight back).
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next?.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (/^\/(login|register|forgot-password|reset-password)(\/|\?|$)/.test(next)) return null;
  return next;
}

// After signing in: back to where they were going if their role may go there, else their area.
export function postLoginPath(role: Role, next: string | null | undefined): string {
  const safe = safeNextPath(next);
  if (!safe) return landingFor(role);
  const area = areaOf(safe.split('?')[0]!);
  return area && !canUseArea(role, area) ? landingFor(role) : safe;
}

export const loginPathFor = (current: string): string =>
  `/login?next=${encodeURIComponent(current)}`;
