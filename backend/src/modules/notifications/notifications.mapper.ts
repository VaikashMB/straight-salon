import type { NotificationDoc } from './notifications.model.js';
import type { NotificationDto } from './notifications.schemas.js';

// Model -> DTO. Delivery internals (provider, its message id, errors) are for admins only.
export function toNotificationDto(
  doc: NotificationDoc,
  { admin }: { admin: boolean },
): NotificationDto {
  const content = doc.payload;
  return {
    id: doc._id.toHexString(),
    userId: doc.userId.toHexString(),
    channel: doc.channel,
    template: doc.template,
    to: doc.to,
    status: doc.status,
    attempts: doc.attempts,
    ...(doc.sentAt ? { sentAt: doc.sentAt.toISOString() } : {}),
    createdAt: doc.createdAt.toISOString(),
    content: {
      ...(content.subject !== undefined ? { subject: content.subject } : {}),
      text: content.text,
      ...(content.html !== undefined ? { html: content.html } : {}),
    },
    ...(admin
      ? {
          provider: doc.provider,
          ...(doc.providerMessageId ? { providerMessageId: doc.providerMessageId } : {}),
          ...(doc.error ? { error: doc.error } : {}),
        }
      : {}),
  };
}
