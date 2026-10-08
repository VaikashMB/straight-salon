import { z } from 'zod';
import { BOOKING_SOURCES, BOOKING_STATUSES, PAYMENT_METHODS } from '../../config/constants.js';

// Event catalogue (09-events §3): one Zod payload schema per event type. Publishing an event
// whose payload does not match throws. Payloads carry IDs and the minimum consumers need;
// consumers re-fetch fresh data. Never passwords or tokens (secrets go in the encrypted
// envelope field `secret`, 09 §7).

const id = z.string().regex(/^[a-f\d]{24}$/i, 'Must be an ObjectId hex string');
const isoDate = z.iso.datetime({ offset: true });
const day = z.iso.date(); // YYYY-MM-DD, salon timezone

export const eventPayloadSchemas = {
  // EVT-001
  'user.registered': z.object({ userId: id }),
  // EVT-002 (raw reset token travels encrypted in the envelope `secret`)
  'user.password_reset_requested': z.object({ userId: id }),
  // EVT-010
  'booking.created': z.object({
    bookingId: id,
    customerId: id,
    staffId: id,
    startAt: isoDate,
    endAt: isoDate,
    source: z.enum(BOOKING_SOURCES),
  }),
  // EVT-011
  'booking.rescheduled': z.object({
    bookingId: id,
    from: z.object({ startAt: isoDate, staffId: id }),
    to: z.object({ startAt: isoDate, staffId: id }),
  }),
  // EVT-012
  'booking.cancelled': z.object({
    bookingId: id,
    staffId: id,
    startAt: isoDate,
    cancelledBy: z.string(),
    reason: z.string().max(500).optional(),
  }),
  // EVT-013
  'booking.status_changed': z.object({
    bookingId: id,
    from: z.enum(BOOKING_STATUSES),
    to: z.enum(BOOKING_STATUSES),
  }),
  // EVT-014
  'booking.completed': z.object({
    bookingId: id,
    staffId: id,
    serviceIds: z.array(id).min(1),
    totalPriceMinor: z.number().int().nonnegative(),
  }),
  // EVT-015
  'booking.no_show': z.object({ bookingId: id, staffId: id }),
  // EVT-016
  'booking.payment_recorded': z.object({
    bookingId: id,
    amountPaidMinor: z.number().int().nonnegative(),
    method: z.enum(PAYMENT_METHODS),
  }),
  // EVT-017
  'booking.reminder_due': z.object({
    bookingId: id,
    customerId: id,
    startAt: isoDate,
    window: z.enum(['24h', '2h']),
  }),
  // EVT-020
  'review.created': z.object({
    reviewId: id,
    staffId: id,
    serviceIds: z.array(id),
    rating: z.number().int().min(1).max(5),
  }),
  // EVT-021
  'review.visibility_changed': z.object({ reviewId: id, isHidden: z.boolean() }),
  // EVT-030
  'staff.updated': z.object({ staffId: id, affectedDates: z.array(day) }),
  'staff.schedule_changed': z.object({ staffId: id, affectedDates: z.array(day) }),
  'staff.timeoff_changed': z.object({ staffId: id, affectedDates: z.array(day) }),
  // EVT-031
  'catalog.changed': z.object({ entityType: z.enum(['category', 'service']), entityId: id }),
  // EVT-032
  'settings.changed': z.object({ changedKeys: z.array(z.string()).min(1) }),
  // EVT-033
  'holiday.changed': z.object({ date: day }),
} as const;

export type EventType = keyof typeof eventPayloadSchemas;
export type EventPayload<T extends EventType> = z.infer<(typeof eventPayloadSchemas)[T]>;

export const EVENT_TYPES = Object.keys(eventPayloadSchemas) as EventType[];

export function isEventType(value: string): value is EventType {
  return Object.hasOwn(eventPayloadSchemas, value);
}

export class InvalidEventPayloadError extends Error {
  constructor(
    readonly eventType: string,
    readonly issues: { path: string; message: string }[],
  ) {
    const details = issues.map((i) => `${i.path} ${i.message}`).join('; ');
    super(`Invalid payload for event "${eventType}": ${details}`);
    this.name = 'InvalidEventPayloadError';
  }
}

export function parseEventPayload<T extends EventType>(type: T, payload: unknown): EventPayload<T> {
  const result = eventPayloadSchemas[type].safeParse(payload);
  if (!result.success) {
    throw new InvalidEventPayloadError(
      type,
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data as EventPayload<T>;
}
