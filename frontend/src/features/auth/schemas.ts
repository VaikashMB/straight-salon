import { z } from 'zod';
import { publicEnv } from '@/lib/env';
import { E164, normalisePhone } from '@/lib/phone';

// Client-side checks mirroring the API (06 §4 password policy, 02 §2.1 fields), so most
// mistakes are caught inline; the server stays authoritative (common passwords, duplicates).

const MAX_PASSWORD_BYTES = 72; // bcrypt ignores the rest

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Enter your email address')
  .max(254)
  .pipe(z.email('Enter a valid email address'))
  .transform((value) => value.toLowerCase());

export const newPasswordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
    error: 'Use at least one letter and one number',
  })
  .refine((value) => new TextEncoder().encode(value).length <= MAX_PASSWORD_BYTES, {
    error: 'That password is too long',
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
});

export function phoneSchema(countryCode = publicEnv.defaultCountryCode) {
  return z
    .string()
    .min(1, 'Enter your mobile number')
    .transform((value) => normalisePhone(value, countryCode))
    .refine((value) => E164.test(value), { error: 'Enter a valid mobile number' });
}

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(80, 'Use at most 80 characters'),
  email: emailSchema,
  phone: phoneSchema(),
  password: newPasswordSchema,
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ newPassword: newPasswordSchema, confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, {
    error: "The passwords don't match",
    path: ['confirmPassword'],
  });

export type LoginValues = z.input<typeof loginSchema>;
export type RegisterValues = z.input<typeof registerSchema>;
export type ForgotPasswordValues = z.input<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.input<typeof resetPasswordSchema>;
