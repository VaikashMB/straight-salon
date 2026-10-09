import {
  Bell,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  ChartColumn,
  ClipboardList,
  History,
  LayoutDashboard,
  ScrollText,
  Scissors,
  Settings,
  Star,
  Sun,
  Tags,
  UserCog,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Area, Role } from '@/lib/auth/roles';

// Navigation per area (05 §3, §4). `roles` limits an item to those roles (the admin area is
// shared by ADMIN and RECEPTIONIST; reports, audit, settings and staff/catalogue management are
// ADMIN-only). Area items carry a decorative icon for the sidebar and the mobile pills.

export interface NavItem {
  href: string;
  label: string;
  roles?: readonly Role[];
}

export interface AreaNavItem extends NavItem {
  icon: LucideIcon;
}

const ADMIN_ONLY = ['ADMIN'] as const;

export const PUBLIC_NAV: NavItem[] = [
  { href: '/services', label: 'Services' },
  { href: '/stylists', label: 'Stylists' },
  { href: '/book', label: 'Book now' },
];

export const AREA_NAV: Record<Area, AreaNavItem[]> = {
  account: [
    { href: '/account', label: 'Upcoming', icon: CalendarDays },
    { href: '/account/history', label: 'History', icon: History },
    { href: '/account/profile', label: 'Profile', icon: UserRound },
  ],
  staff: [
    { href: '/staff', label: 'My day', icon: Sun },
    { href: '/staff/week', label: 'Week', icon: CalendarRange },
    { href: '/staff/time-off', label: 'Time off', icon: CalendarOff },
  ],
  admin: [
    { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/admin/bookings', label: 'Bookings', icon: ClipboardList },
    { href: '/admin/calendar', label: 'Calendar', icon: CalendarDays },
    { href: '/admin/customers', label: 'Customers', icon: Users },
    { href: '/admin/services', label: 'Services', icon: Scissors, roles: ADMIN_ONLY },
    { href: '/admin/categories', label: 'Categories', icon: Tags, roles: ADMIN_ONLY },
    { href: '/admin/staff', label: 'Staff', icon: UserCog, roles: ADMIN_ONLY },
    { href: '/admin/reviews', label: 'Reviews', icon: Star, roles: ADMIN_ONLY },
    { href: '/admin/reports', label: 'Reports', icon: ChartColumn, roles: ADMIN_ONLY },
    { href: '/admin/notifications', label: 'Notifications', icon: Bell, roles: ADMIN_ONLY },
    { href: '/admin/audit', label: 'Audit log', icon: ScrollText, roles: ADMIN_ONLY },
    { href: '/admin/settings', label: 'Settings', icon: Settings, roles: ADMIN_ONLY },
  ],
};

export function navFor(area: Area, role: Role): AreaNavItem[] {
  return AREA_NAV[area].filter((item) => !item.roles || item.roles.includes(role));
}

// The item for the current page: the longest href that the path starts with.
export function activeHref(items: NavItem[], pathname: string): string | null {
  const matches = items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length);
  return matches[0]?.href ?? null;
}
