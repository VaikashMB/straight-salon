import { describe, expect, it } from 'vitest';
import { ROLES, type Role } from '../../../config/constants.js';
import { hasPermission, PERMISSIONS, type Permission } from '../permissions.js';

// The 06 §3 table, row by row. Every permission has at least one allowed and one denied role,
// and each row is asserted for all four roles.
const TABLE: Record<Permission, Role[]> = {
  'booking:create:self': ['CUSTOMER'],
  'booking:create:any': ['RECEPTIONIST', 'ADMIN'],
  'booking:read:own': ['CUSTOMER', 'STAFF'],
  'booking:read:any': ['RECEPTIONIST', 'ADMIN'],
  'booking:status:own': ['STAFF'],
  'booking:status:any': ['RECEPTIONIST', 'ADMIN'],
  'booking:override_rules': ['RECEPTIONIST', 'ADMIN'],
  'payment:record': ['RECEPTIONIST', 'ADMIN'],
  'catalog:manage': ['ADMIN'],
  'staff:manage': ['ADMIN'],
  'schedule:read:own': ['STAFF'],
  'schedule:read:any': ['RECEPTIONIST', 'ADMIN'],
  'timeoff:manage:own': ['STAFF'],
  'timeoff:manage:any': ['ADMIN'],
  'holidays:manage': ['ADMIN'],
  'uploads:create': ['ADMIN'],
  'users:read': ['RECEPTIONIST', 'ADMIN'],
  'users:manage': ['ADMIN'],
  'walkin:create': ['RECEPTIONIST', 'ADMIN'],
  'settings:manage': ['ADMIN'],
  'reports:dashboard': ['RECEPTIONIST', 'ADMIN'],
  'reports:read': ['ADMIN'],
  'notifications:read:any': ['ADMIN'],
  'audit:read': ['ADMIN'],
  'review:moderate': ['ADMIN'],
};

describe('permission map (06 §3)', () => {
  it('covers exactly the permissions in the table', () => {
    expect([...PERMISSIONS].sort()).toEqual(Object.keys(TABLE).sort());
  });

  describe.each(Object.entries(TABLE) as [Permission, Role[]][])('%s', (permission, allowed) => {
    it.each(ROLES.map((role) => [role, allowed.includes(role)] as const))(
      '%s -> %s',
      (role, expected) => {
        expect(hasPermission(role, permission)).toBe(expected);
      },
    );

    it('has at least one allowed and one denied role', () => {
      expect(allowed.length).toBeGreaterThan(0);
      expect(allowed.length).toBeLessThan(ROLES.length);
    });
  });
});
