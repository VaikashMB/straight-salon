import type { EventType } from './registry.js';

// Which consumer receives which events (09 §5). Static so the publishing process (relay) can
// fan out to one queue per consumer without knowing which worker process runs the consumer.
export const CONSUMER_SUBSCRIPTIONS = {
  notifications: [
    'user.registered',
    'user.password_reset_requested',
    'booking.created',
    'booking.rescheduled',
    'booking.cancelled',
    'booking.no_show',
    'booking.completed',
    'booking.reminder_due',
  ],
  'staff-notifications': ['booking.created', 'booking.rescheduled', 'booking.cancelled'],
  'cache-invalidation': [
    'booking.created',
    'booking.rescheduled',
    'booking.cancelled',
    'booking.status_changed',
    'booking.completed',
    'booking.no_show',
    'booking.payment_recorded',
    'staff.updated',
    'staff.schedule_changed',
    'staff.timeoff_changed',
    'catalog.changed',
    'settings.changed',
    'holiday.changed',
    'review.created',
    'review.visibility_changed',
  ],
  ratings: ['review.created', 'review.visibility_changed'],
  stats: [
    'booking.created',
    'booking.rescheduled',
    'booking.cancelled',
    'booking.completed',
    'booking.no_show',
    'booking.payment_recorded',
  ],
} as const satisfies Record<string, readonly EventType[]>;

export type ConsumerName = keyof typeof CONSUMER_SUBSCRIPTIONS;

// Default per-consumer concurrency (09 §5 queue settings).
export const CONSUMER_CONCURRENCY: Record<ConsumerName, number> = {
  notifications: 5,
  'staff-notifications': 10,
  'cache-invalidation': 10,
  ratings: 10,
  stats: 10,
};

export function consumersFor(
  type: EventType,
  subscriptions: Record<string, readonly EventType[]> = CONSUMER_SUBSCRIPTIONS,
): string[] {
  return Object.entries(subscriptions)
    .filter(([, types]) => types.includes(type))
    .map(([consumer]) => consumer);
}
