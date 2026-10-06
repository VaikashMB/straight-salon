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
