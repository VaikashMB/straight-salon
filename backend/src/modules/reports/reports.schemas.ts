import { BOOKING_STATUSES, type BookingStatus } from '../../config/constants.js';
import { MoneySchema, registry } from '../../docs/registry.js';
import { z } from '../../docs/zod.js';
import { dateSchema, dateTimeSchema, objectIdSchema } from '../../shared/http/schemas.js';
import { BookingStatusSchema } from '../bookings/bookings.schemas.js';

// Reports (04 §3 API-070..072, FR-070..072)

export const MAX_REPORT_DAYS = 366;
const DAY_MS = 86_400_000;

// ---- API-070 dashboard -------------------------------------------------------------------------

export const DashboardQuerySchema = z
  .object({
    date: dateSchema.optional().openapi({ description: 'Salon-local date; default today' }),
  })
  .strict();

const countsShape = Object.fromEntries(
  BOOKING_STATUSES.map((status) => [status, z.number().int()]),
) as Record<BookingStatus, z.ZodNumber>;

const timelineBooking = z.object({
  id: objectIdSchema,
  bookingRef: z.string(),
  status: BookingStatusSchema,
  startAt: dateTimeSchema,
  endAt: dateTimeSchema,
  customerName: z.string(),
  services: z.array(z.string()),
});

export const DashboardSchema = registry.register(
  'Dashboard',
  z
    .object({
      date: dateSchema,
      timezone: z.string(),
      generatedAt: dateTimeSchema,
      counts: z.object(countsShape).openapi({ description: 'Bookings that day by status' }),
      totals: z.object({
        bookings: z.number().int(),
        revenue: MoneySchema.openapi({ description: 'Payments recorded for that day so far' }),
      }),
      staff: z
        .array(
          z.object({
            staffId: objectIdSchema,
            displayName: z.string(),
            bookings: z.array(timelineBooking),
          }),
        )
        .openapi({
          description:
            'Per-stylist timeline: active stylists and anyone with bookings that day, by name; cancelled bookings are left out',
        }),
    })
    .openapi({
      example: {
        date: '2026-10-12',
        timezone: 'Asia/Kolkata',
        generatedAt: '2026-10-12T06:00:00.000Z',
        counts: {
          BOOKED: 6,
          CHECKED_IN: 1,
          IN_SERVICE: 1,
          COMPLETED: 3,
          CANCELLED: 1,
          NO_SHOW: 0,
        },
        totals: { bookings: 12, revenue: { amountMinor: 135000, currency: 'INR' } },
        staff: [
          {
            staffId: '6712c0f9a1b2c3d4e5f60601',
            displayName: 'Ravi',
            bookings: [
              {
                id: '6712c0f9a1b2c3d4e5f60789',
                bookingRef: 'SS-261012-7KQ2',
                status: 'COMPLETED',
                startAt: '2026-10-12T05:30:00.000Z',
                endAt: '2026-10-12T06:30:00.000Z',
                customerName: 'Ananya Rao',
                services: ['Haircut', 'Beard Trim'],
              },
            ],
          },
        ],
      },
    }),
);

// ---- API-071 / 072 summary ---------------------------------------------------------------------

export const SummaryQuerySchema = z
  .object({ from: dateSchema, to: dateSchema })
  .strict()
  .refine((q) => q.from <= q.to, { error: 'from must not be after to', path: ['to'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / DAY_MS + 1 <= MAX_REPORT_DAYS, {
    error: `At most ${MAX_REPORT_DAYS} days`,
    path: ['to'],
  });

const totals = {
  bookings: z.number().int().openapi({ description: 'All bookings, any status' }),
  completed: z.number().int(),
  cancelled: z.number().int(),
  noShows: z.number().int(),
  noShowRate: z.number().openapi({ description: 'noShows / (bookings - cancelled), 0..1' }),
  revenue: MoneySchema,
  bookedMinutes: z
    .number()
    .int()
    .openapi({ description: 'Completed and still-active bookings (not cancelled or no-show)' }),
  availableMinutes: z.number().int(),
  utilisation: z.number().openapi({ description: 'bookedMinutes / availableMinutes, 0..1' }),
};

const TotalsSchema = z.object(totals);

export const ReportSummarySchema = registry.register(
  'ReportSummary',
  z
    .object({
      from: dateSchema,
      to: dateSchema,
      timezone: z.string(),
      totals: TotalsSchema,
      byDay: z.array(z.object({ date: dateSchema, ...totals })),
      byService: z
        .array(
          z.object({
            serviceId: objectIdSchema,
            name: z.string(),
            count: z.number().int().openapi({ description: 'Completed bookings with it' }),
            revenue: MoneySchema.openapi({
              description: 'Payments split across services by price',
            }),
          }),
        )
        .openapi({ description: 'By revenue, highest first' }),
      byStaff: z.array(z.object({ staffId: objectIdSchema, displayName: z.string(), ...totals })),
    })
    .openapi({
      description:
        'Totals and breakdowns for bookings whose appointment date (salon timezone) is in the range (FR-071). Built from daily_stats.',
      example: {
        from: '2026-10-01',
        to: '2026-10-31',
        timezone: 'Asia/Kolkata',
        totals: {
          bookings: 120,
          completed: 98,
          cancelled: 12,
          noShows: 4,
          noShowRate: 0.037,
          revenue: { amountMinor: 6_540_000, currency: 'INR' },
          bookedMinutes: 5_400,
          availableMinutes: 9_600,
          utilisation: 0.5625,
        },
        byDay: [],
        byService: [
          {
            serviceId: '6712c0f9a1b2c3d4e5f60501',
            name: 'Haircut',
            count: 40,
            revenue: { amountMinor: 1_600_000, currency: 'INR' },
          },
        ],
        byStaff: [],
      },
    }),
);

export const ReportCsvSchema = z.string().openapi({
  description:
    'One table: section (total | day | staff | service), key (date, staffId or serviceId), name, then the totals columns; money in minor units',
  example:
    'section,key,name,bookings,completed,cancelled,no_shows,no_show_rate,revenue_minor,currency,booked_minutes,available_minutes,utilisation\r\ntotal,,,120,98,12,4,0.037,6540000,INR,5400,9600,0.5625\r\n',
});

export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;
export type DashboardDto = z.infer<typeof DashboardSchema>;
export type SummaryQuery = z.infer<typeof SummaryQuerySchema>;
export type ReportSummaryDto = z.infer<typeof ReportSummarySchema>;
export type ReportTotals = z.infer<typeof TotalsSchema>;
