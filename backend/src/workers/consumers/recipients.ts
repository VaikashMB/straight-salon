import type { BookingDoc } from '../../modules/bookings/bookings.model.js';
import type { NotificationChannel } from '../../modules/notifications/notifications.model.js';
import { formatMoney } from '../../modules/notifications/templates/layout.js';
import type { BookingInfo, SalonInfo } from '../../modules/notifications/templates/index.js';
import type { SettingsDto } from '../../modules/settings/settings.schemas.js';
import type { UserDoc } from '../../modules/users/users.model.js';
import { formatZoned } from '../../shared/time/tz.js';

// Who receives a message, and on which channels (decision 2026-10-07, 09 §5):
// - account messages (welcome, password_reset): email only, always sent when there is an
//   address; they are not optional;
// - booking messages (customers and stylists): email when there is an address and emailOptIn
//   is on, SMS when smsOptIn is on (FR-054). Walk-ins without email get SMS only.
// Deactivated accounts get nothing.

export type MessageKind = 'account' | 'booking';

export interface Recipient {
  channel: NotificationChannel;
  to: string;
}

export function recipientsFor(user: UserDoc, kind: MessageKind): Recipient[] {
  if (!user.isActive) return [];
  const recipients: Recipient[] = [];
  if (user.email && (kind === 'account' || user.preferences.emailOptIn !== false)) {
    recipients.push({ channel: 'EMAIL', to: user.email });
  }
  if (kind === 'booking' && user.preferences.smsOptIn !== false) {
    recipients.push({ channel: 'SMS', to: user.phone });
  }
  return recipients;
}

export const salonInfo = (s: SettingsDto): SalonInfo => ({ name: s.name, phone: s.phone });

export const whenText = (startAt: Date | string, s: SettingsDto) =>
  formatZoned(new Date(startAt), s.timezone);

export function bookingInfo(
  booking: BookingDoc,
  s: SettingsDto,
  stylist: string,
  link: string,
): BookingInfo {
  return {
    ref: booking.bookingRef,
    when: whenText(booking.startAt, s),
    services: booking.services.map((svc) => svc.name).join(', '),
    stylist,
    total: formatMoney(booking.totalPriceMinor, s.currency),
    link,
  };
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
