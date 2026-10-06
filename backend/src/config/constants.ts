// Domain enums shared across modules, event payloads and OpenAPI (02-database, 06 §3).

export const ROLES = ['CUSTOMER', 'STAFF', 'RECEPTIONIST', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const BOOKING_STATUSES = [
  'BOOKED',
  'CHECKED_IN',
  'IN_SERVICE',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

// BR-004: statuses that occupy a stylist's time.
export const ACTIVE_BOOKING_STATUSES = [
  'BOOKED',
  'CHECKED_IN',
  'IN_SERVICE',
] as const satisfies readonly BookingStatus[];

export const BOOKING_SOURCES = ['ONLINE', 'WALK_IN', 'PHONE'] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export const PAYMENT_METHODS = ['CASH', 'CARD', 'UPI', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
