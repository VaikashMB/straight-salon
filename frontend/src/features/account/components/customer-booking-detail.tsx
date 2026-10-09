'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingList } from '@/components/states/list-states';
import { Button } from '@/components/ui/button';
import { useBooking } from '@/features/booking/api';
import { ChangeActions } from '@/features/booking/components/change-actions';
import { StatusBadge } from '@/features/booking/components/status-badge';
import { STATUS_EDGE } from '@/features/booking/status';
import { ApiError } from '@/lib/errors';
import { formatDateTime, formatMoney } from '@/lib/format';
import { usePublicSettings } from '@/lib/settings';
import { formatMinutes } from '@/lib/time';
import { cn } from '@/lib/utils';
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
      <div className="grid gap-3">
        <Link
          href="/account"
          className="inline-flex w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="size-4" />
          My bookings
        </Link>
        <PageHeader
          eyebrow="Booking"
          title={formatDateTime(b.startAt, tz)}
          description={`Reference ${b.bookingRef}`}
          actions={<StatusBadge status={b.status} className="px-3 py-1 text-sm" />}
        />
      </div>

      <dl
        className={cn(
          'grid animate-fade-up gap-4 rounded-2xl border border-l-4 bg-card p-5 text-sm shadow-soft [animation-delay:80ms] sm:grid-cols-2',
          STATUS_EDGE[b.status],
        )}
      >
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
