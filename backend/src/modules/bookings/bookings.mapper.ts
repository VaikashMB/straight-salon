import type { AuthContext } from '../../shared/auth/accessToken.js';
import { hasPermission } from '../../shared/auth/permissions.js';
import { maskPhone } from '../../shared/audit/mask.js';
import type { BookingDoc } from './bookings.model.js';
import type { BookingDto } from './bookings.schemas.js';

const MINUTE = 60_000;

const DAY = 24 * 60 * MINUTE;

export interface BookingViewContext {
  viewer: AuthContext;
  now: Date;
  currency: string;
  cancellationCutoffMin: number;
  reviewWindowDays: number;
  reviewed: Set<string>; // ids of these bookings that already have a review
  customers: Map<string, { name: string; phone: string }>;
  staffNames: Map<string, string>;
}

// When the booking was completed: the COMPLETED history entry, else its scheduled end.
export function completedAt(booking: BookingDoc): Date {
  return booking.statusHistory.findLast((h) => h.status === 'COMPLETED')?.at ?? booking.endAt;
}

// BR-012 timing: COMPLETED, and at most reviewWindowDays since completion.
export function reviewWindowOpen(booking: BookingDoc, now: Date, windowDays: number): boolean {
  if (booking.status !== 'COMPLETED') return false;
  return now.getTime() - completedAt(booking).getTime() <= windowDays * DAY;
}

// BR-012 for this viewer: the booking's own customer, inside the window, not yet reviewed.
export function canReview(
  booking: BookingDoc,
  viewer: AuthContext,
  now: Date,
  windowDays: number,
  reviewed: boolean,
): boolean {
  return (
    viewer.role === 'CUSTOMER' &&
    booking.customerId.toHexString() === viewer.userId &&
    !reviewed &&
    reviewWindowOpen(booking, now, windowDays)
  );
}

// BR-006 for this viewer: customers until the cut-off; reception/admin always (with override
// inside the cut-off); stylists never. Only BOOKED bookings can be cancelled or moved.
export function canChange(
  booking: BookingDoc,
  viewer: AuthContext,
  now: Date,
  cutoffMin: number,
): boolean {
  if (booking.status !== 'BOOKED') return false;
  if (hasPermission(viewer.role, 'booking:override_rules')) return true;
  if (viewer.role !== 'CUSTOMER') return false;
  return booking.startAt.getTime() - now.getTime() >= cutoffMin * MINUTE;
}

// Stylists see what their day view needs (00 US-04): first name and a masked phone.
function customerView(
  customer: { name: string; phone: string } | undefined,
  viewer: AuthContext,
): { name: string; phone: string } {
  const name = customer?.name ?? 'Unknown customer';
  const phone = customer?.phone ?? '';
  if (viewer.role !== 'STAFF') return { name, phone };
  return { name: name.split(/\s+/)[0] ?? name, phone: phone ? maskPhone(phone) : '' };
}

export function toBookingDto(booking: BookingDoc, ctx: BookingViewContext): BookingDto {
  const money = (amountMinor: number) => ({ amountMinor, currency: ctx.currency });
  const customerId = booking.customerId.toHexString();
  const staffId = booking.staffId.toHexString();
  const allowed = canChange(booking, ctx.viewer, ctx.now, ctx.cancellationCutoffMin);
  const payment: BookingDto['payment'] = { status: booking.payment.status };
  if (booking.payment.method) payment.method = booking.payment.method;
  if (booking.payment.amountPaidMinor !== undefined)
    payment.amountPaid = money(booking.payment.amountPaidMinor);
  if (booking.payment.discountMinor !== undefined)
    payment.discount = money(booking.payment.discountMinor);
  if (booking.payment.discountReason) payment.discountReason = booking.payment.discountReason;
  if (booking.payment.recordedAt) payment.recordedAt = booking.payment.recordedAt.toISOString();

  const dto: BookingDto = {
    id: booking._id.toHexString(),
    bookingRef: booking.bookingRef,
    status: booking.status,
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
    customer: { id: customerId, ...customerView(ctx.customers.get(customerId), ctx.viewer) },
    staff: { id: staffId, displayName: ctx.staffNames.get(staffId) ?? 'Unknown stylist' },
    services: booking.services.map((s) => ({
      serviceId: s.serviceId.toHexString(),
      name: s.name,
      durationMin: s.durationMin,
      price: money(s.priceMinor),
    })),
    total: money(booking.totalPriceMinor),
    source: booking.source,
    payment,
    canCancel: allowed,
    canReschedule: allowed,
    canReview: canReview(
      booking,
      ctx.viewer,
      ctx.now,
      ctx.reviewWindowDays,
      ctx.reviewed.has(booking._id.toHexString()),
    ),
    createdAt: booking.createdAt.toISOString(),
  };
  if (booking.notes) dto.notes = booking.notes;
  if (booking.cancellation) {
    dto.cancellation = {
      at: booking.cancellation.at.toISOString(),
      overridden: booking.cancellation.overridden,
      ...(booking.cancellation.reason ? { reason: booking.cancellation.reason } : {}),
    };
  }
  return dto;
}

// Fields recorded in audit rows (07 §2.2).
export const bookingAuditView = (b: BookingDoc): Record<string, unknown> => ({
  bookingRef: b.bookingRef,
  status: b.status,
  staffId: b.staffId.toHexString(),
  customerId: b.customerId.toHexString(),
  startAt: b.startAt.toISOString(),
  endAt: b.endAt.toISOString(),
  serviceIds: b.services.map((s) => s.serviceId.toHexString()),
  totalPriceMinor: b.totalPriceMinor,
  source: b.source,
});

// "SS-261012-7KQ2": appointment date (salon tz, YYMMDD) + 4 unambiguous characters (02 §2.11).
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeBookingRef(date: string, random: () => number = Math.random): string {
  const suffix = Array.from(
    { length: 4 },
    () => REF_ALPHABET[Math.floor(random() * REF_ALPHABET.length)],
  ).join('');
  return `SS-${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}-${suffix}`;
}
