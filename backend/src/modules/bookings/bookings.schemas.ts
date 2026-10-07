import { BOOKING_SOURCES, BOOKING_STATUSES, PAYMENT_METHODS } from '../../config/constants.js';
import { MoneySchema, registry } from '../../docs/registry.js';
import { z } from '../../docs/zod.js';
import { paginationQuerySchema, PaginationMetaSchema } from '../../shared/http/pagination.js';
import { dateSchema, dateTimeSchema, objectIdSchema } from '../../shared/http/schemas.js';

// Bookings (04 §3 API-050..058, BR-001..015)

export const BookingStatusSchema = registry.register(
  'BookingStatus',
  z.enum(BOOKING_STATUSES).openapi({ example: 'BOOKED' }),
);
const SourceSchema = z.enum(BOOKING_SOURCES).openapi({ example: 'ONLINE' });
export const PaymentMethodSchema = z.enum(PAYMENT_METHODS).openapi({ example: 'UPI' });

const MAX_SERVICES = 5; // BR-008

// ---- Booking DTO ------------------------------------------------------------------------------

const bookingExample = {
  id: '6712c0f9a1b2c3d4e5f60789',
  bookingRef: 'SS-261012-7KQ2',
  status: 'BOOKED',
  startAt: '2026-10-12T05:30:00.000Z',
  endAt: '2026-10-12T06:30:00.000Z',
  customer: { id: '6712c0f9a1b2c3d4e5f60111', name: 'Ananya R', phone: '+919876543212' },
  staff: { id: '6712c0f9a1b2c3d4e5f60601', displayName: 'Ravi' },
  services: [
    {
      serviceId: '6712c0f9a1b2c3d4e5f60501',
      name: 'Haircut',
      durationMin: 45,
      price: { amountMinor: 40000, currency: 'INR' },
    },
    {
      serviceId: '6712c0f9a1b2c3d4e5f60502',
      name: 'Beard Trim',
      durationMin: 15,
      price: { amountMinor: 15000, currency: 'INR' },
    },
  ],
  total: { amountMinor: 55000, currency: 'INR' },
  source: 'ONLINE',
  payment: { status: 'UNPAID' },
  canCancel: true,
  canReschedule: true,
  createdAt: '2026-10-06T09:12:44.000Z',
};

export const BookingSchema = registry.register(
  'Booking',
  z
    .object({
      id: objectIdSchema,
      bookingRef: z.string(),
      status: BookingStatusSchema,
      startAt: z.string(),
      endAt: z.string(),
      customer: z.object({
        id: objectIdSchema,
        name: z.string().openapi({ description: 'First name only for STAFF viewers' }),
        phone: z.string().openapi({ description: 'Masked for STAFF viewers' }),
      }),
      staff: z.object({ id: objectIdSchema, displayName: z.string() }),
      services: z.array(
        z.object({
          serviceId: objectIdSchema,
          name: z.string(),
          durationMin: z.number().int(),
          price: MoneySchema,
        }),
      ),
      total: MoneySchema,
      source: SourceSchema,
      notes: z.string().optional(),
      payment: z.object({
        status: z.enum(['UNPAID', 'PAID']),
        method: PaymentMethodSchema.optional(),
        amountPaid: MoneySchema.optional(),
        discount: MoneySchema.optional(),
        discountReason: z.string().optional(),
        recordedAt: z.string().optional(),
      }),
      cancellation: z
        .object({ at: z.string(), reason: z.string().optional(), overridden: z.boolean() })
        .optional(),
      canCancel: z
        .boolean()
        .openapi({ description: 'For the current user (BR-006), server-computed' }),
      canReschedule: z.boolean(),
      createdAt: z.string(),
    })
    .openapi({ example: bookingExample }),
);

export const BookingListSchema = registry.register(
  'BookingList',
  z.object({ data: z.array(BookingSchema), meta: PaginationMetaSchema }),
);

// ---- Requests ---------------------------------------------------------------------------------

const serviceIdsSchema = z
  .array(objectIdSchema)
  .min(1)
  .max(MAX_SERVICES)
  .refine((ids) => new Set(ids).size === ids.length, { error: 'Duplicate services (BR-008)' })
  .openapi({ description: '1 to 5 different services (BR-008)' });

const staffChoice = z
  .union([z.literal('any'), objectIdSchema])
  .openapi({ description: 'A stylist id, or "any" (FR-033)', example: 'any' });

