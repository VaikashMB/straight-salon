import type { Schemas } from '@/lib/api/client';

// Booking lifecycle in the UI (FR-040, BR-010). The API enforces the graph; this decides which
// buttons to offer, so people only see actions that can succeed.

export type BookingStatus = Schemas['BookingStatus'];
export type StatusAction = 'CHECKED_IN' | 'IN_SERVICE' | 'COMPLETED' | 'NO_SHOW';

export const STATUS_LABEL: Record<BookingStatus, string> = {
  BOOKED: 'Booked',
  CHECKED_IN: 'Checked in',
  IN_SERVICE: 'In service',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

export const STATUS_VARIANT = {
  BOOKED: 'info',
  CHECKED_IN: 'accent',
  IN_SERVICE: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'secondary',
  NO_SHOW: 'destructive',
} as const satisfies Record<BookingStatus, string>;

export const ACTION_LABEL: Record<StatusAction, string> = {
  CHECKED_IN: 'Check in',
  IN_SERVICE: 'Start service',
  COMPLETED: 'Complete',
  NO_SHOW: 'Mark no-show',
};

export const ACTIVE_STATUSES: readonly BookingStatus[] = ['BOOKED', 'CHECKED_IN', 'IN_SERVICE'];

// The next valid status changes (API-056). NO_SHOW only once the start time has passed
// (decision 2026-10-07); before that the booking should be cancelled instead.
export function nextStatuses(
  booking: { status: BookingStatus; startAt: string },
  now: Date = new Date(),
): StatusAction[] {
  switch (booking.status) {
    case 'BOOKED':
      return new Date(booking.startAt) <= now ? ['CHECKED_IN', 'NO_SHOW'] : ['CHECKED_IN'];
    case 'CHECKED_IN':
      return ['IN_SERVICE'];
    case 'IN_SERVICE':
      return ['COMPLETED'];
    default:
      return [];
  }
}

export const firstName = (name: string): string => name.split(/\s+/)[0] ?? name;
