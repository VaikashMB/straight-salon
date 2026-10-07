import { describe, expect, it } from 'vitest';
import { activeHref, AREA_NAV, navFor } from '@/components/layout/nav';

const labels = (items: { label: string }[]) => items.map((i) => i.label);

describe('area navigation by role (05 §3, §4.4)', () => {
  it('reception sees the shared admin items only; admin sees everything', () => {
    expect(labels(navFor('admin', 'RECEPTIONIST'))).toEqual([
      'Dashboard',
      'Bookings',
      'Calendar',
      'Customers',
    ]);
    expect(navFor('admin', 'ADMIN')).toHaveLength(AREA_NAV.admin.length);
    for (const adminOnly of ['Reports', 'Audit log', 'Settings', 'Staff']) {
      expect(labels(navFor('admin', 'ADMIN'))).toContain(adminOnly);
      expect(labels(navFor('admin', 'RECEPTIONIST'))).not.toContain(adminOnly);
    }
    expect(labels(navFor('account', 'CUSTOMER'))).toEqual(['Upcoming', 'History', 'Profile']);
  });

  it('marks the most specific matching item as current', () => {
    const items = AREA_NAV.account;
    expect(activeHref(items, '/account')).toBe('/account');
    expect(activeHref(items, '/account/history/2026')).toBe('/account/history');
    expect(activeHref(items, '/elsewhere')).toBeNull();
  });
});
