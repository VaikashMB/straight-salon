import { ROLES } from '../../config/constants.js';
import { registry } from '../../docs/registry.js';
import { z } from '../../docs/zod.js';
import { paginationQuerySchema, PaginationMetaSchema } from '../../shared/http/pagination.js';
import {
  emailSchema,
  objectIdSchema,
  personNameSchema,
  phoneSchema,
} from '../../shared/http/schemas.js';
import { passwordSchema } from '../../shared/auth/password.js';

export const RoleSchema = registry.register('Role', z.enum(ROLES).openapi({ example: 'CUSTOMER' }));

const STAFF_ROLES = ['STAFF', 'RECEPTIONIST', 'ADMIN'] as const;

export const PreferencesSchema = z
  .object({
    preferredStaffId: objectIdSchema.nullable().optional(),
    smsOptIn: z.boolean().optional(),
    emailOptIn: z.boolean().optional(),
  })
  .strict();

export const UserSchema = registry.register(
  'User',
  z
    .object({
      id: objectIdSchema,
      name: z.string(),
      email: z.string().optional(),
      phone: z.string(),
      role: RoleSchema,
      isActive: z.boolean(),
      isWalkIn: z.boolean(),
      preferences: z.object({
        preferredStaffId: objectIdSchema.optional(),
        smsOptIn: z.boolean(),
        emailOptIn: z.boolean(),
      }),
      lastLoginAt: z.iso.datetime().optional(),
      createdAt: z.iso.datetime(),
      updatedAt: z.iso.datetime(),
    })
    .openapi({
      example: {
        id: '6712c0f9a1b2c3d4e5f60111',
        name: 'Ananya R',
        email: 'ananya@example.com',
        phone: '+919876543212',
        role: 'CUSTOMER',
        isActive: true,
        isWalkIn: false,
        preferences: { smsOptIn: true, emailOptIn: true },
        createdAt: '2026-10-06T09:12:44.000Z',
        updatedAt: '2026-10-06T09:12:44.000Z',
      },
    }),
);

export const UserListSchema = registry.register(
  'UserList',
  z.object({ data: z.array(UserSchema), meta: PaginationMetaSchema }),
);

// API-010
export const UpdateMeBodySchema = z
  .object({
    name: personNameSchema.optional(),
    phone: phoneSchema.optional(),
    preferences: PreferencesSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { error: 'Send at least one field to change' });

// API-011
export const ListUsersQuerySchema = paginationQuerySchema
  .extend({
    q: z
      .string()
      .trim()
      .max(100)
      .optional()
      .openapi({ description: 'Phone prefix, email prefix, or name words', example: '+91981' }),
    role: RoleSchema.optional(),
    isActive: z.stringbool().optional(),
  })
  .strict();

// API-012
export const CreateUserBodySchema = z
  .object({
    name: personNameSchema,
    email: emailSchema,
    phone: phoneSchema,
    role: z.enum(STAFF_ROLES),
    password: passwordSchema.openapi({
      description: 'Temporary password; the user changes it via API-008',
    }),
  })
  .strict();

// API-013
export const WalkInBodySchema = z.object({ name: personNameSchema, phone: phoneSchema }).strict();

// API-015
export const AdminUpdateBodySchema = z
  .object({ role: RoleSchema.optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((body) => body.role !== undefined || body.isActive !== undefined, {
    error: 'Send role and/or isActive',
  });

export type UpdateMeBody = z.infer<typeof UpdateMeBodySchema>;
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;
export type CreateUserBody = z.infer<typeof CreateUserBodySchema>;
export type WalkInBody = z.infer<typeof WalkInBodySchema>;
export type AdminUpdateBody = z.infer<typeof AdminUpdateBodySchema>;
export type UserDto = z.infer<typeof UserSchema>;
