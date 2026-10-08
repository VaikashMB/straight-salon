import { RESET_TOKEN_TTL_MS } from '../../modules/auth/auth.service.js';
import type { BookingDoc } from '../../modules/bookings/bookings.model.js';
import type { BookingsService } from '../../modules/bookings/bookings.service.js';
import type { NotificationSender } from '../../modules/notifications/notifications.sender.js';
import type {
  BookingInfo,
  SalonInfo,
  TemplateMessage,
} from '../../modules/notifications/templates/index.js';
import type { SettingsDto } from '../../modules/settings/settings.schemas.js';
import type { SettingsService } from '../../modules/settings/settings.service.js';
import type { StaffService } from '../../modules/staff/staff.service.js';
import type { UsersService } from '../../modules/users/users.service.js';
import type { DomainEvent } from '../../shared/events/envelope.js';
import type { EventHandler } from '../../shared/events/EventBus.js';
import { parseEventPayload, type EventPayload } from '../../shared/events/registry.js';
import { decryptSecret } from '../../shared/events/secret.js';
import type { Logger } from '../../shared/logger/index.js';
import { createMessenger } from './messenger.js';
import { bookingInfo, salonInfo, whenText } from './recipients.js';

// `notifications` consumer (09 §5): customer-facing messages for account and booking events.
// Data is re-read from the services (payloads carry IDs); stale events are skipped.

export interface NotificationsConsumerDeps {
  bookings: Pick<BookingsService, 'findById'>;
  users: Pick<UsersService, 'findByIds'>;
  staff: Pick<StaffService, 'briefs'>;
  settings: Pick<SettingsService, 'get'>;
  sender: NotificationSender;
  appBaseUrl: string;
  encryptionKey: string;
  logger: Logger;
}

export function createNotificationsConsumer(deps: NotificationsConsumerDeps): EventHandler {
  const { bookings, staff, settings, appBaseUrl } = deps;
  const log = deps.logger.child({ consumer: 'notifications' });
  const messenger = createMessenger({ users: deps.users, sender: deps.sender, logger: log });

  async function loadBooking(bookingId: string): Promise<BookingDoc | null> {
    const booking = await bookings.findById(bookingId);
    if (!booking) log.warn({ bookingId }, 'Booking not found; nothing sent');
    return booking;
  }

  async function stylistName(staffId: string): Promise<string> {
    const [brief] = await staff.briefs([staffId]);
    return brief?.displayName ?? 'your stylist';
  }

  // The booking messages to the customer: confirmed, rescheduled, cancelled, reminders,
  // no-show, thank-you. `message` adds the template and any extra fields to the common data.
  async function bookingMessage(
    event: DomainEvent,
    booking: BookingDoc,
    message: (
      base: { name: string; salon: SalonInfo; booking: BookingInfo },
      s: SettingsDto,
    ) => TemplateMessage,
  ): Promise<void> {
    const s = await settings.get();
    const info = bookingInfo(
      booking,
      s,
      await stylistName(booking.staffId.toHexString()),
      `${appBaseUrl}/account/bookings/${booking._id.toHexString()}`,
    );
    await messenger.send(event, booking.customerId.toHexString(), 'booking', (name) =>
      message({ name, salon: salonInfo(s), booking: info }, s),
    );
  }

  async function passwordResetMessage(event: DomainEvent, userId: string): Promise<void> {
    if (!event.secret) {
      log.error({ eventId: event.eventId }, 'Password reset event has no token; not sent');
      return;
    }
    // The raw token only ever exists encrypted in the outbox and in the email (09 §7).
    const token = decryptSecret(event.secret, deps.encryptionKey);
    const s = await settings.get();
    await messenger.send(event, userId, 'account', (name) => ({
      template: 'password_reset',
      data: {
        name,
        salon: salonInfo(s),
        resetUrl: `${appBaseUrl}/reset-password?token=${encodeURIComponent(token)}`,
        validMinutes: RESET_TOKEN_TTL_MS / 60_000,
      },
    }));
  }

  async function reminderMessage(
    event: DomainEvent,
    p: EventPayload<'booking.reminder_due'>,
  ): Promise<void> {
    const booking = await loadBooking(p.bookingId);
    if (!booking) return;
    // Cancelled, checked in or moved since the job queued it: the reminder is stale.
    if (booking.status !== 'BOOKED' || booking.startAt.toISOString() !== p.startAt) {
      log.debug({ bookingId: p.bookingId, window: p.window }, 'Stale reminder skipped');
      return;
    }
    await bookingMessage(event, booking, (data) =>
      p.window === '24h'
        ? { template: 'booking_reminder_24h', data }
        : { template: 'booking_reminder_2h', data },
    );
  }

  return async (event) => {
    switch (event.type) {
      case 'user.registered': {
        const { userId } = parseEventPayload(event.type, event.payload);
        const s = await settings.get();
        await messenger.send(event, userId, 'account', (name) => ({
          template: 'welcome',
          data: { name, salon: salonInfo(s), link: `${appBaseUrl}/book` },
        }));
        return;
      }

      case 'user.password_reset_requested': {
        const { userId } = parseEventPayload(event.type, event.payload);
        await passwordResetMessage(event, userId);
        return;
      }

      case 'booking.created': {
        const p = parseEventPayload(event.type, event.payload);
        const booking = await loadBooking(p.bookingId);
        if (booking) {
          await bookingMessage(event, booking, (data) => ({ template: 'booking_confirmed', data }));
        }
        return;
      }

      case 'booking.rescheduled': {
        const p = parseEventPayload(event.type, event.payload);
        const booking = await loadBooking(p.bookingId);
        if (booking) {
          await bookingMessage(event, booking, (base, s) => ({
            template: 'booking_rescheduled',
            data: { ...base, previousWhen: whenText(p.from.startAt, s) },
          }));
        }
        return;
      }

      case 'booking.cancelled': {
        const p = parseEventPayload(event.type, event.payload);
        const booking = await loadBooking(p.bookingId);
        if (booking) {
          await bookingMessage(event, booking, (base) => ({
            template: 'booking_cancelled',
            data: { ...base, reason: p.reason },
          }));
        }
        return;
      }

      case 'booking.no_show': {
        const p = parseEventPayload(event.type, event.payload);
        const booking = await loadBooking(p.bookingId);
        if (booking) {
          await bookingMessage(event, booking, (data) => ({ template: 'booking_no_show', data }));
        }
        return;
      }

      case 'booking.completed': {
        const p = parseEventPayload(event.type, event.payload);
        const booking = await loadBooking(p.bookingId);
        if (booking) {
          await bookingMessage(event, booking, (data) => ({ template: 'booking_thank_you', data }));
        }
        return;
      }

      case 'booking.reminder_due':
        await reminderMessage(event, parseEventPayload(event.type, event.payload));
        return;

      default:
        return;
    }
  };
}
