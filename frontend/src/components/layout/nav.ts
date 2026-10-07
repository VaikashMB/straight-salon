import type { Area, Role } from '@/lib/auth/roles';

// Navigation per area (05 §3, §4). `roles` limits an item to those roles (the admin area is
// shared by ADMIN and RECEPTIONIST; reports, audit, settings and staff/catalogue management are
// ADMIN-only). `ready: false` items belong to later build phases: shown as "soon" inside the
// signed-in areas, hidden on the public site.

export interface NavItem {
  href: string;
  label: string;
  roles?: readonly Role[];
  ready: boolean;
}

const ADMIN_ONLY = ['ADMIN'] as const;

export const PUBLIC_NAV: NavItem[] = [
  { href: '/services', label: 'Services', ready: true },
  { href: '/stylists', label: 'Stylists', ready: true },
  { href: '/book', label: 'Book now', ready: true },
];

export const AREA_NAV: Record<Area, NavItem[]> = {
  account: [
    { href: '/account', label: 'Upcoming', ready: true },
    { href: '/account/history', label: 'History', ready: true },
    { href: '/account/profile', label: 'Profile', ready: true },
  ],
  staff: [
    { href: '/staff', label: 'My day', ready: true },
    { href: '/staff/week', label: 'Week', ready: false },
    { href: '/staff/time-off', label: 'Time off', ready: false },
  ],
  admin: [
    { href: '/admin', label: 'Dashboard', ready: true },
    { href: '/admin/bookings', label: 'Bookings', ready: false },
    { href: '/admin/calendar', label: 'Calendar', ready: false },
    { href: '/admin/customers', label: 'Customers', ready: false },
    { href: '/admin/services', label: 'Services', roles: ADMIN_ONLY, ready: false },
    { href: '/admin/categories', label: 'Categories', roles: ADMIN_ONLY, ready: false },
    { href: '/admin/staff', label: 'Staff', roles: ADMIN_ONLY, ready: false },
    { href: '/admin/reviews', label: 'Reviews', roles: ADMIN_ONLY, ready: false },
    { href: '/admin/reports', label: 'Reports', roles: ADMIN_ONLY, ready: false },
    { href: '/admin/notifications', label: 'Notifications', roles: ADMIN_ONLY, ready: false },
    { href: '/admin/audit', label: 'Audit log', roles: ADMIN_ONLY, ready: false },
    { href: '/admin/settings', label: 'Settings', roles: ADMIN_ONLY, ready: false },
  ],
};

export function navFor(area: Area, role: Role): NavItem[] {
  return AREA_NAV[area].filter((item) => !item.roles || item.roles.includes(role));
}

// The item for the current page: the longest href that the path starts with.
export function activeHref(items: NavItem[], pathname: string): string | null {
  const matches = items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length);
  return matches[0]?.href ?? null;
}
