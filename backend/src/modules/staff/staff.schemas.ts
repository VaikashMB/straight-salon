import { registry } from '../../docs/registry.js';
import { z } from '../../docs/zod.js';
import {
  dateSchema,
  dateTimeSchema,
  dayOfWeekSchema,
  localTimeSchema,
  objectIdSchema,
  oneEntryPerWeekday,
  queryFlagSchema,
} from '../../shared/http/schemas.js';
import { ServiceSchema } from '../catalog/catalog.schemas.js';

// Staff, schedules, time-off (04 §3 API-030..037, FR-020, FR-023, FR-024)

const MAX_TIME_OFF_DAYS = 366;

const photoUrlSchema = z
  .url({ protocol: /^https?$/, error: 'Must be an http(s) URL, e.g. from POST /uploads/images' })
  .max(500)
  .openapi({ example: 'http://localhost:4000/uploads/images/1c2d3e4f.webp' });

const serviceIdsSchema = z
  .array(objectIdSchema)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, { error: 'Duplicate service ids' })
  .openapi({ description: 'Services this stylist can perform' });

const staffExample = {
  id: '6712c0f9a1b2c3d4e5f60601',
  displayName: 'Ravi',
  bio: 'Precision cuts and beard styling, 8 years.',
  serviceIds: ['6712c0f9a1b2c3d4e5f60501'],
  ratingAvg: 4.8,
  ratingCount: 31,
};

const staffShape = {
  id: objectIdSchema,
  displayName: z.string(),
  bio: z.string().optional(),
  photoUrl: z.string().optional(),
  serviceIds: z.array(objectIdSchema),
  ratingAvg: z.number(),
  ratingCount: z.number().int(),
  // Admin view only (includeInactive=true on the list, or any ADMIN read of a profile)
  userId: objectIdSchema.optional().openapi({ description: 'ADMIN view only' }),
  isActive: z.boolean().optional().openapi({ description: 'ADMIN view only' }),
};

export const StaffSchema = registry.register(
  'Staff',
  z.object(staffShape).openapi({ example: staffExample }),
);

export const StaffListSchema = registry.register('StaffList', z.array(StaffSchema));

export const StaffProfileSchema = registry.register(
  'StaffProfile',
  z.object({ ...staffShape, services: z.array(ServiceSchema) }).openapi({
    description: 'Profile with the services the stylist performs (active ones for the public)',
  }),
);

export const ListStaffQuerySchema = z
  .object({
    serviceId: objectIdSchema
      .optional()
      .openapi({ description: 'Only stylists who perform this service' }),
    includeInactive: queryFlagSchema.optional().openapi({
      description:
        'ADMIN only: include deactivated stylists and admin fields (401/403 for anyone else)',
    }),
  })
  .strict();

export const CreateStaffBodySchema = z
  .object({
    userId: objectIdSchema.openapi({
      description: 'An active user with role STAFF and no profile yet',
    }),
    displayName: z.string().trim().min(2).max(60).openapi({ example: 'Ravi' }),
    bio: z.string().trim().max(500).optional(),
    photoUrl: photoUrlSchema.optional(),
    serviceIds: serviceIdsSchema,
  })
  .strict();

export const UpdateStaffBodySchema = z
  .object({
    displayName: z.string().trim().min(2).max(60).optional(),
    bio: z.string().trim().max(500).nullable().optional(),
    photoUrl: photoUrlSchema.nullable().optional(),
    serviceIds: serviceIdsSchema.optional(),
    isActive: z.boolean().optional(),
    force: z.boolean().optional().openapi({
      description:
        "With isActive: false, cancel the stylist's future active bookings and notify the customers instead of failing with ACTIVE_BOOKINGS_EXIST (BR-014)",
    }),
  })
  .strict()
  .refine((body) => Object.keys(body).some((key) => key !== 'force'), {
    error: 'Send at least one field to change',
  });

// ---- Schedules --------------------------------------------------------------------------------

const TimeRangeSchema = z
  .object({ start: localTimeSchema, end: localTimeSchema.openapi({ example: '19:00' }) })
  .strict()
  .refine((r) => r.start < r.end, { error: 'start must be before end', path: ['end'] });

export const ScheduleDaySchema = z
  .object({
    dayOfWeek: dayOfWeekSchema,
    isWorking: z.boolean(),
    start: localTimeSchema.openapi({ example: '10:00' }),
    end: localTimeSchema.openapi({ example: '19:00' }),
    breaks: z.array(TimeRangeSchema).max(5).default([]),
  })
  .strict()
  .superRefine((day, ctx) => {
    if (!day.isWorking) return;
    if (day.start >= day.end) {
      ctx.addIssue({ code: 'custom', path: ['end'], message: 'start must be before end' });
      return;
    }
    const breaks = [...day.breaks].sort((a, b) => a.start.localeCompare(b.start));
    breaks.forEach((b, i) => {
      if (b.start < day.start || b.end > day.end) {
        ctx.addIssue({
          code: 'custom',
          path: ['breaks'],
          message: 'Breaks must be within working hours',
        });
      }
      const previous = breaks[i - 1];
      if (previous && b.start < previous.end) {
        ctx.addIssue({ code: 'custom', path: ['breaks'], message: 'Breaks must not overlap' });
      }
    });
  });

