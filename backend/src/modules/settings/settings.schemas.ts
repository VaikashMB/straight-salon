import { registry } from '../../docs/registry.js';
import { z } from '../../docs/zod.js';
import {
  dateTimeSchema,
  dayOfWeekSchema,
  emailSchema,
  localTimeSchema,
  oneEntryPerWeekday,
  phoneSchema,
} from '../../shared/http/schemas.js';
import { isValidTimeZone } from '../../shared/time/tz.js';

// Settings (04 §3 API-016..018, FR-080, 02 §2.10)

const minutes = (max: number, example: number) =>
  z.number().int().min(0).max(max).openapi({ example });

export const BusinessHoursSchema = z
  .object({
    dayOfWeek: dayOfWeekSchema,
    isOpen: z.boolean(),
    open: localTimeSchema,
    close: localTimeSchema.openapi({ example: '20:30' }),
  })
  .strict()
  .refine((day) => !day.isOpen || day.open < day.close, {
    error: 'open must be before close',
    path: ['close'],
  });

const businessHoursList = z
  .array(BusinessHoursSchema)
  .refine(oneEntryPerWeekday, { error: 'Send exactly 7 entries, one per dayOfWeek 0-6' });

const timezoneSchema = z
  .string()
  .refine(isValidTimeZone, { error: 'Must be an IANA timezone such as Asia/Kolkata' })
  .openapi({ example: 'Asia/Kolkata' });

const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Must be an ISO 4217 code such as INR')
  .refine((code) => Intl.supportedValuesOf('currency').includes(code), {
    error: 'Unknown ISO 4217 currency',
  })
  .openapi({ example: 'INR' });

// Booking policy shown publicly (decision 2026-10-06, 04 API-016): the booking wizard needs
// the calendar window and slot step, and customers see the cancellation cut-off.
const publicPolicy = {
  slotGranularityMin: z.number().int().openapi({ example: 15 }),
  minLeadTimeMin: z.number().int().openapi({ example: 60 }),
  maxAdvanceDays: z.number().int().openapi({ example: 30 }),
  cancellationCutoffMin: z.number().int().openapi({ example: 120 }),
};

const hoursExample = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  isOpen: dayOfWeek !== 1,
  open: '09:30',
  close: '20:30',
}));

const contactExample = {
  name: 'Straight Salon',
  address: '12 MG Road, Bengaluru',
  phone: '+918041234567',
  email: 'hello@straightsalon.in',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  businessHours: hoursExample,
};

const policyExample = {
  slotGranularityMin: 15,
  minLeadTimeMin: 60,
  maxAdvanceDays: 30,
  cancellationCutoffMin: 120,
};

const otherRulesExample = { bufferMin: 0, noShowGraceMin: 30, reviewWindowDays: 14 };

const BusinessHoursOut = z.object({
  dayOfWeek: z.number().int(),
  isOpen: z.boolean(),
  open: z.string(),
  close: z.string(),
});

export const PublicSettingsSchema = registry.register(
  'PublicSettings',
  z
    .object({
      name: z.string(),
      address: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      timezone: z.string(),
      currency: z.string(),
      businessHours: z.array(BusinessHoursOut),
      ...publicPolicy,
    })
    .openapi({ example: { ...contactExample, ...policyExample } }),
);

export const SettingsSchema = registry.register(
  'Settings',
  PublicSettingsSchema.extend({
    bufferMin: z.number().int(),
    noShowGraceMin: z.number().int(),
    reviewWindowDays: z.number().int(),
    updatedAt: dateTimeSchema.optional().openapi({
      description: 'Absent until an admin first saves settings (defaults are served)',
    }),
  }).openapi({
    example: {
      ...contactExample,
      ...policyExample,
      ...otherRulesExample,
      updatedAt: '2026-10-06T09:12:44.000Z',
    },
  }),
);

// API-018: full replacement of every FR-080 field.
export const UpdateSettingsBodySchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    address: z.string().trim().min(1).max(300).optional(),
    phone: phoneSchema.optional(),
    email: emailSchema.optional(),
    timezone: timezoneSchema,
    currency: currencySchema,
    businessHours: businessHoursList,
    slotGranularityMin: z
      .number()
      .int()
      .min(5)
      .max(60)
      .refine((value) => 60 % value === 0, {
        error: 'Must divide an hour evenly (5, 10, 15, 20, 30 or 60)',
      })
      .openapi({ example: 15 }),
    bufferMin: minutes(120, 0),
    minLeadTimeMin: minutes(7 * 24 * 60, 60),
    maxAdvanceDays: z.number().int().min(1).max(365).openapi({ example: 30 }),
    cancellationCutoffMin: minutes(7 * 24 * 60, 120),
    noShowGraceMin: minutes(240, 30),
    reviewWindowDays: z.number().int().min(1).max(365).openapi({ example: 14 }),
  })
  .strict()
  .openapi({ example: { ...contactExample, ...policyExample, ...otherRulesExample } });

export type PublicSettingsDto = z.infer<typeof PublicSettingsSchema>;
export type SettingsDto = z.infer<typeof SettingsSchema>;
export type UpdateSettingsBody = z.infer<typeof UpdateSettingsBodySchema>;
