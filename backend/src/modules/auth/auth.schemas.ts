import { registry } from '../../docs/registry.js';
import { z } from '../../docs/zod.js';
import { passwordSchema } from '../../shared/auth/password.js';
import { emailSchema, personNameSchema, phoneSchema } from '../../shared/http/schemas.js';
import { UserSchema } from '../users/users.schemas.js';

// API-001
export const RegisterBodySchema = z
  .object({
    name: personNameSchema,
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
  })
  .strict();

// API-002. Login does not apply the full password policy: old passwords must still work.
export const LoginBodySchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(200).openapi({ format: 'password', example: 'Fade-and-Trim7' }),
  })
  .strict();

// API-006
export const ForgotPasswordBodySchema = z.object({ email: emailSchema }).strict();

// API-007
export const ResetPasswordBodySchema = z
  .object({
    token: z.string().min(20).max(200).openapi({ description: 'From the emailed reset link' }),
    newPassword: passwordSchema,
  })
  .strict();

// API-008
export const ChangePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1).max(200).openapi({ format: 'password' }),
    newPassword: passwordSchema,
  })
  .strict()
  .refine((body) => body.currentPassword !== body.newPassword, {
    path: ['newPassword'],
    error: 'Must differ from the current password',
  });

export const SessionResponseSchema = registry.register(
  'Session',
  z.object({
    user: UserSchema,
    accessToken: z
      .string()
      .openapi({ description: 'JWT, 15 minutes. Keep in memory only (05 §5).' }),
  }),
);

export const AccessTokenResponseSchema = registry.register(
  'AccessToken',
  z.object({ accessToken: z.string() }),
);

export type RegisterBody = z.infer<typeof RegisterBodySchema>;
export type LoginBody = z.infer<typeof LoginBodySchema>;
export type ForgotPasswordBody = z.infer<typeof ForgotPasswordBodySchema>;
export type ResetPasswordBody = z.infer<typeof ResetPasswordBodySchema>;
export type ChangePasswordBody = z.infer<typeof ChangePasswordBodySchema>;
