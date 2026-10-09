import {
  Ban,
  CalendarClock,
  CircleCheck,
  Scissors,
  UserCheck,
  UserX,
  type LucideIcon,
} from 'lucide-react';
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

// Status icons sit next to the label (decorative, aria-hidden): text stays the indicator.
export const STATUS_ICON: Record<BookingStatus, LucideIcon> = {
  BOOKED: CalendarClock,
  CHECKED_IN: UserCheck,
  IN_SERVICE: Scissors,
  COMPLETED: CircleCheck,
  CANCELLED: Ban,
  NO_SHOW: UserX,
};

// The status hue as a left edge (booking cards and calendar blocks) and as a dot or fill
// (timelines). Always paired with the status text or icon.
export const STATUS_EDGE: Record<BookingStatus, string> = {
  BOOKED: 'border-l-sky-600',
  CHECKED_IN: 'border-l-accent',
  IN_SERVICE: 'border-l-warning',
  COMPLETED: 'border-l-success',
  CANCELLED: 'border-l-muted-foreground/50',
  NO_SHOW: 'border-l-destructive',
};

// Soft fill for booking blocks (calendar, dashboard timelines); STATUS_EDGE carries the full hue.
export const STATUS_TINT: Record<BookingStatus, string> = {
  BOOKED: 'bg-sky-50 dark:bg-sky-950/60',
  CHECKED_IN: 'bg-accent-soft',
  IN_SERVICE: 'bg-amber-50 dark:bg-amber-950/50',
  COMPLETED: 'bg-green-50 dark:bg-green-950/50',
  CANCELLED: 'bg-muted',
  NO_SHOW: 'bg-red-50 dark:bg-red-950/50',
};

export const STATUS_DOT: Record<BookingStatus, string> = {
  BOOKED: 'bg-sky-600/80',
  CHECKED_IN: 'bg-accent',
  IN_SERVICE: 'bg-warning',
  COMPLETED: 'bg-success',
  CANCELLED: 'bg-muted-foreground',
  NO_SHOW: 'bg-destructive',
};

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