const weeklyExample = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  isWorking: dayOfWeek !== 1,
  start: '10:00',
  end: '19:00',
  breaks: [{ start: '13:30', end: '14:15' }],
}));

export const ScheduleSchema = registry.register(
  'StaffSchedule',
  z
    .object({
      staffId: objectIdSchema,
      weekly: z.array(
        z.object({
          dayOfWeek: z.number().int(),
          isWorking: z.boolean(),
          start: z.string(),
          end: z.string(),
          breaks: z.array(z.object({ start: z.string(), end: z.string() })),
        }),
      ),
    })
    .openapi({ example: { staffId: '6712c0f9a1b2c3d4e5f60601', weekly: weeklyExample } }),
);

export const PutScheduleBodySchema = z
  .object({
    weekly: z
      .array(ScheduleDaySchema)
      .refine(oneEntryPerWeekday, { error: 'Send exactly 7 entries, one per dayOfWeek 0-6' }),
  })
  .strict()
  .openapi({ example: { weekly: weeklyExample } });

// ---- Time-off ---------------------------------------------------------------------------------

export const TimeOffSchema = registry.register(
  'TimeOff',
  z
    .object({
      id: objectIdSchema,
      staffId: objectIdSchema,
      startAt: z.string(),
      endAt: z.string(),
      reason: z.string().optional(),
      createdBy: objectIdSchema,
      createdAt: z.string(),
    })
    .openapi({
      example: {
        id: '6712c0f9a1b2c3d4e5f60701',
        staffId: '6712c0f9a1b2c3d4e5f60601',
        startAt: '2026-10-14T08:30:00.000Z',
        endAt: '2026-10-14T10:30:00.000Z',
        reason: 'Doctor appointment',
        createdBy: '6712c0f9a1b2c3d4e5f60111',
        createdAt: '2026-10-06T09:12:44.000Z',
      },
    }),
);

export const TimeOffListSchema = registry.register('TimeOffList', z.array(TimeOffSchema));

export const ListTimeOffQuerySchema = z
  .object({
    from: dateSchema.optional().openapi({ description: 'First salon-local date, inclusive' }),
    to: dateSchema
      .optional()
      .openapi({ description: 'Last salon-local date, inclusive', example: '2026-10-31' }),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    error: 'from must not be after to',
    path: ['to'],
  });

export const CreateTimeOffBodySchema = z
  .object({
    startAt: dateTimeSchema,
    endAt: dateTimeSchema.openapi({ example: '2026-10-12T07:30:00.000Z' }),
    reason: z.string().trim().max(200).optional().openapi({ example: 'Doctor appointment' }),
    force: z.boolean().optional().openapi({
      description:
        'ADMIN only: cancel overlapping active bookings and notify the customers instead of failing with ACTIVE_BOOKINGS_EXIST (FR-024)',
    }),
  })
  .strict()
  .superRefine((body, ctx) => {
    const span = Date.parse(body.endAt) - Date.parse(body.startAt);
    if (span <= 0)
      ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'endAt must be after startAt' });
    if (span > MAX_TIME_OFF_DAYS * 86_400_000)
      ctx.addIssue({
        code: 'custom',
        path: ['endAt'],
        message: `At most ${MAX_TIME_OFF_DAYS} days at a time`,
      });
  });

export const TimeOffParamsSchema = z
  .object({ id: objectIdSchema, timeOffId: objectIdSchema })
  .strict();

export type StaffDto = z.infer<typeof StaffSchema>;
export type StaffProfileDto = z.infer<typeof StaffProfileSchema>;
export type ListStaffQuery = z.infer<typeof ListStaffQuerySchema>;
export type CreateStaffBody = z.infer<typeof CreateStaffBodySchema>;
export type UpdateStaffBody = z.infer<typeof UpdateStaffBodySchema>;
export type ScheduleDto = z.infer<typeof ScheduleSchema>;
export type PutScheduleBody = z.infer<typeof PutScheduleBodySchema>;
export type TimeOffDto = z.infer<typeof TimeOffSchema>;
export type ListTimeOffQuery = z.infer<typeof ListTimeOffQuerySchema>;
export type CreateTimeOffBody = z.infer<typeof CreateTimeOffBodySchema>;
