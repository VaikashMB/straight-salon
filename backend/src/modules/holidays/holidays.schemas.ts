import { registry } from '../../docs/registry.js';
import { z } from '../../docs/zod.js';
import { dateSchema, objectIdSchema } from '../../shared/http/schemas.js';

// Holidays (04 §3 API-019..020, FR-022)

export const HolidaySchema = registry.register(
  'Holiday',
  z.object({ id: objectIdSchema, date: z.string(), name: z.string() }).openapi({
    example: { id: '6712c0f9a1b2c3d4e5f60301', date: '2026-11-01', name: 'Kannada Rajyotsava' },
  }),
);

export const HolidayListSchema = registry.register('HolidayList', z.array(HolidaySchema));

export const ListHolidaysQuerySchema = z
  .object({
    from: dateSchema.optional().openapi({ description: 'First date, inclusive' }),
    to: dateSchema
      .optional()
      .openapi({ description: 'Last date, inclusive', example: '2026-12-31' }),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    error: 'from must not be after to',
    path: ['to'],
  });

export const CreateHolidayBodySchema = z
  .object({
    date: dateSchema,
    name: z.string().trim().min(2).max(100).openapi({ example: 'Diwali' }),
    force: z.boolean().optional().openapi({
      description:
        'Cancel the active bookings on that date and notify the customers instead of failing with ACTIVE_BOOKINGS_EXIST',
    }),
  })
  .strict();

export type HolidayDto = z.infer<typeof HolidaySchema>;
export type ListHolidaysQuery = z.infer<typeof ListHolidaysQuerySchema>;
export type CreateHolidayBody = z.infer<typeof CreateHolidayBodySchema>;
