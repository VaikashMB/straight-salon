import type { BookingDoc } from '../../modules/bookings/bookings.model.js';
import type { BookingsService } from '../../modules/bookings/bookings.service.js';
import type { NotificationSender } from '../../modules/notifications/notifications.sender.js';
import type { SettingsService } from '../../modules/settings/settings.service.js';
import type { StaffService } from '../../modules/staff/staff.service.js';
import type { UsersService } from '../../modules/users/users.service.js';
import type { DomainEvent } from '../../shared/events/envelope.js';
import type { EventHandler } from '../../shared/events/EventBus.js';
import { parseEventPayload } from '../../shared/events/registry.js';
import type { Logger } from '../../shared/logger/index.js';
import { createMessenger } from './messenger.js';
import { bookingInfo, firstName, salonInfo, whenText } from './recipients.js';

// `staff-notifications` consumer (09 §5, FR-052): tells the assigned stylist when a booking is
// added, moved or removed. A reassignment tells both: the new stylist gets "assigned", the old
// one "cancelled" (it left their schedule).

export interface StaffNotificationsConsumerDeps {
  bookings: Pick<BookingsService, 'findById'>;
  users: Pick<UsersService, 'findByIds'>;
  staff: Pick<StaffService, 'briefs'>;
  settings: Pick<SettingsService, 'get'>;
  sender: NotificationSender;
  appBaseUrl: string;
  logger: Logger;
}

type StaffTemplate = 'staff_booking_assigned' | 'staff_booking_changed' | 'staff_booking_cancelled';

export const REASSIGNED_REASON = 'Reassigned to another stylist';

export function createStaffNotificationsConsumer(
  deps: StaffNotificationsConsumerDeps,
): EventHandler {
  const { bookings, users, staff, settings, appBaseUrl } = deps;
  const log = deps.logger.child({ consumer: 'staff-notifications' });
  const messenger = createMessenger({ users, sender: deps.sender, logger: log });

  async function notifyStylist(
    event: DomainEvent,
    staffId: string,
    booking: BookingDoc,
    template: StaffTemplate,
    extra: { previousWhen?: string; reason?: string | undefined } = {},
  ): Promise<void> {
    const [brief] = await staff.briefs([staffId]);
    if (!brief) {
      log.warn({ staffId }, 'Stylist not found; nothing sent');
      return;
    }
    const s = await settings.get();
    const [customer] = await users.findByIds([booking.customerId.toHexString()]);
    const base = {
      salon: salonInfo(s),
      booking: bookingInfo(booking, s, brief.displayName, `${appBaseUrl}/staff`),
      customer: customer ? firstName(customer.name) : 'A customer',
    };
    await messenger.send(event, brief.userId, 'booking', (name) => {
      const data = { ...base, name };
      switch (template) {
        case 'staff_booking_changed':
          return {
            template,
            data: { ...data, previousWhen: extra.previousWhen ?? data.booking.when },
          };
        case 'staff_booking_cancelled':
          return { template, data: { ...data, reason: extra.reason } };
        default:
          return { template, data };
      }
    });
  }

  async function loadBooking(bookingId: string): Promise<BookingDoc | null> {
    const booking = await bookings.findById(bookingId);
    if (!booking) log.warn({ bookingId }, 'Booking not found; nothing sent');
    return booking;
  }

  return async (event) => {
    switch (event.type) {
      case 'booking.created': {
        const p = parseEventPayload(event.type, event.payload);
        const booking = await loadBooking(p.bookingId);
        if (booking) await notifyStylist(event, p.staffId, booking, 'staff_booking_assigned');
        return;
      }

      case 'booking.rescheduled': {
        const p = parseEventPayload(event.type, event.payload);
        const booking = await loadBooking(p.bookingId);
        if (!booking) return;
        const s = await settings.get();
        if (p.from.staffId === p.to.staffId) {
          await notifyStylist(event, p.to.staffId, booking, 'staff_booking_changed', {
            previousWhen: whenText(p.from.startAt, s),
          });
          return;
        }
        await notifyStylist(event, p.to.staffId, booking, 'staff_booking_assigned');
        // The old stylist sees the slot they had: the booking as it was before the move.
        await notifyStylist(
          event,
          p.from.staffId,
          { ...booking, startAt: new Date(p.from.startAt) },
          'staff_booking_cancelled',
          { reason: REASSIGNED_REASON },
        );
        return;
      }

      case 'booking.cancelled': {
        const p = parseEventPayload(event.type, event.payload);
        const booking = await loadBooking(p.bookingId);
        if (booking) {
          await notifyStylist(event, p.staffId, booking, 'staff_booking_cancelled', {
            reason: p.reason,
          });
        }
        return;
      }

      default:
        return;
    }
  };
}
