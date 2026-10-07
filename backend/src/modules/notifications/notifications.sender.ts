import type { Logger } from '../../shared/logger/index.js';
import type { Clock } from '../../shared/time/clock.js';
import type { NotificationChannel, NotificationContent } from './notifications.model.js';
import type { NotificationsRepository } from './notifications.repository.js';
import type { EmailProvider, SmsProvider } from './providers/index.js';
import { renderMessage, type TemplateMessage } from './templates/index.js';

// Renders a template and delivers it on one channel, recording the attempt in `notifications`
// (09 §5). The row's dedupeKey (eventId:channel:template) makes it idempotent: a retried or
// duplicated event never sends a message twice. A provider error marks the row FAILED and is
// rethrown, so the queue retries the job (and this send) with backoff.

export type Delivery = TemplateMessage & {
  eventId: string;
  userId: string;
  channel: NotificationChannel;
  to: string;
};

export type DeliveryOutcome = 'sent' | 'already_sent';

export interface NotificationSender {
  deliver(delivery: Delivery): Promise<DeliveryOutcome>;
}

export const REDACTED = '[redacted]';

export function dedupeKeyFor(eventId: string, channel: NotificationChannel, template: string) {
  return `${eventId}:${channel}:${template}`;
}

function redact<T extends Record<string, string | undefined>>(content: T, secrets: string[]): T {
  if (secrets.length === 0) return content;
  const scrub = (value: string) =>
    secrets.reduce((text, secret) => text.split(secret).join(REDACTED), value);
  return Object.fromEntries(
    Object.entries(content).map(([key, value]) => [
      key,
      value === undefined ? value : scrub(value),
    ]),
  ) as T;
}

export function createNotificationSender(deps: {
  repository: NotificationsRepository;
  email: EmailProvider;
  sms: SmsProvider;
  clock: Clock;
  logger: Logger;
}): NotificationSender {
  const { repository, email, sms, clock } = deps;
  const log = deps.logger.child({ module: 'notifications' });

  return {
    async deliver(delivery) {
      const message = renderMessage(delivery);
      const content: NotificationContent =
        delivery.channel === 'EMAIL' ? { ...message.email } : { ...message.sms };
      const provider = delivery.channel === 'EMAIL' ? email : sms;
      const row = await repository.reserve({
        userId: delivery.userId,
        channel: delivery.channel,
        template: delivery.template,
        to: delivery.to,
        // The stored copy never holds secrets (e.g. the password-reset link), 09 §7.
        payload: redact({ ...content }, message.secrets),
        provider: provider.name,
        dedupeKey: dedupeKeyFor(delivery.eventId, delivery.channel, delivery.template),
      });
      const fields = {
        notificationId: row._id.toHexString(),
        channel: delivery.channel,
        template: delivery.template,
      };
      if (row.status === 'SENT') {
        log.debug(fields, 'Notification already sent; skipping');
        return 'already_sent';
      }
      try {
        const sent =
          delivery.channel === 'EMAIL'
            ? await email.send({ to: delivery.to, ...message.email })
            : await sms.send({ to: delivery.to, text: message.sms.text });
        await repository.markSent(row._id, sent.messageId, clock.now());
        log.info({ ...fields, provider: provider.name }, 'Notification sent');
        return 'sent';
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await repository.markFailed(row._id, reason);
        // Provider messages can quote the recipient address, so only the error's name and code
        // are logged (NFR-009); the row keeps the message for API-066.
        log.warn(
          {
            ...fields,
            errName: err instanceof Error ? err.name : typeof err,
            errCode: (err as { code?: unknown }).code,
            attempt: row.attempts + 1,
          },
          'Notification failed; will retry',
        );
        throw err;
      }
    },
  };
}
