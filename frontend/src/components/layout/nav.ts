import type { Area, Role } from '@/lib/auth/roles';

// Navigation per area (05 §3, §4). `roles` limits an item to those roles (the admin area is
// shared by ADMIN and RECEPTIONIST; reports, audit, settings and staff/catalogue management are
// ADMIN-only).

export interface NavItem {
  href: string;
  label: string;
  roles?: readonly Role[];
}

const ADMIN_ONLY = ['ADMIN'] as const;

export const PUBLIC_NAV: NavItem[] = [
  { href: '/services', label: 'Services' },
  { href: '/stylists', label: 'Stylists' },
  { href: '/book', label: 'Book now' },
];

export const AREA_NAV: Record<Area, NavItem[]> = {
  account: [
    { href: '/account', label: 'Upcoming' },
    { href: '/account/history', label: 'History' },
    { href: '/account/profile', label: 'Profile' },
  ],
  staff: [
    { href: '/staff', label: 'My day' },
    { href: '/staff/week', label: 'Week' },
    { href: '/staff/time-off', label: 'Time off' },
  ],
  admin: [
    { href: '/admin', label: 'Dashboard' },
    { href: '/admin/bookings', label: 'Bookings' },
    { href: '/admin/calendar', label: 'Calendar' },
    { href: '/admin/customers', label: 'Customers' },
    { href: '/admin/services', label: 'Services', roles: ADMIN_ONLY },
    { href: '/admin/categories', label: 'Categories', roles: ADMIN_ONLY },
    { href: '/admin/staff', label: 'Staff', roles: ADMIN_ONLY },
    { href: '/admin/reviews', label: 'Reviews', roles: ADMIN_ONLY },
    { href: '/admin/reports', label: 'Reports', roles: ADMIN_ONLY },
    { href: '/admin/notifications', label: 'Notifications', roles: ADMIN_ONLY },
    { href: '/admin/audit', label: 'Audit log', roles: ADMIN_ONLY },
    { href: '/admin/settings', label: 'Settings', roles: ADMIN_ONLY },
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
