import { registry } from '../../docs/registry.js';
import { z } from '../../docs/zod.js';
import { paginationQuerySchema, PaginationMetaSchema } from '../../shared/http/pagination.js';
import { dateTimeSchema, objectIdSchema } from '../../shared/http/schemas.js';
import { NOTIFICATION_CHANNELS, NOTIFICATION_STATUSES } from './notifications.model.js';
import { TEMPLATE_NAMES } from './templates/index.js';

// API-065, API-066 (04 §3 Notifications)

const example = {
  id: '6712c0f9a1b2c3d4e5f60a01',
  userId: '6712c0f9a1b2c3d4e5f60111',
  channel: 'EMAIL',
  template: 'booking_confirmed',
  to: 'ananya@example.com',
  status: 'SENT',
  attempts: 1,
  sentAt: '2026-10-06T09:12:46.000Z',
  createdAt: '2026-10-06T09:12:45.000Z',
  content: {
    subject: 'Booking confirmed: Mon 12 Oct 2026, 11:00',
    text: 'Hi Ananya,\n\nYour appointment with Ravi is confirmed.\n...',
  },
};

export const NotificationSchema = registry.register(
  'Notification',
  z
    .object({
      id: objectIdSchema,
      userId: objectIdSchema,
      channel: z.enum(NOTIFICATION_CHANNELS),
      template: z.enum(TEMPLATE_NAMES),
      to: z.string(),
      status: z.enum(NOTIFICATION_STATUSES),
      attempts: z.number().int(),
      sentAt: dateTimeSchema.optional(),
      createdAt: dateTimeSchema,
      content: z
        .object({ subject: z.string().optional(), text: z.string(), html: z.string().optional() })
        .openapi({ description: 'The message as sent; secrets such as reset links are redacted' }),
      // ADMIN view only (API-066)
      provider: z.string().optional().openapi({ example: 'smtp' }),
      providerMessageId: z.string().optional(),
      error: z.string().optional().openapi({ description: 'Last delivery error, if any' }),
    })
    .openapi({ example }),
);

export const NotificationListSchema = registry.register(
  'NotificationList',
  z.object({ data: z.array(NotificationSchema), meta: PaginationMetaSchema }),
);

const pageOnly = paginationQuerySchema.omit({ sort: true });

// API-065: newest first.
export const ListMyNotificationsQuerySchema = pageOnly.strict();

// API-066
export const ListNotificationsQuerySchema = pageOnly
  .extend({
    userId: objectIdSchema.optional(),
    channel: z.enum(NOTIFICATION_CHANNELS).optional(),
    status: z.enum(NOTIFICATION_STATUSES).optional(),
    template: z.enum(TEMPLATE_NAMES).optional(),
  })
  .strict();

export type NotificationDto = z.infer<typeof NotificationSchema>;
export type ListMyNotificationsQuery = z.infer<typeof ListMyNotificationsQuerySchema>;
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;
