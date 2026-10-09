'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingList } from '@/components/states/list-states';
import { Button } from '@/components/ui/button';
import { useBooking, type Booking } from '@/features/booking/api';
import { BookingActions } from '@/features/booking/components/booking-actions';
import { StatusBadge } from '@/features/booking/components/status-badge';
import { STATUS_LABEL } from '@/features/booking/status';
import { unwrap } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { ApiError } from '@/lib/errors';
import { formatDateTime, formatMoney } from '@/lib/format';
import { usePublicSettings } from '@/lib/settings';
import { PAYMENT_METHODS } from '@/features/booking/components/payment-dialog';

const SOURCE = { ONLINE: 'Online', WALK_IN: 'Walk-in', PHONE: 'Phone' } as const;

// Status changes and audit entries for one booking (API-058).
function useBookingHistory(id: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['bookings', 'detail', id, 'history'],
    queryFn: () => unwrap(api.GET('/api/v1/bookings/{id}/history', { params: { path: { id } } })),
  });
}

// "Paid ₹X by Cash (discount …)" or "Unpaid".
function paymentSummary(b: Booking): string {
  const { payment } = b;
  if (payment.status !== 'PAID' || !payment.amountPaid) return 'Unpaid';
  const method = PAYMENT_METHODS.find((m) => m.value === payment.method)?.label;
  const discount = payment.discount?.amountMinor
    ? ` (discount ${formatMoney(payment.discount.amountMinor, payment.discount.currency)}: ${payment.discountReason})`
    : '';
  return `Paid ${formatMoney(payment.amountPaid.amountMinor, payment.amountPaid.currency)} by ${method ?? payment.method}${discount}`;
}

// One booking for reception/admin (API-053) with its actions and history (API-058).
export function AdminBookingDetail({ id }: { id: string }) {
  const booking = useBooking(id);
  const { data: settings } = usePublicSettings();
  const history = useBookingHistory(id);

  if (booking.isPending || !settings) return <LoadingList rows={3} label="Loading booking" />;
  if (booking.error) {
    if (booking.error instanceof ApiError && booking.error.status === 404) return <NotFound />;
    return <ErrorState error={booking.error} onRetry={() => void booking.refetch()} />;
  }
  const b = booking.data;
  const tz = settings.timezone;

  return (
    <article className="grid gap-6">
      <div className="grid gap-3">
        <Link
          href="/admin/bookings"
          className="inline-flex w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Bookings
        </Link>
        <PageHeader
          eyebrow="Booking"
          title={b.bookingRef}
          description={`${formatDateTime(b.startAt, tz)} with ${b.staff.displayName} · ${SOURCE[b.source]}`}
          actions={<StatusBadge status={b.status} className="px-3 py-1 text-sm" />}
        />
      </div>
      <BookingActions booking={b} timeZone={tz} />
      <dl className="grid gap-4 rounded-xl border bg-card p-5 text-sm shadow-soft sm:grid-cols-2">
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">Customer</dt>
          <dd className="font-medium">
            {b.customer.name} · {b.customer.phone}
          </dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">Services</dt>
          <dd>
            {b.services
              .map((s) => `${s.name} (${formatMoney(s.price.amountMinor, s.price.currency)})`)
              .join(', ')}
          </dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">Payment</dt>
          <dd>
            {formatMoney(b.total.amountMinor, b.total.currency)} · {paymentSummary(b)}
          </dd>
        </div>
        {b.notes ? (
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">Customer notes</dt>
            <dd>{b.notes}</dd>
          </div>
        ) : null}
        {b.cancellation ? (
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">Cancellation</dt>
            <dd>
              {formatDateTime(b.cancellation.at, tz)}
              {b.cancellation.reason ? ` · ${b.cancellation.reason}` : ''}
              {b.cancellation.overridden ? ' · cut-off overridden' : ''}
            </dd>
          </div>
        ) : null}
      </dl>
      <section aria-labelledby="history" className="grid gap-3">
        <h2 id="history" className="text-lg font-semibold">
          History
        </h2>
        <BookingHistory history={history} timeZone={tz} />
      </section>
    </article>
  );
}

function NotFound() {
  return (
    <div className="grid justify-items-start gap-3">
      <h1 className="text-2xl font-semibold">Booking not found</h1>
      <Button asChild variant="outline">
        <Link href="/admin/bookings">Back to bookings</Link>
      </Button>
    </div>
  );
}

function BookingHistory({
  history,
  timeZone,
}: Readonly<{
  history: ReturnType<typeof useBookingHistory>;
  timeZone: string;
}>) {
  if (history.isPending) return <LoadingList rows={2} label="Loading history" />;
  if (history.error)
    return <ErrorState error={history.error} onRetry={() => void history.refetch()} />;
  return (
    <ol className="grid gap-2.5 border-l-2 pl-4 text-sm">
      {history.data.statusHistory.map((h) => (
        <li key={`${h.status}-${h.at}`}>
          <span className="font-medium">{STATUS_LABEL[h.status]}</span> ·{' '}
          {formatDateTime(h.at, timeZone)} · by {h.by === 'system' ? 'system' : h.by}
          {h.note ? ` · ${h.note}` : ''}
        </li>
      ))}
      {history.data.audit.map((a) => (
        <li key={`${a.action}-${a.at}`} className="text-muted-foreground">
          {a.action} · {formatDateTime(a.at, timeZone)} · {a.actor.role}
          {a.diff.length ? ` · changed ${a.diff.join(', ')}` : ''}
        </li>
      ))}
    </ol>
  );
}
