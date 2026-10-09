'use client';

import { ChevronRight, Clock, Scissors } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { Booking } from '@/features/booking/api';
import { ChangeActions } from '@/features/booking/components/change-actions';
import { StatusBadge } from '@/features/booking/components/status-badge';
import { STATUS_EDGE } from '@/features/booking/status';
import { formatDateTime, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

// One booking in the customer's lists (05 §4.2): a status-coloured left edge (with the status
// badge as text), the details, and the actions in a tidy row underneath.
export function AccountBookingCard({
  booking,
  timeZone,
  index = 0,
}: {
  booking: Booking;
  timeZone: string;
  index?: number;
}) {
  return (
    <article
      className={cn(
        'grid animate-fade-up gap-4 rounded-2xl border border-l-4 bg-card p-4 shadow-soft transition-shadow duration-300 hover:shadow-lift sm:p-5',
        STATUS_EDGE[booking.status],
      )}
      style={{ animationDelay: `${Math.min(index, 6) * 50}ms` }}
    >
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-lg font-semibold">
            <Link
              href={`/account/bookings/${booking.id}`}
              className="group inline-flex items-center gap-1 rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {formatDateTime(booking.startAt, timeZone)}
              <ChevronRight
                aria-hidden
                className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </h2>
          <StatusBadge status={booking.status} />
        </div>
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <Scissors aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {booking.services.map((s) => s.name).join(', ')} with {booking.staff.displayName}
          </span>
        </p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock aria-hidden className="size-3.5 shrink-0" />
          <span className="tabular-nums">
            {booking.bookingRef} · {formatMoney(booking.total.amountMinor, booking.total.currency)}
          </span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3 empty:hidden">
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
