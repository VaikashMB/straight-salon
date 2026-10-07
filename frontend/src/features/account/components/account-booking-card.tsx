'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { Booking } from '@/features/booking/api';
import { ChangeActions } from '@/features/booking/components/change-actions';
import { StatusBadge } from '@/features/booking/components/status-badge';
import { formatDateTime, formatMoney } from '@/lib/format';

// One booking in the customer's lists (05 §4.2).
export function AccountBookingCard({ booking, timeZone }: { booking: Booking; timeZone: string }) {
  return (
    <article className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">
            <Link href={`/account/bookings/${booking.id}`} className="hover:underline">
              {formatDateTime(booking.startAt, timeZone)}
            </Link>
          </h2>
          <StatusBadge status={booking.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {booking.services.map((s) => s.name).join(', ')} with {booking.staff.displayName}
        </p>
        <p className="text-xs text-muted-foreground">
          {booking.bookingRef} · {formatMoney(booking.total.amountMinor, booking.total.currency)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <ChangeActions booking={booking} timeZone={timeZone} />
        {booking.canReview ? (
          <Button asChild size="sm" variant="accent">
            <Link href={`/account/bookings/${booking.id}#review`}>Leave a review</Link>
          </Button>
        ) : null}
      </div>
    </article>
  );
}
