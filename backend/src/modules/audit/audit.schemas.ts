import { registry } from '../../docs/registry.js';
import { z } from '../../docs/zod.js';
import { paginationQuerySchema, PaginationMetaSchema } from '../../shared/http/pagination.js';
import { dateSchema, dateTimeSchema, objectIdSchema } from '../../shared/http/schemas.js';

// API-073 (04 §3 Audit, FR-073, 07 §2)

const record = z.record(z.string(), z.unknown());

export const AuditLogSchema = registry.register(
  'AuditLog',
  z
    .object({
      id: objectIdSchema,
      at: dateTimeSchema,
      actor: z.object({
        id: z.string().openapi({ description: 'A user id, or "system" for jobs' }),
        role: z.string(),
        ip: z.string().optional(),
        userAgent: z.string().optional(),
      }),
      action: z.string(),
      entityType: z.string(),
      entityId: z.string(),
      before: record.nullable(),
      after: record.nullable(),
      diff: z.array(z.string()),
      requestId: z.string().optional(),
      metadata: record.optional(),
    })
    .openapi({
      example: {
        id: '6712c0f9a1b2c3d4e5f60d01',
        at: '2026-10-06T09:12:44.123Z',
        actor: { id: '6712c0f9a1b2c3d4e5f60222', role: 'RECEPTIONIST', ip: '10.0.0.5' },
        action: 'booking.cancel',
        entityType: 'booking',
        entityId: '6712c0f9a1b2c3d4e5f60789',
        before: { status: 'BOOKED' },
        after: {
          status: 'CANCELLED',
          cancellation: { reason: 'Customer called', overridden: true },
        },
        diff: ['status', 'cancellation'],
        requestId: '6f1c2a8e-4d1b-4c0e-9a57-2b8f0e1d3c4a',
        metadata: { override: true },
      },
    }),
);

export const AuditLogListSchema = registry.register(
  'AuditLogList',
  z.object({ data: z.array(AuditLogSchema), meta: PaginationMetaSchema }),
);

export const ListAuditLogsQuerySchema = paginationQuerySchema
  .omit({ sort: true })
  .extend({
    entityType: z
      .string()
      .regex(/^[a-z_]{1,40}$/, 'Lowercase entity type, e.g. booking')
      .optional()
      .openapi({ example: 'booking' }),
    entityId: z.string().trim().min(1).max(64).optional(),
    actorId: z
      .union([objectIdSchema, z.literal('system')])
      .optional()
      .openapi({ description: 'A user id, or "system"' }),
    action: z
      .string()
      .regex(/^[a-z_]{1,40}\.[a-z_]{1,40}$/, 'An action such as booking.cancel')
      .optional()
      .openapi({ example: 'booking.cancel' }),
    from: dateSchema.optional().openapi({ description: 'Salon-local date, inclusive' }),
    to: dateSchema.optional().openapi({ description: 'Salon-local date, inclusive' }),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    error: 'from must not be after to',
    path: ['to'],
  });

export type AuditLogDto = z.infer<typeof AuditLogSchema>;
export type ListAuditLogsQuery = z.infer<typeof ListAuditLogsQuerySchema>;
