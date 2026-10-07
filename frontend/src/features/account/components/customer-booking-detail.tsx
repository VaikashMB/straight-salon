'use client';

import Link from 'next/link';
import { ErrorState, LoadingList } from '@/components/states/list-states';
import { Button } from '@/components/ui/button';
import { useBooking } from '@/features/booking/api';
import { ChangeActions } from '@/features/booking/components/change-actions';
import { StatusBadge } from '@/features/booking/components/status-badge';
import { ApiError } from '@/lib/errors';
import { formatDateTime, formatMoney } from '@/lib/format';
import { usePublicSettings } from '@/lib/settings';
import { formatMinutes } from '@/lib/time';
import { ReviewForm } from './review-form';

// A customer's booking (API-053): details, reschedule, cancel, review (05 §4.2).
export function CustomerBookingDetail({ id }: { id: string }) {
  const booking = useBooking(id);
  const { data: settings } = usePublicSettings();

  if (booking.isPending || !settings) return <LoadingList rows={2} label="Loading booking" />;
  if (booking.error) {
    if (booking.error instanceof ApiError && booking.error.status === 404) {
      return (
        <div className="grid justify-items-start gap-3">
          <h1 className="text-2xl font-semibold">Booking not found</h1>
          <Button asChild variant="outline">
            <Link href="/account">Back to my bookings</Link>
          </Button>
        </div>
      );
    }
    return <ErrorState error={booking.error} onRetry={() => void booking.refetch()} />;
  }

  const b = booking.data;
  const tz = settings.timezone;
  return (
    <article className="grid gap-6">
      <div className="grid gap-2">
        <Link href="/account" className="text-sm text-muted-foreground underline">
          My bookings
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">{formatDateTime(b.startAt, tz)}</h1>
          <StatusBadge status={b.status} />
        </div>
        <p className="text-muted-foreground">Reference {b.bookingRef}</p>
      </div>

      <dl className="grid gap-4 rounded-lg border bg-card p-5 text-sm sm:grid-cols-2">
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">Stylist</dt>
          <dd className="font-medium">{b.staff.displayName}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">Total</dt>
          <dd className="font-medium">
            {formatMoney(b.total.amountMinor, b.total.currency)}
            {b.payment.status === 'PAID' ? ' · Paid' : ''}
          </dd>
        </div>
        <div className="grid gap-1 sm:col-span-2">
          <dt className="text-muted-foreground">Services</dt>
          <dd>
            <ul className="grid gap-1">
              {b.services.map((s) => (
                <li key={s.serviceId}>
                  {s.name} · {formatMinutes(s.durationMin)} ·{' '}
                  {formatMoney(s.price.amountMinor, s.price.currency)}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        {b.notes ? (
          <div className="grid gap-0.5 sm:col-span-2">
            <dt className="text-muted-foreground">Your notes</dt>
            <dd>{b.notes}</dd>
          </div>
        ) : null}
        {b.cancellation ? (
          <div className="grid gap-0.5 sm:col-span-2">
            <dt className="text-muted-foreground">Cancelled</dt>
            <dd>
              {formatDateTime(b.cancellation.at, tz)}
              {b.cancellation.reason ? ` · ${b.cancellation.reason}` : ''}
            </dd>
          </div>
        ) : null}
      </dl>

      <ChangeActions booking={b} timeZone={tz} />
      {b.canReview ? <ReviewForm bookingId={b.id} /> : null}
    </article>
  );
}
