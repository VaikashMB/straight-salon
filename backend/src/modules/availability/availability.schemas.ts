import { registry } from '../../docs/registry.js';
import { z } from '../../docs/zod.js';
import { dateSchema, objectIdSchema } from '../../shared/http/schemas.js';

// Availability (04 §3 API-040..041, 03 §5.2)

export const MAX_DAYS_RANGE = 31;

// "a,b,c" in the query string -> 1..5 distinct ids (BR-008).
const serviceIdsQuery = z
  .string()
  .transform((value) => value.split(',').map((id) => id.trim()))
  .pipe(
    z
      .array(objectIdSchema)
      .min(1)
      .max(5)
      .refine((ids) => new Set(ids).size === ids.length, { error: 'Duplicate services' }),
  )
  .openapi({
    type: 'string',
    description: 'Comma-separated service ids (1-5)',
    example: '6712c0f9a1b2c3d4e5f60501,6712c0f9a1b2c3d4e5f60502',
  });

const staffQuery = z
  .union([z.literal('any'), objectIdSchema])
  .default('any')
  .openapi({ description: 'A stylist id or "any"', example: 'any' });

export const AvailabilityQuerySchema = z
  .object({ serviceIds: serviceIdsQuery, staffId: staffQuery, date: dateSchema })
  .strict();

export const AvailableDaysQuerySchema = z
  .object({
    serviceIds: serviceIdsQuery,
    staffId: staffQuery,
    from: dateSchema,
    to: dateSchema.openapi({ example: '2026-11-10' }),
  })
  .strict()
  .superRefine((q, ctx) => {
    const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000;
    if (days < 0)
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'from must not be after to' });
    if (days >= MAX_DAYS_RANGE)
      ctx.addIssue({ code: 'custom', path: ['to'], message: `At most ${MAX_DAYS_RANGE} days` });
  });

export const AvailabilitySchema = registry.register(
  'Availability',
  z
    .object({
      date: z.string(),
      timezone: z.string(),
      slots: z.array(z.object({ startAt: z.string(), staffIds: z.array(objectIdSchema) })),
    })
    .openapi({
      example: {
        date: '2026-10-12',
        timezone: 'Asia/Kolkata',
        slots: [
          { startAt: '2026-10-12T05:30:00.000Z', staffIds: ['6712c0f9a1b2c3d4e5f60601'] },
          {
            startAt: '2026-10-12T05:45:00.000Z',
            staffIds: ['6712c0f9a1b2c3d4e5f60601', '6712c0f9a1b2c3d4e5f60602'],
          },
        ],
      },
    }),
);

export const AvailableDaysSchema = registry.register(
  'AvailableDays',
  z
    .object({
      from: z.string(),
      to: z.string(),
      timezone: z.string(),
      availableDates: z.array(z.string()).openapi({ description: 'Dates with at least one slot' }),
    })
    .openapi({
      example: {
        from: '2026-10-12',
        to: '2026-10-18',
        timezone: 'Asia/Kolkata',
        availableDates: ['2026-10-12', '2026-10-13', '2026-10-15'],
      },
    }),
);

export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;
export type AvailableDaysQuery = z.infer<typeof AvailableDaysQuerySchema>;
export type AvailabilityDto = z.infer<typeof AvailabilitySchema>;
export type AvailableDaysDto = z.infer<typeof AvailableDaysSchema>;
