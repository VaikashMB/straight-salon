import type { ClientSession } from 'mongoose';

// Port through which settings, holidays and staff ask about active bookings (API-018 timezone
// change, API-020 holiday, API-032 deactivation / BR-014, API-036 time-off). Implemented by the
// bookings service (`bookingsService.gate`). Modules depend on this interface only, never on
// the bookings repository (01 §3).

// Active bookings (BOOKED, CHECKED_IN, IN_SERVICE) whose [startAt, blockedUntil) overlaps
// [from, to). No `to` means "from `from` onwards".
export interface ActiveBookingScope {
  staffId?: string;
  from: Date;
  to?: Date;
}

export interface ActiveBookingsGate {
  countActive(scope: ActiveBookingScope, session?: ClientSession): Promise<number>;
  // `force: true` paths: cancels them inside the caller's transaction, with audit rows and
  // booking.cancelled events so customers are notified (BR-014). Returns how many.
  cancelActive(scope: ActiveBookingScope, reason: string, session: ClientSession): Promise<number>;
}