export const CreateBookingBodySchema = z
  .object({
    serviceIds: serviceIdsSchema,
    staffId: staffChoice,
    startAt: dateTimeSchema.optional().openapi({ description: 'Required unless checkInNow' }),
    notes: z.string().trim().max(300).optional(),
    customerId: objectIdSchema
      .optional()
      .openapi({ description: 'RECEPTIONIST/ADMIN only (required for them)' }),
    source: SourceSchema.optional().openapi({
      description:
        'RECEPTIONIST/ADMIN only. Default PHONE, or WALK_IN with checkInNow; customers always ONLINE',
    }),
    checkInNow: z.boolean().optional().openapi({
      description:
        'RECEPTIONIST/ADMIN only: walk-in starting at the current slot boundary or the next free aligned slot today, created CHECKED_IN (00 US-03)',
    }),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.checkInNow && body.startAt) {
      ctx.addIssue({ code: 'custom', path: ['startAt'], message: 'Omit startAt with checkInNow' });
    }
    if (!body.checkInNow && !body.startAt) {
      ctx.addIssue({ code: 'custom', path: ['startAt'], message: 'Required unless checkInNow' });
    }
  })
  .openapi({
    example: {
      serviceIds: ['6712c0f9a1b2c3d4e5f60501'],
      staffId: 'any',
      startAt: '2026-10-12T05:30:00.000Z',
    },
  });

export const MyBookingsQuerySchema = paginationQuerySchema
  .pick({ page: true, pageSize: true })
  .extend({ scope: z.enum(['upcoming', 'past']).default('upcoming') })
  .strict();

export const ListBookingsQuerySchema = paginationQuerySchema
  .extend({
    date: dateSchema.optional().openapi({ description: 'Salon-local appointment date' }),
    from: dateSchema.optional().openapi({ description: 'First salon-local date, inclusive' }),
    to: dateSchema
      .optional()
      .openapi({ description: 'Last salon-local date, inclusive', example: '2026-10-19' }),
    staffId: objectIdSchema
      .optional()
      .openapi({ description: 'Ignored for STAFF (always their own)' }),
    status: BookingStatusSchema.optional(),
    customerId: objectIdSchema.optional(),
    q: z.string().trim().min(3).max(30).optional().openapi({
      description: 'Booking reference prefix (SS-...) or customer phone prefix',
      example: 'SS-2610',
    }),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.date && (q.from || q.to)) {
      ctx.addIssue({ code: 'custom', path: ['date'], message: 'Use date or from/to, not both' });
    }
    if (q.from && q.to && q.from > q.to) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'from must not be after to' });
    }
  });

const overrideFields = {
  override: z.boolean().optional().openapi({
    description:
      'RECEPTIONIST/ADMIN: bypass the cancellation cut-off (BR-006); needs a reason; audited',
  }),
  reason: z.string().trim().min(1).max(500).optional(),
};
const reasonWithOverride = (body: {
  override?: boolean | undefined;
  reason?: string | undefined;
}) => !body.override || Boolean(body.reason);

export const RescheduleBodySchema = z
  .object({
    startAt: dateTimeSchema,
    staffId: objectIdSchema
      .optional()
      .openapi({ description: 'Move to another stylist; default the same one' }),
    ...overrideFields,
  })
  .strict()
  .refine(reasonWithOverride, { error: 'A reason is required with override', path: ['reason'] });

export const CancelBodySchema = z
  .object(overrideFields)
  .strict()
  .refine(reasonWithOverride, { error: 'A reason is required with override', path: ['reason'] });

export const StatusBodySchema = z
  .object({
    status: z.enum(['CHECKED_IN', 'IN_SERVICE', 'COMPLETED', 'NO_SHOW']),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export const BookingHistorySchema = registry.register(
  'BookingHistory',
  z.object({
    statusHistory: z.array(
      z.object({
        status: BookingStatusSchema,
        at: z.string(),
        by: z.string(),
        note: z.string().optional(),
      }),
    ),
    audit: z.array(
      z.object({
        at: z.string(),
        action: z.string().openapi({ example: 'booking.reschedule' }),
        actor: z.object({ id: z.string(), role: z.string() }),
        diff: z.array(z.string()),
        before: z.record(z.string(), z.unknown()).nullable(),
        after: z.record(z.string(), z.unknown()).nullable(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  }),
);

export type BookingDto = z.infer<typeof BookingSchema>;
export type CreateBookingBody = z.infer<typeof CreateBookingBodySchema>;
export type MyBookingsQuery = z.infer<typeof MyBookingsQuerySchema>;
export type ListBookingsQuery = z.infer<typeof ListBookingsQuerySchema>;
export type RescheduleBody = z.infer<typeof RescheduleBodySchema>;
export type CancelBody = z.infer<typeof CancelBodySchema>;
export type StatusBody = z.infer<typeof StatusBodySchema>;
export type BookingHistoryDto = z.infer<typeof BookingHistorySchema>;
