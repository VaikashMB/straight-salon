import type { NotificationSender } from '../../modules/notifications/notifications.sender.js';
import type { TemplateMessage } from '../../modules/notifications/templates/index.js';
import type { UsersService } from '../../modules/users/users.service.js';
import type { DomainEvent } from '../../shared/events/envelope.js';
import type { Logger } from '../../shared/logger/index.js';
import { recipientsFor, type MessageKind } from './recipients.js';

// Sends one template to one user on each of their channels (recipients.ts rules). Channels
// go one after the other: a failure retries the whole job, and the channels that already
// went out are skipped by their dedupeKey (09 §6).

export interface Messenger {
  // `message` gets the recipient's name and returns the template with its data.
  send(
    event: DomainEvent,
    userId: string,
    kind: MessageKind,
    message: (name: string) => TemplateMessage,
  ): Promise<void>;
}

export function createMessenger(deps: {
  users: Pick<UsersService, 'findByIds'>;
  sender: NotificationSender;
  logger: Logger;
}): Messenger {
  const { users, sender, logger } = deps;
  return {
    async send(event, userId, kind, message) {
      const [user] = await users.findByIds([userId]);
      if (!user) {
        logger.warn({ userId, eventType: event.type }, 'Recipient not found; nothing sent');
        return;
      }
      const recipients = recipientsFor(user, kind);
      if (recipients.length === 0) {
        logger.debug({ userId, eventType: event.type }, 'Recipient has no channel; nothing sent');
        return;
      }
      const content = message(user.name);
      for (const { channel, to } of recipients) {
        await sender.deliver({ ...content, eventId: event.eventId, userId, channel, to });
      }
    },
  };
}
