import type { Role } from '../../config/constants.js';

// Role -> permission map (06 §3). Ownership ("own booking", "assigned stylist", receptionist
// seeing customers only) is checked in services, not here.
export const PERMISSIONS = [
  'booking:create:self',
  'booking:create:any',
  'booking:read:own',
  'booking:read:any',
  'booking:status:own',
  'booking:status:any',
  'booking:override_rules',
  'payment:record',
  'catalog:manage',
  'staff:manage',
  'schedule:read:own',
  'schedule:read:any',
  'timeoff:manage:own',
  'timeoff:manage:any',
  'holidays:manage',
  'uploads:create',
  'users:read',
  'users:manage',
  'walkin:create',
  'settings:manage',
  'reports:dashboard',
  'reports:read',
  'notifications:read:any',
  'audit:read',
  'review:moderate',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const RECEPTIONIST: Permission[] = [
  'booking:create:any',
  'booking:read:any',
  'booking:status:any',
  'booking:override_rules',
  'payment:record',
  'schedule:read:any',
  'users:read', // customers only (service-level filter)
  'walkin:create',
  'reports:dashboard',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  CUSTOMER: new Set(['booking:create:self', 'booking:read:own']),
  STAFF: new Set([
    'booking:read:own',
    'booking:status:own',
    'schedule:read:own',
    'timeoff:manage:own',
  ]),
  RECEPTIONIST: new Set(RECEPTIONIST),
  ADMIN: new Set<Permission>([
    ...RECEPTIONIST,
    'catalog:manage',
    'staff:manage',
    'timeoff:manage:any',
    'holidays:manage',
    'uploads:create',
    'users:manage',
    'settings:manage',
    'reports:read',
    'notifications:read:any',
    'audit:read',
    'review:moderate',
  ]),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
