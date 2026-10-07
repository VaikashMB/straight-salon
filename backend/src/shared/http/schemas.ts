import { z } from '../../docs/zod.js';

// Field schemas shared by module request/response schemas.

export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Must be a 24-character hex id')
  .openapi({ example: '6712c0f9a1b2c3d4e5f60789' });

export const idParamsSchema = z.object({ id: objectIdSchema }).strict();

// E.164, e.g. +919876543212 (02 §2.1). The frontend normalises local input to this format.
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Must be an international number like +919876543212')
  .openapi({ example: '+919876543212' });

export const emailSchema = z
  .email('Must be a valid email address')
  .max(254)
  .transform((value) => value.trim().toLowerCase())
  .openapi({ example: 'ananya@example.com' });

export const personNameSchema = z.string().trim().min(2).max(80).openapi({ example: 'Ananya R' });

// Calendar date in the salon timezone (04 §1).
export const dateSchema = z.iso.date().openapi({ example: '2026-10-12' });

// UTC instant in requests and responses (04 §1).
export const dateTimeSchema = z.iso
  .datetime({ offset: true })
  .openapi({ example: '2026-10-12T05:30:00.000Z' });

// Wall-clock time in the salon timezone (02 §2.7, §2.10).
export const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be a 24-hour time like 09:30')
  .openapi({ example: '09:30' });

export const dayOfWeekSchema = z
  .number()
  .int()
  .min(0)
  .max(6)
  .openapi({ description: '0 = Sunday … 6 = Saturday', example: 1 });

// "true"/"false" query flags.
export const queryFlagSchema = z.stringbool();

// Validates 7 entries, one per weekday; used by business hours and staff schedules.
export function oneEntryPerWeekday(entries: { dayOfWeek: number }[]): boolean {
  return entries.length === 7 && new Set(entries.map((e) => e.dayOfWeek)).size === 7;
}
